/**
 * Web Mercator tile helpers for delivering shadow rasters.
 *
 * A shadow raster tile is a normal XYZ tile with 1 bit per pixel. The same
 * grid can be served from a static bucket, so the VPS only needs nginx/Caddy
 * and no compute at request time.
 */
import type { Bbox } from "./types";
import { normalizeBbox } from "./geometry";

export const WEB_MERCATOR_MAX_LAT = 85.05112878;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** Fractional tile coordinates. `lon = 180` yields exactly `x = 2^z`; wrap it. */
export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-WEB_MERCATOR_MAX_LAT, Math.min(WEB_MERCATOR_MAX_LAT, lat));
  const x = ((lon + 180) / 360) * n;
  const sin = Math.sin((clampedLat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n;
  return { x, y };
}

export function tileBounds(tile: TileCoord): Bbox {
  const n = 2 ** tile.z;
  const west = (tile.x / n) * 360 - 180;
  const east = ((tile.x + 1) / n) * 360 - 180;
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * tile.y) / n))) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (tile.y + 1)) / n))) * 180) / Math.PI;
  return [west, south, east, north];
}

/** Ground resolution of a tile at a latitude, in metres per pixel. */
export function tileResolutionM(z: number, lat: number, tileSize = 256): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / (tileSize * 2 ** z);
}

/**
 * All XYZ tiles covering a bbox.
 *
 * `west > east` means the bbox crosses the antimeridian; it is split into
 * two ranges that wrap around x. Latitudes are clamped to the Web Mercator
 * limit, and x is taken modulo the zoom's tile count, so no tile index falls
 * outside `[0, 2^z)`.
 */
export function tilesForBbox(bbox: Bbox, z: number): TileCoord[] {
  const [west, south, east, north] = normalizeBbox(bbox);
  const n = 2 ** z;
  const topLeft = lonLatToTile(west, north, z);
  const bottomRight = lonLatToTile(east, south, z);
  const x0 = Math.floor(topLeft.x);
  let x1 = Math.floor(bottomRight.x);
  const crossing = east < west;
  if (crossing) {
    // Crossing: the eastern end is numerically smaller; walk forward.
    x1 += n;
  } else {
    // Defensive: lon = 180 would yield x = n; the bbox ends on the last tile.
    x1 = Math.min(x1, n - 1);
  }
  if (x1 < x0) return [];
  const y0 = Math.max(0, Math.floor(topLeft.y));
  const y1 = Math.min(n - 1, Math.floor(bottomRight.y));
  const tiles: TileCoord[] = [];
  for (let x = x0; x <= x1; x++) {
    const wrapped = ((x % n) + n) % n;
    for (let y = y0; y <= y1; y++) {
      tiles.push({ z, x: wrapped, y });
    }
  }
  return tiles;
}

/**
 * Raster resolution to use for a map zoom. One output cell per screen pixel
 * at 1x is the upper bound; below z15 shadows are sub-pixel anyway, so they
 * are not drawn (see `SHADOW_MIN_ZOOM`).
 */
export function resolutionForZoom(zoom: number, lat: number): number {
  const metresPerPixel = tileResolutionM(zoom, lat);
  if (metresPerPixel <= 1) return 1;
  if (metresPerPixel <= 2) return 2;
  if (metresPerPixel <= 4) return 4;
  return 8;
}

/** `{z}/{x}/{y}` template with the usual TMS option. */
export function shadowTileUrl(
  template: string,
  tile: TileCoord,
  tms = false,
): string {
  const y = tms ? 2 ** tile.z - 1 - tile.y : tile.y;
  return template
    .replace("{z}", String(tile.z))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(y));
}
