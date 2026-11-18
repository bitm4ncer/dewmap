export const RAILWAY_MAX_ZOOM = 19;

export const RAILWAY_ATTRIBUTION =
  '<a href="https://www.openrailwaymap.org/" target="_blank" rel="noreferrer">OpenRailwayMap</a> · &copy; OpenStreetMap contributors (<a href="https://creativecommons.org/licenses/by-sa/2.0/" target="_blank" rel="noreferrer">CC-BY-SA</a>)';

export const RAILWAY_TILE_URLS: string[] = ["a", "b", "c"].map(
  (s) => `https://${s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png`,
);

/**
 * Public CARTO vector tiles (Protomaps basemap schema). They contain the
 * `roads` layer with `kind=rail` plus the `pois` layer with `kind=station`,
 * already generalized per zoom. CORS is enabled, so this works on raster
 * basemaps as well.
 *
 * Keep this version in sync with the CARTO style when it is refreshed.
 */
export const RAIL_VECTOR_TILE_URL =
  "https://tiles.basemaps.cartocdn.com/v/20261026-01/vectortiles/carto.streets/v2/{z}/{x}/{y}.mvt";
export const RAIL_VECTOR_MAX_ZOOM = 15;
export const RAIL_VECTOR_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';
export const RAIL_VECTOR_LINES_LAYER = "roads";
export const RAIL_VECTOR_STATIONS_LAYER = "pois";
