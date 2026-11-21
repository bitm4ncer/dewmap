/**
 * Radar-frame presentation.
 *
 * The gateway decides *which* frames exist; this module only answers how a
 * frame reads in the UI (clock, relative label) and what the intensity
 * legend looks like. Kept free of React so it can be unit-tested.
 */
import type { LngLatCorners, RadarFrame } from "./types";

/**
 * DWD radar legend colours, sampled from the layer's own
 * `GetLegendGraphic` for `Radar_rv_product_1x1km_ger`. Order = increasing
 * precipitation rate, 0.1 mm/h … >= 150 mm/h.
 */
export const RADAR_PALETTE = [
  "#33ffff",
  "#1acc9a",
  "#019934",
  "#4db31b",
  "#99cc01",
  "#cce601",
  "#ffff01",
  "#ffc401",
  "#ff8901",
  "#ff4501",
  "#fe0000",
  "#e5004c",
  "#cc0098",
  "#6600cb",
  "#0000fe",
] as const;

/** CSS gradient for the panel legend, one hard stop per DWD class. */
export const RADAR_GRADIENT = `linear-gradient(to right, ${RADAR_PALETTE.join(
  ", ",
)})`;

/** mm/h class boundaries the legend labels. */
export const RADAR_LEGEND_LABELS = ["0.1", "1", "5", "20", "150+"] as const;

/**
 * Image coordinates for the RV composite. The WMS bbox is a rectangle in
 * EPSG:3857, so its lon/lat corners map exactly onto a MapLibre image source.
 */
export function radarCoordinates(
  bounds: [number, number, number, number],
): LngLatCorners {
  const [west, south, east, north] = bounds;
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
}

/** Whole minutes between a frame and the newest analysis slot. */
export function frameOffsetMinutes(
  frame: Pick<RadarFrame, "time">,
  anchorIso: string,
): number {
  const frameMs = Date.parse(frame.time);
  const anchorMs = Date.parse(anchorIso);
  if (!Number.isFinite(frameMs) || !Number.isFinite(anchorMs)) return 0;
  return Math.round((frameMs - anchorMs) / 60_000);
}

/**
 * Short German hint under the time slider: `vor 55 Min`, `Jetzt`,
 * `Nowcast +15 Min`.
 */
export function frameHint(
  frame: Pick<RadarFrame, "time" | "kind">,
  anchorIso: string,
): string {
  const offset = frameOffsetMinutes(frame, anchorIso);
  if (offset === 0) return "Jetzt";
  if (offset < 0) return `vor ${Math.abs(offset)} Min`;
  return `Nowcast +${offset} Min`;
}

/**
 * Weather is a German product: DWD timestamps, warning windows and the
 * "bis 09:00" phrasing all mean German local time. Pinning the zone keeps the
 * panel unambiguous for a visitor in another timezone.
 */
export const WEATHER_TZ = "Europe/Berlin";

/** `HH:MM` in German local time (or an explicit zone for tests). */
export function formatClock(iso: string, timeZone: string = WEATHER_TZ): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "--:--";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(ms));
}

/** `Sa 21.11. · 14:30` for warning validity ranges. */
export function formatDateTime(
  iso: string,
  timeZone: string = WEATHER_TZ,
): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(ms));
}

/** Calendar day in German local time, `YYYY-MM-DD`. */
export function weatherDayKey(date: Date, timeZone: string = WEATHER_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(date);
}
