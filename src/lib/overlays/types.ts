/**
 * Overlay framework — shared types.
 *
 * An overlay is a declarative description of one map layer: where its data
 * comes from, how it is painted, when it is allowed to be visible and what
 * the panel says about it. The map itself is only touched in
 * `src/lib/overlays/apply.ts`; everything else is data.
 *
 * The registry is intentionally open for other feature modules (live
 * vehicles, a future shadow layer, …): anything that can express itself as
 * a source plus a handful of paint layers can register here.
 */

/** Panel grouping. Unknown strings are allowed so modules can add groups. */
export type OverlayGroup = "weather" | "water" | "air" | "biology" | (string & {});

export type OverlayKind = "raster" | "vector" | "geojson";

export interface OverlayAttribution {
  label: string;
  /** Compact form for the on-map credit line, e.g. "DWD". */
  short?: string;
  url?: string;
}

export type LngLatCorners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

export type OverlaySource =
  | {
      /** Single georeferenced image (a WMS render, a radar frame, …). */
      type: "image";
      url: string;
      coordinates: LngLatCorners;
    }
  | {
      /** XYZ/WMTS raster tile template. */
      type: "raster";
      tiles: string[];
      tileSize?: number;
    }
  | {
      type: "geojson";
      data: GeoJSON.FeatureCollection | GeoJSON.Feature | GeoJSON.Geometry;
    };

export type OverlayLayerType = "raster" | "fill" | "line" | "circle" | "symbol";

export interface OverlayLayer {
  type: OverlayLayerType;
  paint?: Record<string, unknown>;
  layout?: Record<string, unknown>;
  filter?: unknown[];
  minzoom?: number;
  maxzoom?: number;
}

export interface ResolvedOverlay {
  source: OverlaySource;
  layers: OverlayLayer[];
}

export interface RadarFrame {
  slot: string;
  time: string;
  kind: "analysis" | "forecast";
  url: string;
}

export interface RadarImage {
  width: number;
  height: number;
  bounds: [number, number, number, number];
}

export interface WarningAreaProperties {
  cellId: string;
  level: number;
  count: number;
  label: string;
  event: string;
  headline: string;
  area: string;
  from: string | null;
  to: string | null;
}

export interface WarningAreaCollection extends GeoJSON.FeatureCollection {
  features: GeoJSON.Feature<GeoJSON.Geometry, WarningAreaProperties>[];
}

export interface OverlayContext {
  opacity: number;
  radar: {
    frames: RadarFrame[];
    index: number;
    image: RadarImage;
  } | null;
  warnings: WarningAreaCollection | null;
}

export interface OverlayDefinition {
  /** Stable id. Also the source-layer prefix on the map. */
  id: string;
  label: string;
  group: OverlayGroup;
  kind: OverlayKind;
  /** One sentence for the panel. */
  description: string;
  attribution: OverlayAttribution;
  /** Default opacity, 0..1. */
  opacity: number;
  minzoom?: number;
  maxzoom?: number;
  timeAware: boolean;
  /** Panel + stacking order. Higher sits closer to the top. */
  order: number;
  /** Build a short popup body for a tapped feature. */
  popup?: (properties: Record<string, unknown>) => string;
  /** Everything time- and state-dependent lives here. */
  resolve: (ctx: OverlayContext) => ResolvedOverlay | null;
}
