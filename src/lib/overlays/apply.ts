/**
 * The one place that adds, updates and removes overlay sources/layers.
 *
 * Every registered overlay is rendered as `overlay:<id>` plus
 * `overlay:<id>:<n>` layers, so a single prefix sweep can clean up after a
 * definition disappears or the style is replaced.
 */
import type { LayerSpecification, Map as MLMap, SourceSpecification } from "maplibre-gl";
import type { OverlayDefinition, OverlayLayer, OverlaySource, ResolvedOverlay } from "./types";

export const OVERLAY_PREFIX = "overlay:";

export function overlaySourceId(id: string): string {
  return `${OVERLAY_PREFIX}${id}`;
}

export function overlayLayerId(id: string, index: number): string {
  return `${OVERLAY_PREFIX}${id}:${index}`;
}

/**
 * Stacking anchor: overlays sit above the basemap's fill/line work but below
 * labels, POI dots and live vehicles. Prefers feature layers we know about,
 * falls back to the first symbol layer of whatever style is loaded.
 */
export function overlayBeforeId(map: MLMap): string | undefined {
  for (const id of [
    "poi-mini-dots",
    "live-vehicles-halo",
    "rail-lines",
    "bus-lines-casing",
  ]) {
    if (map.getLayer(id)) return id;
  }
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.type === "symbol") return layer.id;
    if (layer.id.startsWith(OVERLAY_PREFIX)) return layer.id;
  }
  return undefined;
}

function sourceSpec(
  source: OverlaySource,
  attribution?: string,
): SourceSpecification {
  if (source.type === "image") {
    // MapLibre's image source has no `attribution` property (the style
    // validator rejects the whole source), so image overlays carry their
    // credit in the panel instead.
    return {
      type: "image",
      url: source.url,
      coordinates: source.coordinates,
    };
  }
  if (source.type === "raster") {
    return {
      type: "raster",
      tiles: source.tiles,
      tileSize: source.tileSize ?? 256,
      ...(attribution ? { attribution } : {}),
    };
  }
  return {
    type: "geojson",
    data: source.data,
    ...(attribution ? { attribution } : {}),
  };
}

function layerSpec(
  id: string,
  sourceId: string,
  layer: OverlayLayer,
): LayerSpecification {
  return {
    id,
    type: layer.type,
    source: sourceId,
    ...(layer.filter ? { filter: layer.filter } : {}),
    ...(layer.minzoom !== undefined ? { minzoom: layer.minzoom } : {}),
    ...(layer.maxzoom !== undefined ? { maxzoom: layer.maxzoom } : {}),
    ...(layer.layout ? { layout: layer.layout } : {}),
    ...(layer.paint ? { paint: layer.paint } : {}),
  } as LayerSpecification;
}

function sourceUrl(map: MLMap, sourceId: string): string | null {
  const source = map.getSource(sourceId) as { url?: string } | undefined;
  return typeof source?.url === "string" ? source.url : null;
}

function sourceTiles(map: MLMap, sourceId: string): string | null {
  const source = map.getSource(sourceId) as { tiles?: string[] } | undefined;
  return Array.isArray(source?.tiles) ? (source.tiles[0] ?? null) : null;
}

function removeSourceLayers(map: MLMap, id: string): void {
  const sourceId = overlaySourceId(id);
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    if (layer.id.startsWith(`${OVERLAY_PREFIX}${id}:`)) {
      try {
        map.removeLayer(layer.id);
      } catch {
        /* style replaced under us */
      }
    }
  }
  try {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  } catch {
    /* same */
  }
}

