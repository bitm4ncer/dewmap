/**
 * Copy and formatting for the shadow card.
 *
 * Pure string functions so the panel has no clock logic and the tests can pin
 * the wording: an empty layer must say *why* it is empty, not just be empty.
 */
import type { ShadowPhase, ShadowStatsView } from "./state";
import type { SolarPosition } from "./types";

/** The pilot's civil time. Shadows follow the place, not the viewer. */
export const PILOT_TIME_ZONE = "Europe/Berlin";

export function formatShadowClock(date: Date, timeZone = PILOT_TIME_ZONE): string {
  if (!Number.isFinite(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
}

/** Day label when the slider crosses midnight, e.g. `Fri`. */
export function formatShadowDay(date: Date, now: Date, timeZone = PILOT_TIME_ZONE): string | null {
  const format = new Intl.DateTimeFormat("de-DE", { weekday: "short", timeZone });
  const day = format.format(date);
  return day === format.format(now) ? null : day;
}

/** `now`, `+2 h 05`, `−45 min`. */
export function formatShadowOffset(minutes: number): string {
  if (!Number.isFinite(minutes) || Math.abs(minutes) < 1) return "now";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(Math.round(minutes));
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  if (hours === 0) return `${sign}${rest} min`;
  return `${sign}${hours} h${rest ? ` ${String(rest).padStart(2, "0")}` : ""}`;
}

export function sunSummary(sun: SolarPosition | null): string | null {
  if (!sun) return null;
  return `sun ${Math.round(sun.elevationDeg)}°`;
}

export interface ShadowStatusInput {
  phase: ShadowPhase;
  message: string | null;
  stats: ShadowStatsView | null;
  sun: SolarPosition | null;
}

/**
 * One line under the controls.
 *
 * `resolving…` (not `Rendering…`) is deliberate: `LayerCard` shows its inline
 * spinner for statuses starting with "resolving".
 */
export function shadowStatusLine({ phase, message, stats, sun }: ShadowStatusInput): string | null {
  switch (phase) {
    case "off":
      return null;
    case "zoomed-out":
      return message ?? "Zoom in to 14";
    case "outside":
      return message ?? "Outside the Düsseldorf pilot — no building heights here yet.";
    case "loading":
      return "resolving shadows…";
    case "empty":
    case "night":
    case "error":
      return message ?? "No shadows available.";
    case "ready": {
      if (!stats) return null;
      const parts = [
        `${stats.buildings.toLocaleString("de-DE")} buildings`,
        `${stats.resolutionM} m`,
        `${Math.round(stats.computeMs)} ms`,
      ];
      if (stats.partial) parts.push("clipped to pilot");
      const sunText = sunSummary(sun);
      if (sunText) parts.push(sunText);
      return parts.join(" · ");
    }
    default:
      return null;
  }
}
