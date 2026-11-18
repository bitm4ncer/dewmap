/**
 * OpenFreeMap vector tiles (OpenMapTiles schema). The transportation layer
 * carries `class=rail` and `class=transit` at low and high zooms; railway
 * stations live in the `poi` layer (`class=railway`, `subclass=station`).
 * The TileJSON URL tracks OpenFreeMap's current planet build, so no tile
 * version has to be pinned in the app.
 */
export const RAIL_VECTOR_TILEJSON_URL = "https://tiles.openfreemap.org/planet";
export const RAIL_VECTOR_MAX_ZOOM = 14;
export const RAIL_VECTOR_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · &copy; OpenStreetMap contributors';
export const RAIL_VECTOR_LINES_LAYER = "transportation";
export const RAIL_VECTOR_STATIONS_LAYER = "poi";
