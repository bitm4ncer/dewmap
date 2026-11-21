/**
 * When to refresh or clear area alerts.
 *
 * Extracted from the map hook so the three edge cases found in review have a
 * direct test: leaving the sampled area (0 stops), zooming out/in quickly
 * (gate reset) and the normal 5-minute / 4-km cadence.
 */

export const ALERT_REFRESH_MS = 5 * 60_000;
export const ALERT_MOVE_KM = 4;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface AlertGate {
  /** Timestamp of the last completed attempt, 0 = never. */
  lastAt: number;
  /** Center the last attempt ran for. */
  lastCenter: LatLon | null;
}

export type AlertGateAction = "refresh" | "clear" | "skip";

export interface AlertGateInput {
  stopCount: number;
  center: LatLon;
  now: number;
  refreshMs?: number;
  moveKm?: number;
}

export function initialAlertGate(): AlertGate {
  return { lastAt: 0, lastCenter: null };
}

/** Reset after zooming out or leaving the view; the next visit loads at once. */
export function resetAlertGate(): AlertGate {
  return initialAlertGate();
}

/** Great-circle-ish distance in km, good enough for a 4 km threshold. */
export function movedKm(a: LatLon, b: LatLon): number {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return (
    Math.hypot(
      b.lat - a.lat,
      (b.lon - a.lon) * Math.cos(lat),
    ) * 111.32
  );
}

export function alertGateAction(
  gate: AlertGate,
  input: AlertGateInput,
): AlertGateAction {
  // No stops means nothing to sample: clear stale markers instead of leaving
  // them at the previous city.
  if (input.stopCount === 0) return "clear";
  if (!gate.lastCenter || gate.lastAt === 0) return "refresh";
  const moveKm = input.moveKm ?? ALERT_MOVE_KM;
  if (movedKm(gate.lastCenter, input.center) >= moveKm) return "refresh";
  const refreshMs = input.refreshMs ?? ALERT_REFRESH_MS;
  if (input.now - gate.lastAt >= refreshMs) return "refresh";
  return "skip";
}

export function commitAlertGate(center: LatLon, now: number): AlertGate {
  return { lastAt: now, lastCenter: center };
}
