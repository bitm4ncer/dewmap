/**
 * Dock point for the generic overlay registry.
 *
 * The registry lives in `src/lib/overlays/**`. This module deliberately does
 * not import it: the definition below is structurally compatible with
 * `OverlayDefinition` there, and `register.ts` is the one file that connects
 * the two.
 *
 * Wiring is three lines in the app:
 *
 *   import { registerShadowOverlay } from "@/lib/shadow/register";
 *   registerShadowOverlay();                            // in useOverlayLayers
 *   const shadowVersion = useShadowOverlayVersion();    // + one dependency
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
import { SHADOW_SOURCES, shadowAttribution, type ShadowSource } from "./attribution";
import { PILOT_SOURCE_IDS } from "./pilot";
import type { Bbox } from "./types";

export type ShadowOverlaySource =
  | { type: "geojson"; data: GeoJSON.FeatureCollection }
  | { type: "raster"; tiles: string[]; tileSize?: number }
  | {
      /** One georeferenced image, e.g. a rendered shadow PNG for the viewport. */
      type: "image";
      url: string;
      coordinates: [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ];
    };

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
export const SHADOW_OVERLAY_DEFAULT_OPACITY = 0.5;

export interface ShadowOverlayImage {
  /** Data URL or blob URL of the rendered shadow PNG. */
  url: string;
  /** Geographic extent of the image, `[west, south, east, north]`. */
  bbox: Bbox;
}

export interface ShadowOverlaySnapshot {
  readonly version: number;
  readonly geojson: GeoJSON.FeatureCollection | null;
  readonly tiles: readonly string[] | null;
  readonly tileSize: number;
  readonly image: ShadowOverlayImage | null;
  readonly opacity: number;
  /** Keys into `SHADOW_SOURCES` used for the attribution line. */
  readonly sourceIds: readonly string[];
}

const INITIAL: ShadowOverlaySnapshot = {
  version: 0,
  geojson: null,
  tiles: null,
  tileSize: 512,
  image: null,
  opacity: SHADOW_OVERLAY_DEFAULT_OPACITY,
  sourceIds: PILOT_SOURCE_IDS,
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
  commit({ geojson, tiles: null, image: null });
}

/** Hand a precomputed XYZ template to the overlay registry. */
export function setShadowOverlayTiles(tiles: string[] | null, tileSize = 512): void {
  commit({ tiles, tileSize, geojson: tiles ? null : snapshot.geojson, image: null });
}

/**
 * Hand a single rendered PNG for one bbox to the overlay registry.
 *
 * This is what the pilot uses: the worker ray-marches into a mask, encodes it
 * as PNG off the main thread and posts a data URL. The map then treats it as a
 * georeferenced image, which costs no main-thread geometry work at all.
 */
export function setShadowOverlayImage(image: ShadowOverlayImage | null): void {
  commit({ image, geojson: null, tiles: null });
}

export function setShadowOverlayOpacity(opacity: number): void {
  commit({ opacity: Math.max(0, Math.min(1, opacity)) });
}

/** Choose which data sources appear in the attribution line. */
export function setShadowOverlaySources(sourceIds: string[]): void {
  commit({ sourceIds: [...sourceIds] });
}

/** Test-only: restore the initial state and drop subscribers. */
export function resetShadowOverlayStore(): void {
  snapshot = INITIAL;
  listeners.clear();
}

export function shadowOverlayDefinition(): ShadowOverlayDefinition {
  const definition: ShadowOverlayDefinition = {
    id: SHADOW_OVERLAY_ID,
    label: "Shadows",
    group: "nature",
    description:
      "Cast building shadows for the chosen time. Düsseldorf pilot, LoD1 block models, buildings only. Geobasis NRW, dl-de/zero-2.0.",
    minzoom: SHADOW_OVERLAY_MIN_ZOOM,
    timeAware: true,
    order: 40,
    // Getters, not frozen values: the registry stores this object once, so
    // `kind`, `attribution` and `opacity` must follow the store after tiles,
    // sources or opacity change. A plain property would stay at its
    // bootstrap value for the lifetime of the registry entry.
    get kind() {
      return snapshot.tiles || snapshot.image
        ? ("raster" as const)
        : ("geojson" as const);
    },
    get attribution() {
      const sources = snapshot.sourceIds
        .map((id) => SHADOW_SOURCES[id])
        .filter((source): source is ShadowSource => Boolean(source));
      return {
        label: shadowAttribution(snapshot.sourceIds),
        url: sources[0]?.url,
      };
    },
    get opacity() {
      return snapshot.opacity;
    },
    resolve: (context) => {
      // Read the store at resolve time, so a version bump is enough to make
      // the next resolve return the new data.
      const current = snapshot;
      const opacity = context?.opacity ?? current.opacity;
      if (current.image) {
        const [west, south, east, north] = current.image.bbox;
        return {
          source: {
            type: "image",
            url: current.image.url,
            // MapLibre expects top-left, top-right, bottom-right, bottom-left.
            coordinates: [
              [west, north],
              [east, north],
              [east, south],
              [west, south],
            ],
          },
          layers: [
            {
              type: "raster",
              minzoom: SHADOW_OVERLAY_MIN_ZOOM,
              paint: {
                "raster-opacity": opacity,
                "raster-fade-duration": 0,
                "raster-resampling": "linear",
              },
            },
          ],
        };
      }
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
  return definition;
}
