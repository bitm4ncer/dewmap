/**
 * Shared constants for the Düsseldorf shadow pilot pipeline.
 *
 * The pilot deliberately covers one city bounding box, not NRW: LoD1 is
 * ~6.8 MB per 1 km tile and NRW has 35 022 of them (91.8 GB).
 */

/** Pilot area: Düsseldorf incl. the Rhine bend, WGS84. */
export const PILOT_BBOX = [6.68, 51.14, 6.92, 51.34];

/** OpenGeodata NRW, 3D-Gebäudemodelle LoD1, single tiles (CityGML). */
export const LOD1_INDEX_URL =
  "https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod1_gml/lod1_gml/";
export const LOD1_FILE_BASE =
  "https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod1_gml/lod1_gml/";

/** Working directory for raw data and intermediate artifacts (not committed). */
export const WORK_DIR = process.env.SHADOW_WORK_DIR ?? "/tmp/opencode/shadow-pilot";

/** Versioned artifact name. Bump when the extraction rules change. */
export const ARTIFACT = "buildings-duesseldorf-v1";

export const LAYER_NAME = "buildings";
export const MIN_ZOOM = 12;
export const MAX_ZOOM = 16;

/** Tiling/extraction rules, quoted in the spec and enforced in the scripts. */
export const RULES = {
  /** Drop everything below this measured height (garden sheds, walls). */
  minHeightM: 2,
  /** LoD1 outliers above this are data errors, not towers. */
  maxHeightM: 300,
  /** Footprints below this area are not worth a shadow at 4 m. */
  minAreaM2: 1,
  /** Douglas-Peucker tolerance on the footprint ring, metres. */
  simplifyToleranceM: 0.5,
  /** Coordinate precision in the GeoJSON output (7 decimals ≈ 1 cm). */
  coordDecimals: 7,
};