/** Replace only the parts that changed. Idempotent. */
function upsert(
  map: MLMap,
  id: string,
  resolved: ResolvedOverlay,
  beforeId?: string,
  attribution?: string,
): void {
  const sourceId = overlaySourceId(id);
  const existing = map.getSource(sourceId);
  const spec = () => sourceSpec(resolved.source, attribution);

  if (resolved.source.type === "geojson") {
    if (existing) {
      const withData = existing as unknown as {
        setData?: (data: unknown) => void;
      };
      withData.setData?.(resolved.source.data);
    } else {
      map.addSource(sourceId, spec());
    }
  } else if (resolved.source.type === "image") {
    if (!existing) {
      map.addSource(sourceId, spec());
    } else if (sourceUrl(map, sourceId) !== resolved.source.url) {
      const image = existing as unknown as {
        updateImage?: (options: { url: string; coordinates?: unknown }) => void;
      };
      if (image.updateImage) {
        image.updateImage({
          url: resolved.source.url,
          coordinates: resolved.source.coordinates,
        });
      } else {
        removeSourceLayers(map, id);
        map.addSource(sourceId, spec());
      }
    }
  } else if (!existing) {
    map.addSource(sourceId, spec());
  } else if (sourceTiles(map, sourceId) !== resolved.source.tiles[0]) {
    removeSourceLayers(map, id);
    map.addSource(sourceId, spec());
  }

  resolved.layers.forEach((layer, index) => {
    const layerId = overlayLayerId(id, index);
    const existingLayer = map.getLayer(layerId);
    if (existingLayer && existingLayer.type !== layer.type) {
      // A definition switched paint model (fill -> line). MapLibre cannot
      // retype a layer, so rebuild just this one.
      map.removeLayer(layerId);
    }
    if (!map.getLayer(layerId)) {
      map.addLayer(layerSpec(layerId, sourceId, layer), beforeId);
      return;
    }
    for (const [key, value] of Object.entries(layer.paint ?? {})) {
      map.setPaintProperty(layerId, key, value);
    }
    for (const [key, value] of Object.entries(layer.layout ?? {})) {
      map.setLayoutProperty(layerId, key, value);
    }
  });

  // Drop layers that this definition no longer produces.
  const keep = new Set(resolved.layers.map((_, i) => overlayLayerId(id, i)));
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.id.startsWith(`${OVERLAY_PREFIX}${id}:`) && !keep.has(layer.id)) {
      try {
        map.removeLayer(layer.id);
      } catch {
        /* style replaced */
      }
    }
  }
}

export interface ActiveOverlay {
  definition: OverlayDefinition;
  resolved: ResolvedOverlay | null;
}

/**
 * Bring the map in line with the active set: add/update what is on, remove
 * everything else. Safe to call on every state change and on `style.load`.
 */
export function reconcileOverlays(map: MLMap, active: ActiveOverlay[]): void {
  const beforeId = overlayBeforeId(map);
  const ordered = [...active].sort(
    (a, b) => a.definition.order - b.definition.order,
  );
  const wanted = new Set<string>();
  for (const entry of ordered) {
    if (!entry.resolved) continue;
    wanted.add(entry.definition.id);
    try {
      upsert(
        map,
        entry.definition.id,
        entry.resolved,
        beforeId,
        entry.definition.attribution?.label,
      );
    } catch {
      // A style swap can invalidate the style between check and add. The
      // next reconcile (style.load / idle) repairs it.
    }
  }
  for (const layer of map.getStyle()?.layers ?? []) {
    if (!layer.id.startsWith(OVERLAY_PREFIX)) continue;
    const id = layer.id.slice(OVERLAY_PREFIX.length).split(":")[0];
    if (id && !wanted.has(id)) {
      try {
        map.removeLayer(layer.id);
      } catch {
        /* style replaced */
      }
    }
  }
  const style = map.getStyle();
  if (!style) return;
  for (const sourceId of Object.keys(style.sources ?? {})) {
    if (!sourceId.startsWith(OVERLAY_PREFIX)) continue;
    const id = sourceId.slice(OVERLAY_PREFIX.length);
    if (!wanted.has(id)) {
      try {
        map.removeSource(sourceId);
      } catch {
        /* still referenced by a layer we failed to remove */
      }
    }
  }
}

/** Remove every overlay source/layer this framework owns. */
export function clearOverlays(map: MLMap): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.id.startsWith(OVERLAY_PREFIX)) {
      try {
        map.removeLayer(layer.id);
      } catch {
        /* ignore */
      }
    }
  }
  for (const sourceId of Object.keys(map.getStyle()?.sources ?? {})) {
    if (sourceId.startsWith(OVERLAY_PREFIX)) {
      try {
        map.removeSource(sourceId);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Layer ids an overlay occupies — used to register tap targets. */
export function overlayLayerIds(id: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => overlayLayerId(id, i));
}
