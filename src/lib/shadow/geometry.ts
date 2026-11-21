/**
 * Local planar geometry for shadow casting.
 *
 * At city scale (< ~50 km) an equirectangular projection around the bbox
 * centre is accurate to well under a metre: the scale error is
 * `1 - cos(dLat)` ~ 1e-7 per km. That is far below the 1 m raster.
 */
import type { Bbox, BuildingFootprint, LngLat, SolarPosition } from "./types";
import { shadowLengthMeters } from "./sun";

const RAD = Math.PI / 180;
const EARTH_RADIUS_M = 6_371_008.8;

/** Web Mercator's latitude limit; frames and tiles are only valid inside it. */
export const MAX_FRAME_LAT = 85.05112878;

/** Wrap a longitude into [-180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Shortest signed difference `to - from`, in [-180, 180). */
export function lonDelta(from: number, to: number): number {
  return (((to - from + 540) % 360) + 360) % 360 - 180;
}

/**
 * Validate and normalise a bbox.
 *
 * Convention: `west > east` means the box crosses the antimeridian; it is then
 * read as the short way round. Both longitudes may arrive outside [-180, 180)
 * (MapLibre's `getBounds()` does that when the viewport is panned across the
 * seam); they are wrapped here.
 *
 * Rejected with `RangeError`: non-finite coordinates, `south > north`, a
 * latitude outside the Web Mercator range, and a longitude span above 180
 * degrees (the planar frame cannot represent it).
 */
export function normalizeBbox(bbox: Bbox): Bbox {
  const [west, south, east, north] = bbox;
  if (![west, south, east, north].every((value) => Number.isFinite(value))) {
    throw new RangeError("bbox coordinates must be finite");
  }
  if (south > north) {
    throw new RangeError(`bbox south ${south} is north of north ${north}`);
  }
  if (south < -MAX_FRAME_LAT - 1e-9 || north > MAX_FRAME_LAT + 1e-9) {
    throw new RangeError(
      `bbox latitude ${south}..${north} is outside the Web Mercator range +/-${MAX_FRAME_LAT}`,
    );
  }
  const rawSpan = east - west;
  if (rawSpan >= 360 || rawSpan <= -360) {
    throw new RangeError(
      `bbox spans ${rawSpan} degrees of longitude; the whole world is not a supported shadow window`,
    );
  }
  const span = (((rawSpan % 360) + 360) % 360);
  if (span > 180) {
    throw new RangeError(
      `bbox spans ${span.toFixed(1)} degrees of longitude; the planar frame supports at most 180`,
    );
  }
  return [normalizeLon(west), south, normalizeLon(east), north];
}

/** Eastward longitude span of a (possibly crossing) bbox, in degrees. */
export function lonSpanDeg(bbox: Bbox): number {
  const [west, , east] = bbox;
  return (((east - west) % 360) + 360) % 360;
}

/**
 * Position of a longitude inside a bbox as 0..1, or `null` when it is outside.
 * Handles crossing bboxes; the bbox is expected to be normalised.
 */
export function lonFraction(bbox: Bbox, lon: number): number | null {
  const span = lonSpanDeg(bbox);
  if (span === 0) {
    return Math.abs(lonDelta(bbox[0], lon)) < 1e-9 ? 0 : null;
  }
  const delta = lonDelta(bbox[0], lon);
  if (delta < 0 || delta > span) return null;
  return delta / span;
}

export interface LocalFrame {
  lon0: number;
  lat0: number;
  /** Metres per degree of longitude at `lat0`. */
  mPerDegLon: number;
  /** Metres per degree of latitude at `lat0`. */
  mPerDegLat: number;
  project(point: LngLat): [x: number, y: number];
  unproject(point: [number, number]): LngLat;
}

/**
 * Planar frame around a bbox.
 *
 * The frame is exact at its centre and drifts by `tan(lat0) * dLat` across
 * the box: 0.02 % per km at 51 deg, i.e. ~0.4 m over 2 km and ~500 m over
 * 50 km. It is meant for viewports of a few kilometres, not for countries.
 * Longitudes are handled modulo 360, so a bbox that crosses the antimeridian
 * works; latitudes are clamped to the Web Mercator limit.
 */
