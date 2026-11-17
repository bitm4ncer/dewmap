/**
 * Route progress + off-route detection for turn-by-turn navigation.
 *
 * Works on any normalized `RoutePlan`: car maneuvers, transit legs, or the
 * geometry-derived maneuvers produced for BRouter hike/bike plans.
 */

import type { Maneuver, RoutePlan } from "@/lib/routing";
import { cumulativeDistances } from "@/lib/routing/geo";

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

  const next =
    plan.maneuvers.find((m) => m.startIndex > best.index + 1) ??
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
  };
}

export const OFF_ROUTE_M = 55;

export function isOffRoute(progress: RouteProgress | null): boolean {
  return progress != null && progress.distanceToRouteM > OFF_ROUTE_M;
}
