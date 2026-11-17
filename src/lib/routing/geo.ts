/** Small geodesy helpers used for BRouter's geometry-derived maneuvers. */

const EARTH_RADIUS_M = 6_371_000;

type Coord = readonly [number, number, number?];

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in metres between two `[lon, lat]` points. */
export function haversineM(a: Coord, b: Coord): number {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = toRadians(b[1] - a[1]);
  const dLon = toRadians(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees clockwise from north (0..360). */
export function bearingDeg(a: Coord, b: Coord): number {
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLon = toRadians(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Normalize an angle difference into (-180, 180]. Positive = clockwise. */
export function normalizeBearingDelta(degrees: number): number {
  const wrapped = (((degrees + 180) % 360) + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}

/** Cumulative distance in metres at every vertex; `[0]` is always zero. */
export function cumulativeDistances(coords: readonly Coord[]): number[] {
  const result: number[] = new Array(coords.length);
  result[0] = 0;
  for (let i = 1; i < coords.length; i++) {
    result[i] = result[i - 1] + haversineM(coords[i - 1], coords[i]);
  }
  return result;
}

const COMPASS = [
  "north",
  "northeast",
  "east",
  "southeast",
  "south",
  "southwest",
  "west",
  "northwest",
] as const;

/** Coarse 8-point compass label for a bearing. */
export function compassDirection(bearing: number): string {
  const normalized = ((bearing % 360) + 360) % 360;
  return COMPASS[Math.round(normalized / 45) % 8];
}
