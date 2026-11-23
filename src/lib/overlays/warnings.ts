/**
 * Warning presentation helpers.
 *
 * The gateway already normalises DWD's payload; this module decides how a
 * severity looks, how validity reads and what the map popup says. Pure
 * functions so the panel and the map share exactly one vocabulary.
 */
import { THEME } from "../theme";
import { WEATHER_TZ, formatDateTime, weatherDayKey } from "./radar";

export const SEVERITY_COLORS: Record<number, string> = {
  1: THEME.warningLevel1,
  2: THEME.warningLevel2,
  3: THEME.warningLevel3,
  4: THEME.warningLevel4,
};

export const SEVERITY_LABELS: Record<number, string> = {
  1: "Advance notice",
  2: "Weather warning",
  3: "Severe weather warning",
  4: "Extreme weather warning",
};

export function severityColor(level: number): string {
  return SEVERITY_COLORS[level] ?? THEME.info;
}

export function severityLabel(level: number): string {
  return SEVERITY_LABELS[level] ?? "Weather warning";
}

/** Short severity scale for the legend: 2 = yellow … 4 = red. */
export const SEVERITY_SCALE = [2, 3, 4] as const;

/**
 * `match` expression for MapLibre paint: one colour per warning level, with
 * the info tone as the fallback for anything unexpected.
 */
export function severityColorExpression(): unknown[] {
  return [
    "match",
    ["get", "level"],
    1,
    SEVERITY_COLORS[1],
    2,
    SEVERITY_COLORS[2],
    3,
    SEVERITY_COLORS[3],
    4,
    SEVERITY_COLORS[4],
    THEME.info,
  ];
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "until 12:00" on the same day, "until Sat, 21 Nov, 12:00" otherwise. */
export function validityHint(
  to: string | null,
  now: Date = new Date(),
): string {
  if (!to) return "";
  const end = new Date(to);
  if (Number.isNaN(end.getTime())) return "";
  if (end.getTime() <= now.getTime()) return "expired";
  const sameDay = weatherDayKey(end) === weatherDayKey(now);
  if (sameDay) {
    return `until ${new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: WEATHER_TZ,
    }).format(end)}`;
  }
  return `until ${formatDateTime(to)}`;
}

/** Counts per severity for the panel header, 4 → 1. */
export function severityCounts(
  counts: Record<string, number> | undefined,
): { level: number; count: number }[] {
  return [4, 3, 2, 1]
    .map((level) => ({ level, count: Number(counts?.[String(level)] ?? 0) }))
    .filter((entry) => entry.count > 0);
}

/** Human summary line, e.g. "14 warnings · extreme level". */
export function warningsSummary(total: number, maxLevel: number): string {
  if (total === 0) return "No active warnings";
  if (maxLevel >= 4) return `${total} warnings · extreme level`;
  if (maxLevel === 3) return `${total} warnings · severe level`;
  return `${total} warnings`;
}

/** Popup body for a tapped warning area. */
export function warningPopupHtml(
  properties: Record<string, unknown>,
): string {
  const level = Number(properties.level ?? 2);
  const color = severityColor(level);
  const from = typeof properties.from === "string" ? properties.from : null;
  const to = typeof properties.to === "string" ? properties.to : null;
  const window =
    from && to
      ? `${formatDateTime(from)} – ${formatDateTime(to)}`
      : to
        ? `until ${formatDateTime(to)}`
        : "";
  const count = Number(properties.count ?? 1);
  const extra = count > 1 ? ` · ${count} warnings` : "";
  return `<div style="max-width:260px;font:12px/1.45 system-ui,sans-serif">
    <div style="display:flex;gap:6px;align-items:center">
      <span style="width:8px;height:8px;border-radius:50%;background:${color};flex:none"></span>
      <strong>${escapeHtml(severityLabel(level))}${escapeHtml(extra)}</strong>
    </div>
    <div style="margin-top:3px">${escapeHtml(properties.headline ?? properties.event ?? "")}</div>
    <div style="color:var(--ink-mute)">${escapeHtml(properties.area ?? "")}</div>
    ${window ? `<div style="color:var(--ink-mute)">${escapeHtml(window)}</div>` : ""}
  </div>`;
}
