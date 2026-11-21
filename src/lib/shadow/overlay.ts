/**
 * Dock point for the generic overlay registry.
 *
 * The registry lives in `src/lib/overlays/**` and is built on a parallel
 * branch. This module deliberately does not import it: the definition below
 * is structurally compatible with `OverlayDefinition` there, so the whole
 * integration is one line in that branch's bootstrap:
 *
 *   import { registerOverlay } from "@/lib/overlays";
 *   import { shadowOverlayDefinition } from "@/lib/shadow/overlay";
 *   registerOverlay(shadowOverlayDefinition());
 *
 * Nothing in `src/lib/overlays/**` or `src/components/hud/BiospherePanel.tsx`
 * is touched. The panel needs a time control; it writes to
 * `setShadowOverlayData()` and the map re-resolves on the next render.
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

interface ShadowOverlayState {
  geojson: GeoJSON.FeatureCollection | null;
  tiles: string[] | null;
  tileSize: number;
  opacity: number;
}

const state: ShadowOverlayState = {
  geojson: null,
  tiles: null,
  tileSize: 512,
  opacity: 0.45,
};

/** Hand the current shadow polygons to the overlay registry. */
export function setShadowOverlayData(geojson: GeoJSON.FeatureCollection | null): void {
  state.geojson = geojson;
  state.tiles = null;
}

/** Hand a precomputed XYZ template to the overlay registry. */
export function setShadowOverlayTiles(tiles: string[] | null, tileSize = 512): void {
  state.tiles = tiles;
  state.tileSize = tileSize;
}

export function setShadowOverlayOpacity(opacity: number): void {
  state.opacity = Math.max(0, Math.min(1, opacity));
}

export function getShadowOverlayState(): Readonly<ShadowOverlayState> {
  return state;
}

export function shadowOverlayDefinition(): ShadowOverlayDefinition {
  return {
    id: SHADOW_OVERLAY_ID,
    label: "Sun & shadow",
    group: "nature",
    kind: "geojson",
    description:
      "Cast shadows for a chosen date and time. Buildings and terrain from DGM1/DOM1 and LoD2 (NRW: dl-de/zero-2-0).",
    attribution: {
      label: "Geobasis NRW · OpenStreetMap",
      url: "https://www.opengeodata.nrw.de/produkte/geobasis/hm/dgm1_tiff/dgm1_tiff/",
    },
    opacity: 0.45,
    minzoom: 14,
    timeAware: true,
    order: 40,
    resolve: (context) => {
      const opacity = context?.opacity ?? state.opacity;
      if (state.tiles && state.tiles.length > 0) {
        return {
          source: {
            type: "raster",
            tiles: state.tiles,
            tileSize: state.tileSize,
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
      if (!state.geojson) return null;
      return {
        source: { type: "geojson", data: state.geojson },
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
