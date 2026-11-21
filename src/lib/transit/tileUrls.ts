/** VPS-hosted transit tiles. Version data filenames when their content changes. */
export const TRANSIT_TILES_BASE = "https://data.dewmap.app/tiles";
export const TRANSIT_LINES_FILE = "transit-lines-v7.pmtiles";
export const TRANSIT_STOPS_FILE = "transit-stops-v3.pmtiles";

export function transitTileUrl(file: string): string {
  return `pmtiles://${TRANSIT_TILES_BASE}/${file}`;
}