export function localFrame(bbox: Bbox): LocalFrame {
  const [west, south, east, north] = normalizeBbox(bbox);
  const crosses = east < west;
  const span = crosses ? east + 360 - west : east - west;
  const lon0 = normalizeLon(west + span / 2);
  const lat0 = (south + north) / 2;
  const mPerDegLat = EARTH_RADIUS_M * RAD;
  const mPerDegLon = mPerDegLat * Math.cos(lat0 * RAD);
  return {
    lon0,
    lat0,
    mPerDegLon,
    mPerDegLat,
    project: ([lon, lat]) => [lonDelta(lon0, lon) * mPerDegLon, (lat - lat0) * mPerDegLat],
    unproject: ([x, y]) => [normalizeLon(lon0 + x / mPerDegLon), lat0 + y / mPerDegLat],
  };
}

/**
 * Metric size of a bbox. Validation is the same as `normalizeBbox`, so a box
 * wider than 180 degrees throws instead of producing a meaningless number.
 */
export function bboxSpanM(bbox: Bbox, frame: LocalFrame): { x: number; y: number } {
  const [, south, , north] = normalizeBbox(bbox);
  return {
    x: lonSpanDeg(bbox) * frame.mPerDegLon,
    y: (north - south) * frame.mPerDegLat,
  };
}

/** Horizontal offset of the shadow tip, away from the sun. */
export function shadowOffset(
  heightM: number,
  sun: Pick<SolarPosition, "azimuthDeg" | "elevationDeg">,
): { x: number; y: number; lengthM: number } {
  const lengthM = shadowLengthMeters(heightM, sun.elevationDeg);
  if (!Number.isFinite(lengthM)) return { x: 0, y: 0, lengthM };
  const az = sun.azimuthDeg * RAD;
  // The sun is at azimuth az; the shadow falls towards az + 180.
  return {
    x: -Math.sin(az) * lengthM,
    y: -Math.cos(az) * lengthM,
    lengthM,
  };
}

/** Andrew's monotone chain. Returns counter-clockwise points, no duplicates. */
export function convexHull(points: [number, number][]): [number, number][] {
  if (points.length <= 3) return dedupe(points);
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  return dedupe(hull);
}

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function dedupe(points: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
  }
  return out;
}

/**
 * Approximate cast shadow of one footprint: the convex hull of the footprint
 * and the same footprint translated to the shadow tip.
 *
 * Exact for convex footprints. For U- or courtyard-shaped buildings it fills
 * the concavity, which is why the raster path exists. In the Düsseldorf test
 * the hull version reached IoU 0.74-0.91 against the ray-marched mask, with
 * the error concentrated in courtyards.
 */
export function projectFootprint(
  ring: LngLat[],
  heightM: number,
  sun: Pick<SolarPosition, "azimuthDeg" | "elevationDeg">,
  frame: LocalFrame,
): { ring: LngLat[]; lengthM: number } {
  const offset = shadowOffset(heightM, sun);
  if (!Number.isFinite(offset.lengthM)) return { ring, lengthM: offset.lengthM };
  const pts: [number, number][] = [];
  for (const point of ring) {
    const [x, y] = frame.project(point);
    pts.push([x, y]);
    if (offset.lengthM > 1e-6) pts.push([x + offset.x, y + offset.y]);
  }
  const hull = convexHull(pts).map((p) => frame.unproject(p));
  if (hull.length >= 3) {
    const first = hull[0];
    const last = hull[hull.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) hull.push([first[0], first[1]]);
  }
  return { ring: hull, lengthM: offset.lengthM };
}

/**
 * Exact swept footprint (no hull): the footprint, its translation and one
 * quad per edge. Each piece is a separate polygon, so a renderer that cannot
 * union them must composite them without stacking alpha.
 */
