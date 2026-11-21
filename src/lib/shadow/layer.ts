/**
 * MapLibre GL glue.
 *
 * Self-contained: a caller with a `Map` instance adds/updates/removes the
 * shadow layer without touching `Map.tsx`. The functions are idempotent, so
 * the same call can run on every React render.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import type { ShadowResult } from "./types";
import { shadowAttribution } from "./attribution";

export const SHADOW_SOURCE_ID = "shadow-cast-src";
export const SHADOW_LAYER_ID = "shadow-cast";
export const SHADOW_RASTER_SOURCE_ID = "shadow-raster-src";
export const SHADOW_RASTER_LAYER_ID = "shadow-raster";
/** Below this zoom the raster mask is sub-pixel at 8 m and not worth a fetch. */
export const SHADOW_MIN_ZOOM = 14;

export const SHADOW_FILL_COLOR = "#0b1a33";

export interface ShadowLayerOptions {
  opacity?: number;
  color?: string;
  /** Insert the layer below this layer id. */
  beforeId?: string;
  /** Defaults to `SHADOW_MIN_ZOOM`. */
  minzoom?: number;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Add or replace the shadow polygons. Safe to call repeatedly. */
export function applyShadowLayer(
  map: MapLibreMap,
  result: ShadowResult | null,
  options: ShadowLayerOptions = {},
): void {
  const geojson = result?.geojson ?? EMPTY;
  const existing = map.getSource(SHADOW_SOURCE_ID);
  if (existing && "setData" in existing) {
    (existing as { setData: (data: GeoJSON.FeatureCollection) => void }).setData(geojson);
  } else {
    map.addSource(SHADOW_SOURCE_ID, { type: "geojson", data: geojson });
  }

  if (!map.getLayer(SHADOW_LAYER_ID)) {
    map.addLayer(
      {
        id: SHADOW_LAYER_ID,
        type: "fill",
        source: SHADOW_SOURCE_ID,
        minzoom: options.minzoom ?? SHADOW_MIN_ZOOM,
        paint: {
          "fill-color": options.color ?? SHADOW_FILL_COLOR,
          "fill-opacity": options.opacity ?? 0.45,
          "fill-antialias": true,
        },
      },
      options.beforeId,
    );
  } else {
    if (options.opacity !== undefined) {
      map.setPaintProperty(SHADOW_LAYER_ID, "fill-opacity", options.opacity);
    }
    if (options.color !== undefined) {
      map.setPaintProperty(SHADOW_LAYER_ID, "fill-color", options.color);
    }
  }
}

export function setShadowOpacity(map: MapLibreMap, opacity: number): void {
  if (map.getLayer(SHADOW_LAYER_ID)) {
    map.setPaintProperty(SHADOW_LAYER_ID, "fill-opacity", opacity);
  }
  if (map.getLayer(SHADOW_RASTER_LAYER_ID)) {
    map.setPaintProperty(SHADOW_RASTER_LAYER_ID, "raster-opacity", opacity);
  }
}

export function removeShadowLayer(map: MapLibreMap): void {
  if (map.getLayer(SHADOW_LAYER_ID)) map.removeLayer(SHADOW_LAYER_ID);
  if (map.getSource(SHADOW_SOURCE_ID)) map.removeSource(SHADOW_SOURCE_ID);
  if (map.getLayer(SHADOW_RASTER_LAYER_ID)) map.removeLayer(SHADOW_RASTER_LAYER_ID);
  if (map.getSource(SHADOW_RASTER_SOURCE_ID)) map.removeSource(SHADOW_RASTER_SOURCE_ID);
}

export interface ShadowRasterOptions extends ShadowLayerOptions {
  /** XYZ template, e.g. `https://tiles.example/shadow/{z}/{x}/{y}.png`. */
  tiles: string[];
  tileSize?: number;
  /** Keys into `SHADOW_SOURCES`; drives the attribution line. */
  sourceIds?: string[];
}

/** Add a precomputed shadow raster (server tiles) instead of polygons. */
export function applyShadowRaster(map: MapLibreMap, options: ShadowRasterOptions): void {
  const attribution =
    options.sourceIds && options.sourceIds.length > 0
      ? shadowAttribution(options.sourceIds)
      : shadowAttribution(["nrwDgm1"]);
  const source = map.getSource(SHADOW_RASTER_SOURCE_ID);
  if (!source) {
    map.addSource(SHADOW_RASTER_SOURCE_ID, {
      type: "raster",
      tiles: options.tiles,
      tileSize: options.tileSize ?? 512,
      attribution,
    });
  }
  if (!map.getLayer(SHADOW_RASTER_LAYER_ID)) {
    map.addLayer(
      {
        id: SHADOW_RASTER_LAYER_ID,
        type: "raster",
        source: SHADOW_RASTER_SOURCE_ID,
        minzoom: options.minzoom ?? SHADOW_MIN_ZOOM,
        paint: {
          "raster-opacity": options.opacity ?? 0.55,
          "raster-fade-duration": 0,
          "raster-resampling": "linear",
        },
      },
      options.beforeId,
    );
  }
}
