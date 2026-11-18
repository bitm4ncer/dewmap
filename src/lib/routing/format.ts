/** Pure display helpers for route summaries. Safe in any JS runtime. */

/** Format a duration in minutes, e.g. `8 min`, `1 h 05 min`. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min";
  if (minutes < 1) return "<1 min";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Format a distance in kilometres, switching to metres below 1 km. */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km <= 0) return "0 m";
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * Format an ISO timestamp as a local clock time.
 * `timeZone` is optional and mainly useful for deterministic tests.
 */
export function formatClock(
  iso: string,
  locale?: string,
  timeZone?: string,
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    return "—";
  }
}

function calendarDay(
  iso: string,
  locale: string | undefined,
  timeZone: string | undefined,
): number | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat(locale ?? "en-GB", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).formatToParts(date);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
      return null;
    }
    return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  } catch {
    return null;
  }
}

/**
 * Calendar-day difference between two timestamps in the same zone.
 * Returns `"+1"`, `"-1"`, or `null` when both are on the same day.
 */
export function formatDayOffset(
  iso: string,
  baseIso: string,
  locale?: string,
  timeZone?: string,
): string | null {
  const day = calendarDay(iso, locale, timeZone);
  const base = calendarDay(baseIso, locale, timeZone);
  if (day === null || base === null) return null;
  const diff = day - base;
  if (diff === 0) return null;
  return diff > 0 ? `+${diff}` : String(diff);
}

/**
 * Format a real-time delay. Values below a minute are treated as on time.
 * Positive = late, negative = early.
 */
export function formatRelativeDelay(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  if (Math.abs(seconds) < 60) return "on time";
  const minutes = Math.round(Math.abs(seconds) / 60);
  return seconds > 0 ? `+${minutes} min` : `-${minutes} min`;
}
