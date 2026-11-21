/**
 * Shadow map — public types.
 *
 * Everything here is plain data so the computation can run in the main
 * thread, a Web Worker or on a build machine. No MapLibre, no DOM.
 */

/**
 * `[west, south, east, north]` in WGS84 degrees.
 *
 * Convention: `west > east` means the bbox crosses the antimeridian and is
 * read as the short way round (from west eastwards across 180). Longitudes may
 * arrive outside [-180, 180); `normalizeBbox` wraps them. Bboxes wider than
 * 180 degrees and latitudes outside the Web Mercator range are rejected.
 */
export type Bbox = [west: number, south: number, east: number, north: number];

/** `[longitude, latitude]` in WGS84 degrees. */
export type LngLat = [lon: number, lat: number];

export interface SolarPosition {
  /** Degrees clockwise from true north. */
  azimuthDeg: number;
  /** Degrees above the horizon, including refraction. */
  elevationDeg: number;
  /** Degrees above the horizon, geometric (no refraction). */
  elevationGeometricDeg: number;
  /** Solar declination in degrees. */
  declinationDeg: number;
  /** Hour angle in degrees, negative before local solar noon. */
  hourAngleDeg: number;
  /** Equation of time in minutes. */
  equationOfTimeMin: number;
}

/**
 * A building footprint. The ring is a closed or open ring of lon/lat pairs;
 * the last point may repeat the first.
 */
export interface BuildingFootprint {
  id?: string | number;
  ring: LngLat[];
  /** Height above ground in metres. */
  heightM: number;
  /** Optional height of the underside (arcades, bridges). Unused for now. */
  minHeightM?: number;
}

/**
 * A regular elevation grid. Row 0 is the southern edge, columns run west to
 * east, matching the local metric frame used by the raster functions.
 */
export interface HeightField {
  bbox: Bbox;
  width: number;
  height: number;
  /** Metres. NaN marks nodata. */
  data: Float32Array;
}

export interface ShadowMask {
  /** Same convention as `Bbox`; columns run from `west` eastwards across the seam. */
  bbox: Bbox;
  width: number;
  height: number;
  /** Metres per cell. */
  resolutionM: number;
  /** 1 = in shadow, 0 = lit. Row 0 is the southern edge. */
  data: Uint8Array;
}

export type ShadowMode = "vector" | "raster";

export interface ShadowRequest {
  bbox: Bbox;
  /** Instant of interest. */
  time: Date;
  mode: ShadowMode;
  /** Required for `vector`; also used for `raster` when no terrain is given. */
  buildings?: BuildingFootprint[];
  /** Optional terrain grid. Buildings are added on top of it. */
  terrain?: HeightField;
  /** Raster cell size in metres. Defaults to 2. */
  resolutionM?: number;
  /**
   * Cap on the search distance for occluders in metres. Defaults to
   * `heightMax / tan(elevation)`, clamped to 1500 m.
   */
  maxDistanceM?: number;
  /** Sun position override (useful for tests). */
  sun?: SolarPosition;
}

export interface ShadowStats {
  buildingCount: number;
  /** Fraction of raster cells in shadow (raster mode only). */
  shadowFraction?: number;
  /** Number of shadow polygons (vector mode only). */
  polygonCount?: number;
  computeMs: number;
}

export interface ShadowResult {
  mode: ShadowMode;
  sun: SolarPosition;
  bbox: Bbox;
  /** Present in `vector` mode. Closed rings in lon/lat. */
  geojson?: GeoJSON.FeatureCollection<GeoJSON.Polygon, ShadowFeatureProperties>;
  /** Present in `raster` mode. */
  mask?: ShadowMask;
  stats: ShadowStats;
}

export interface ShadowFeatureProperties {
  /** Height of the casting building in metres. */
  heightM: number;
  /** Shadow length in metres on a horizontal plane. */
  lengthM: number;
}

export interface HorizonMap {
  bbox: Bbox;
  width: number;
  height: number;
  resolutionM: number;
  /** Number of compass directions, evenly spaced from 0 to 360. */
  directions: number;
  /** Horizon elevation in radians, `directions` values per cell. */
  data: Float32Array;
}
