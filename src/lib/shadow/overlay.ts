/**
 * Dock point for the generic overlay registry.
 *
 * The registry lives in `src/lib/overlays/**` and is built on a parallel
 * branch. This module deliberately does not import it: the definition below
 * is structurally compatible with `OverlayDefinition` there.
 *
 * Wiring is two lines in that branch's bootstrap plus one dependency in its
 * hook (see `docs/superpowers/specs/2026-11-21-shadow-map-design.md` §7):
 *
 *   import { registerOverlay } from "@/lib/overlays";
 *   import { shadowOverlayDefinition } from "@/lib/shadow/overlay";
 *   registerOverlay(shadowOverlayDefinition());
 *
 * and, inside `useOverlayLayers`:
 *
 *   const shadowVersion = useShadowOverlayVersion();
 *   // add `shadowVersion` to the useMemo dependency array
 *
 * The version is the trigger. `useOverlayLayers` memoises on
 * `[enabled, opacity, radarFrames, radarIndex, warnings]`; a worker result
 * changes none of those, so without the version the map keeps the old
 * polygons. `useShadowOverlayVersion` is a `useSyncExternalStore` binding to
 * the store below and re-runs the memo on every data change.
 *
 * For code that is not React, `applyShadowLayer(map, result)` in `layer.ts`
 * applies a result immediately.
 */

export type ShadowOverlaySource =
  | { type: "geojson"; data: GeoJSON.FeatureCollection }
  | { type: "raster"; tiles: string[]; tileSize?: number };

export interface ShadowOverlayLayer {
  type: "fill" | "raster";
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  minzoom?: number;
  maxzoom?: number;
}

/**
 * Mirror of the registry's `OverlayDefinition` fields this layer needs.
 * Declared locally so this module compiles before the registry branch lands.
 */
export interface ShadowOverlayDefinition {
  id: string;
  label: string;
  group: string;
  kind: "geojson" | "raster";
  description: string;
  attribution: { label: string; url?: string };
  opacity: number;
  minzoom: number;
  timeAware: boolean;
  order: number;
  resolve: (context?: { opacity?: number }) => {
    source: ShadowOverlaySource;
    layers: ShadowOverlayLayer[];
  } | null;
}

export const SHADOW_OVERLAY_ID = "nature-shadow";
export const SHADOW_OVERLAY_MIN_ZOOM = 14;

export interface ShadowOverlaySnapshot {
  readonly version: number;
  readonly geojson: GeoJSON.FeatureCollection | null;
  readonly tiles: readonly string[] | null;
  readonly tileSize: number;
  readonly opacity: number;
}

const INITIAL: ShadowOverlaySnapshot = {
  version: 0,
  geojson: null,
  tiles: null,
  tileSize: 512,
  opacity: 0.45,
};

let snapshot: ShadowOverlaySnapshot = INITIAL;
const listeners = new Set<() => void>();

function commit(patch: Partial<Omit<ShadowOverlaySnapshot, "version">>): void {
  snapshot = { ...snapshot, ...patch, version: snapshot.version + 1 };
  for (const listener of listeners) listener();
}

/**
 * Subscribe to data changes. Returns the unsubscribe function.
 * Compatible with `useSyncExternalStore`.
 */
export function subscribeShadowData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Monotonic version. A primitive, so it is safe as a `useSyncExternalStore`
 * snapshot and as a `useMemo` dependency.
 */
export function getShadowVersion(): number {
  return snapshot.version;
}

/** Current snapshot. Identity is stable until the next change. */
export function getShadowOverlaySnapshot(): ShadowOverlaySnapshot {
  return snapshot;
}

/** Hand the current shadow polygons to the overlay registry. */
export function setShadowOverlayData(geojson: GeoJSON.FeatureCollection | null): void {
  commit({ geojson, tiles: null });
}

/** Hand a precomputed XYZ template to the overlay registry. */
export function setShadowOverlayTiles(tiles: string[] | null, tileSize = 512): void {
  commit({ tiles, tileSize, geojson: tiles ? null : snapshot.geojson });
}

export function setShadowOverlayOpacity(opacity: number): void {
  commit({ opacity: Math.max(0, Math.min(1, opacity)) });
}

/** Test-only: restore the initial state and drop subscribers. */
export function resetShadowOverlayStore(): void {
  snapshot = INITIAL;
  listeners.clear();
}

export function shadowOverlayDefinition(): ShadowOverlayDefinition {
  return {
    id: SHADOW_OVERLAY_ID,
    label: "Sun & shadow",
    group: "nature",
    kind: snapshot.tiles ? "raster" : "geojson",
    description:
      "Cast shadows for a chosen date and time. Buildings and terrain from DGM1/DOM1 and LoD2 (NRW: dl-de/zero-2-0).",
    attribution: {
      label: "Geobasis NRW · OpenStreetMap",
      url: "https://www.opengeodata.nrw.de/produkte/geobasis/hm/dgm1_tiff/dgm1_tiff/",
    },
    opacity: snapshot.opacity,
    minzoom: SHADOW_OVERLAY_MIN_ZOOM,
    timeAware: true,
    order: 40,
    resolve: (context) => {
      // Read the store at resolve time, so a version bump is enough to make
      // the next resolve return the new data.
      const current = snapshot;
      const opacity = context?.opacity ?? current.opacity;
      if (current.tiles && current.tiles.length > 0) {
        return {
          source: {
            type: "raster",
            tiles: [...current.tiles],
            tileSize: current.tileSize,
          },
          layers: [
            {
              type: "raster",
              paint: {
                "raster-opacity": opacity,
                "raster-fade-duration": 0,
                "raster-resampling": "linear",
              },
            },
          ],
        };
      }
      if (!current.geojson) return null;
      return {
        source: { type: "geojson", data: current.geojson },
        layers: [
          {
            type: "fill",
            paint: {
              "fill-color": "#0b1a33",
              "fill-opacity": opacity,
              "fill-antialias": true,
            },
          },
        ],
      };
    },
  };
}