export function sweptFootprint(
  ring: LngLat[],
  heightM: number,
  sun: Pick<SolarPosition, "azimuthDeg" | "elevationDeg">,
  frame: LocalFrame,
): { polygons: LngLat[][]; lengthM: number } {
  const offset = shadowOffset(heightM, sun);
  const base = closeRing(ring);
  if (!Number.isFinite(offset.lengthM) || offset.lengthM <= 1e-6) {
    return { polygons: [base], lengthM: offset.lengthM };
  }
  const moved = base.map(([lon, lat]) => {
    const [x, y] = frame.project([lon, lat]);
    return frame.unproject([x + offset.x, y + offset.y]);
  });
  const polygons: LngLat[][] = [base, moved];
  for (let i = 0; i + 1 < base.length; i++) {
    polygons.push(closeRing([base[i], base[i + 1], moved[i + 1], moved[i]]));
  }
  return { polygons, lengthM: offset.lengthM };
}

export function closeRing(ring: LngLat[]): LngLat[] {
  if (ring.length < 3) return ring.slice();
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring.slice();
  return [...ring, [first[0], first[1]]];
}

/** Planar polygon area in m^2 after projection. */
export function polygonAreaM2(ring: LngLat[], frame: LocalFrame): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = frame.project(ring[i]);
    const [x2, y2] = frame.project(ring[(i + 1) % ring.length]);
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

/** Bounding box of a lon/lat ring. */
export function ringBbox(ring: LngLat[]): Bbox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}

/** Bbox with a margin in metres, clamped to the Web Mercator latitude range. */
export function expandBboxM(bbox: Bbox, marginM: number): Bbox {
  const [west, south, east, north] = bbox;
  const lat0 = (south + north) / 2;
  if (!Number.isFinite(lat0) || Math.abs(lat0) > MAX_FRAME_LAT) {
    throw new RangeError(
      `bbox centre latitude ${lat0} is outside the Web Mercator range +/-${MAX_FRAME_LAT}`,
    );
  }
  const dLat = marginM / (EARTH_RADIUS_M * RAD);
  const dLon = dLat / Math.max(1e-6, Math.cos(lat0 * RAD));
  const w = normalizeLon(west - dLon);
  const e = normalizeLon(east + dLon);
  return [
    w,
    Math.max(-MAX_FRAME_LAT, south - dLat),
    e,
    Math.min(MAX_FRAME_LAT, north + dLat),
  ];
}

/** Heights used for a building, following the documented fallback chain. */
export const DEFAULT_BUILDING_HEIGHT_M = 10;
export const METRES_PER_LEVEL = 3.2;
export const ROOF_ALLOWANCE_M = 1;

/**
 * Height from OSM-style tags. The fallback chain is deliberate:
 * explicit height, then levels, then a city-block default.
 */
export function buildingHeightFromTags(
  tags: Record<string, string | undefined> | undefined,
  fallbackM = DEFAULT_BUILDING_HEIGHT_M,
): { heightM: number; source: "height" | "levels" | "fallback" } {
  const raw = tags?.height ?? tags?.["building:height"];
  if (raw) {
    const value = Number.parseFloat(String(raw).replace(",", "."));
    if (Number.isFinite(value) && value > 0) return { heightM: value, source: "height" };
  }
  const levels = Number.parseFloat(String(tags?.["building:levels"] ?? "").replace(",", "."));
  if (Number.isFinite(levels) && levels > 0) {
    return {
      heightM: levels * METRES_PER_LEVEL + ROOF_ALLOWANCE_M,
      source: "levels",
    };
  }
  return { heightM: fallbackM, source: "fallback" };
}

/** Convenience: bbox around a point, `radiusM` on every side. */
export function bboxAround(lon: number, lat: number, radiusM: number): Bbox {
  return expandBboxM([lon, lat, lon, lat], radiusM);
}

export function isBuildingUsable(building: BuildingFootprint): boolean {
  return (
    Array.isArray(building.ring) &&
    building.ring.length >= 3 &&
    Number.isFinite(building.heightM) &&
    building.heightM > 0
  );
}
