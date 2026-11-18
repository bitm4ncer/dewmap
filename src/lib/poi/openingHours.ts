import type { PoiOpening, PoiOpeningRow } from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const INDEX: Record<string, number> = {
  Mo: 0,
  Tu: 1,
  We: 2,
  Th: 3,
  Fr: 4,
  Sa: 5,
  Su: 6,
};

function parseDays(part: string): number[] {
  const days = new Set<number>();
  for (const token of part.split(",")) {
    const value = token.trim();
    if (!value) continue;
    const range = value.match(/^([A-Z][a-z])-([A-Z][a-z])$/);
    if (range) {
      const from = INDEX[range[1]];
      const to = INDEX[range[2]];
      if (from === undefined || to === undefined) continue;
      for (let d = from; d <= to; d++) days.add(d);
      continue;
    }
    const day = INDEX[value.slice(0, 2)];
    if (day !== undefined) days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

function toMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59) return null;
  return h * 60 + m;
}

function parseRanges(part: string): { ranges: string[]; off: boolean } | null {
  const value = part.trim();
  if (!value) return null;
  if (/^(off|closed)$/i.test(value)) return { ranges: [], off: true };
  if (/^24\/7$/.test(value)) return { ranges: ["24 hours"], off: false };

  const ranges: string[] = [];
  for (const chunk of value.split(",")) {
    const range = chunk.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if (!range) return null;
    const start = toMinutes(range[1]);
    const end = toMinutes(range[2]);
    if (start === null || end === null) return null;
    ranges.push(`${range[1].padStart(5, "0")}–${range[2].padStart(5, "0")}`);
  }
  return ranges.length ? { ranges, off: false } : null;
}

/**
 * Parse the common OSM opening_hours patterns into a weekly grid.
 *
 * Supports 24/7, day lists/ranges and one or more HH:MM-HH:MM windows per
 * rule. Complex selectors (holidays, weeks, specific dates, sunrise/sunset)
 * fall back to the raw value instead of pretending to be exact.
 */
export function parseOpeningHours(
  raw: string | undefined,
  now: Date = new Date(),
): PoiOpening | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  const todayIndex = (now.getDay() + 6) % 7;
  const rows: PoiOpeningRow[] = DAYS.map((day) => ({
    day,
    ranges: [],
    closed: false,
  }));

  if (/^24\/7$/.test(value)) {
    for (const row of rows) row.ranges = ["24 hours"];
    return { raw: value, rows, openNow: true, todayIndex };
  }

  let parsedAny = false;
  for (const rule of value.split(";")) {
    const trimmed = rule.trim();
    if (!trimmed) continue;
    if (
      /\b(PH|SH|week|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(
        trimmed,
      )
    ) {
      continue;
    }
    const match = trimmed.match(
      /^((?:[A-Z][a-z](?:-[A-Z][a-z])?)(?:,(?:[A-Z][a-z](?:-[A-Z][a-z])?))*)\s+(.+)$/,
    );
    if (!match) continue;
    const days = parseDays(match[1]);
    const ranges = parseRanges(match[2]);
    if (!days.length || !ranges) continue;
    parsedAny = true;
    for (const day of days) {
      const row = rows[day];
      if (ranges.off) {
        row.closed = true;
        row.ranges = [];
      } else {
        row.closed = false;
        row.ranges = [...new Set([...row.ranges, ...ranges.ranges])];
      }
    }
  }

  if (!parsedAny) return { raw: value, rows, openNow: null, todayIndex };

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const today = rows[todayIndex];
  let openNow: boolean | null = null;
  if (today.closed) openNow = false;
  else if (today.ranges.length === 0) openNow = null;
  else if (today.ranges.includes("24 hours")) openNow = true;
  else {
    openNow = today.ranges.some((range) => {
      const [startText, endText] = range.split("–");
      const start = toMinutes(startText);
      const end = toMinutes(endText);
      if (start === null || end === null) return false;
      return start <= end
        ? nowMinutes >= start && nowMinutes < end
        : nowMinutes >= start || nowMinutes < end;
    });
  }

  return { raw: value, rows, openNow, todayIndex };
}
