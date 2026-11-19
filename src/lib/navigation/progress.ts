/**
 * Route progress + off-route detection for turn-by-turn navigation.
 *
 * Works on any normalized `RoutePlan`: car maneuvers, transit legs, or the
 * geometry-derived maneuvers produced for BRouter hike/bike plans.
 */

import type { Maneuver, RoutePlan } from "../routing";
import { bearingDeg, cumulativeDistances } from "../routing/geo";

export interface RouteProgress {
  /** Nearest segment index (start vertex). */
  index: number;
  /** Closest point on the route, `[lon, lat]`. */
  snapped: [number, number];
  /** Perpendicular distance to the route in metres. */
  distanceToRouteM: number;
  /** Distance already travelled along the route in metres. */
  travelledM: number;
  /** Distance remaining along the route in metres. */
  remainingM: number;
  /** Estimated minutes remaining. */
  remainingMin: number;
  /** Fraction 0..1. */
  fraction: number;
  /** Next maneuver, or null when the destination is next. */
  next: Maneuver | null;
  /** Distance from the snapped position to the next maneuver, metres. */
  nextDistanceM: number;
  /** Bearing of the route segment under the position, degrees clockwise.
   *  Far more stable than raw GPS heading at walking speed, so the
   *  camera uses this as its course-up source of truth. */
  courseBearing: number;
}

type Coord = readonly [number, number, number?];

function metresPerDegree(lat: number): { x: number; y: number } {
  const rad = (lat * Math.PI) / 180;
  return {
    x: (Math.PI / 180) * 6_371_000 * Math.cos(rad),
    y: (Math.PI / 180) * 6_371_000,
  };
}

function projectionOnSegment(
  p: Coord,
  a: Coord,
  b: Coord,
): { t: number; distanceM: number; point: [number, number] } {
  const scale = metresPerDegree(p[1]);
  const ax = (a[0] - p[0]) * scale.x;
  const ay = (a[1] - p[1]) * scale.y;
  const bx = (b[0] - p[0]) * scale.x;
  const by = (b[1] - p[1]) * scale.y;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 <= 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return {
    t,
    distanceM: Math.hypot(cx, cy),
    point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
  };
}

export function computeRouteProgress(
  plan: RoutePlan,
  position: { lon: number; lat: number },
): RouteProgress | null {
  const coords = plan.coordinates;
  if (coords.length < 2) return null;
  const p: Coord = [position.lon, position.lat];
  const cum = cumulativeDistances(coords);

  let best: { index: number; t: number; distanceM: number; point: [number, number] } | null =
    null;
  for (let i = 0; i < coords.length - 1; i += 1) {
    const proj = projectionOnSegment(p, coords[i], coords[i + 1]);
    if (best == null || proj.distanceM < best.distanceM) {
      best = { index: i, t: proj.t, distanceM: proj.distanceM, point: proj.point };
    }
  }
  if (!best) return null;

  const segmentM = cum[best.index + 1] - cum[best.index];
  const travelledM = cum[best.index] + best.t * segmentM;
  const totalM = Math.max(1, cum[cum.length - 1]);
  const remainingM = Math.max(0, totalM - travelledM);
  const fraction = Math.min(1, Math.max(0, travelledM / totalM));

  // Include a maneuver that starts on the current segment; the old
  // `> index + 1` check skipped the first leg and the first instruction.
  const next =
    plan.maneuvers.find((m) => m.type !== "arrive" && m.endIndex > best.index) ??
    plan.maneuvers.find((m) => m.type === "arrive") ??
    null;

  const nextDistanceM = next
    ? Math.max(0, cum[Math.min(next.startIndex, coords.length - 1)] - travelledM)
    : remainingM;

  return {
    index: best.index,
    snapped: best.point,
    distanceToRouteM: best.distanceM,
    travelledM,
    remainingM,
    remainingMin: (remainingM / totalM) * plan.durationMin,
    fraction,
    next,
    nextDistanceM,
    courseBearing: bearingDeg(coords[best.index], coords[best.index + 1]),
  };
}

/** Shortest signed angle from `a` to `b`, in degrees (−180..180]. */
export function angleDelta(a: number, b: number): number {
  let delta = (b - a) % 360;
  if (delta > 180) delta -= 360;
  if (delta <= -180) delta += 360;
  return delta;
}

/** Below this speed (m/s) GPS heading is too noisy to steer the camera. */
export const HEADING_MIN_SPEED_MPS = 1.8;

/**
 * Exponential low-pass for the camera bearing, moving along the shortest
 * arc. `k` in 0..1 — higher follows faster. This is what keeps course-up
 * navigation calm: raw GPS headings jump ±40° between fixes at walking
 * speed, and easing to each of them made the map spin hectically.
 */
export function smoothedBearing(
  current: number,
  target: number,
  k = 0.25,
): number {
  return current + angleDelta(current, target) * Math.min(1, Math.max(0, k));
}

/**
 * Choose the bearing source for course-up follow. GPS heading is only
 * trusted while actually moving fast enough; otherwise the route course
 * (direction of the segment under the position) is used, which is what
 * Google Maps-style guidance does for pedestrian routes.
 */
export function cameraBearing(
  progress: RouteProgress | null,
  heading: number | null,
  speedMps: number | null,
): number {
  if (
    heading != null
    && !Number.isNaN(heading)
    && speedMps != null
    && speedMps >= HEADING_MIN_SPEED_MPS
  ) {
    return heading;
  }
  return progress?.courseBearing ?? heading ?? 0;
}

export interface SampledPoint {
  lon: number;
  lat: number;
  /** Bearing of the segment under the sample, degrees clockwise. */
  bearing: number;
}

/**
 * Sample a polyline by real travelled distance. Using vertex index instead
 * made simulated navigation speed up on short segments and stall on long
 * ones. Returns null for an empty/degenerate line.
 */
export function sampleRouteAtDistance(
  coordinates: readonly [number, number, number?][],
  distanceM: number,
): SampledPoint | null {
  if (coordinates.length < 2) return null;
  const cum = cumulativeDistances(coordinates);
  const total = cum[cum.length - 1];
  const clamped = Math.max(0, Math.min(total, distanceM));

  let index = 0;
  while (index < cum.length - 2 && cum[index + 1] < clamped) index += 1;
  const a = coordinates[index];
  const b = coordinates[index + 1];
  const segment = cum[index + 1] - cum[index];
  const t = segment > 0 ? (clamped - cum[index]) / segment : 0;
  return {
    lon: a[0] + (b[0] - a[0]) * t,
    lat: a[1] + (b[1] - a[1]) * t,
    bearing: bearingDeg(a, b),
  };
}

/**
 * Simulation speed for previews. A fixed 25 m/s made a 600 km train trip
 * take nearly seven hours; compress every preview to roughly 1–3 minutes
 * while keeping walking/bike previews readable.
 */
export function previewSpeedMps(plan: {
  mode: string;
  distanceKm: number;
}): number {
  const base = plan.mode === "walk"
    ? 1.5
    : plan.mode === "bike"
      ? 6
      : plan.mode === "transit"
        ? 25
        : 22;
  const total = Math.max(1, plan.distanceKm * 1000);
  const targetSeconds = plan.mode === "transit" ? 90 : 60;
  return Math.max(base, Math.min(3000, total / targetSeconds));
}

export const OFF_ROUTE_M = 55;

export function isOffRoute(progress: RouteProgress | null): boolean {
  return progress != null && progress.distanceToRouteM > OFF_ROUTE_M;
}
