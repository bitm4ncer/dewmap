/**
 * Service alerts from MOTIS / Transitous.
 *
 * MOTIS has no standalone alert endpoint: GTFS-RT alerts are attached to
 * stop-time `place` objects and to itinerary legs. This module normalizes
 * both shapes into one `TransitAlert`, strips the provider's HTML, and offers
 * a small, TTL-cached area sampler that asks a handful of stops in the
 * current view for their alerts.
 */

import { fetchJson } from "./http";
import type { AlertStopCandidate } from "./liveVehicles";
import {
  isRecord,
  readArray,
  readString,
  type TransitAlert,
  type TransitAlertSeverity,
  type TransitAlertSource,
  type TransitAlertStop,
} from "./types";

const MOTIS_V6_BASE = "https://api.transitous.org/api/v6";
const ALERT_TIMEOUT_MS = 10_000;
/** Stop-time alerts are cached so panning back does not refetch them. */
const DEFAULT_CACHE_TTL_MS = 4 * 60_000;
const MAX_ALERT_STOPS = 3;
/** Ask for few departures: we only want the attached alerts, not a board. */
const ALERT_STOP_TIMES_PER_PLATFORM = 10;
const ALERT_WINDOW_S = 60 * 60;
const CACHE_LIMIT = 64;

const SEVERITIES: readonly TransitAlertSeverity[] = [
  "UNKNOWN_SEVERITY",
  "INFO",
  "WARNING",
  "SEVERE",
];

export type { AlertStopCandidate };

export interface AreaAlertsQuery {
  stops: readonly AlertStopCandidate[];
  signal?: AbortSignal;
  /** Injectable for tests. */
  now?: number;
  maxStops?: number;
  cacheTtlMs?: number;
}

/** FNV-1a: short, stable ids without a dependency. */
function hashId(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
  hellip: "...",
  szlig: "ss",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
};

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#")) {
        const hex = entity[1]?.toLowerCase() === "x";
        const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[entity] ?? match;
    },
  );
}

/**
 * Convert MOTIS alert prose to plain text. DELFI descriptions arrive as
 * `<b>`, `<br>`, `<ul>`/`<li>`; rendering them as HTML would be an injection
 * path, so everything is flattened instead.
 */
export function alertPlainText(value: string | undefined): string {
  if (!value) return "";
  const text = value
    .replace(/<\s*(?:br|hr)\s*\/?>/gi, "\n")
    .replace(/<\s*\/\s*(?:p|div|ul|ol|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\s*\/\s*li\s*>/gi, "")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function periodOf(
  value: Record<string, unknown>,
): { startsAt?: string; endsAt?: string } {
  const ranges = [
    ...readArray(value, "impactPeriod"),
    ...readArray(value, "communicationPeriod"),
  ].filter(isRecord);
  for (const range of ranges) {
    const start = readString(range, "start");
    const end = readString(range, "end");
    if (start || end) {
      return {
        ...(start ? { startsAt: start } : {}),
        ...(end ? { endsAt: end } : {}),
      };
    }
  }
  return {};
}

function severityOf(value: Record<string, unknown>): TransitAlertSeverity {
  const raw = readString(value, "severityLevel")?.toUpperCase();
  return SEVERITIES.find((severity) => severity === raw) ?? "UNKNOWN_SEVERITY";
}

export interface NormalizeAlertOptions {
  source: TransitAlertSource;
  lines?: readonly string[];
  stops?: readonly TransitAlertStop[];
}

/** Normalize one MOTIS/GTFS-RT alert. Returns null when it has no text. */
export function normalizeMotisAlert(
  value: unknown,
  options: NormalizeAlertOptions,
): TransitAlert | null {
  if (!isRecord(value)) return null;
  const header = alertPlainText(readString(value, "headerText"));
  const description = alertPlainText(readString(value, "descriptionText"));
  if (!header && !description) return null;

  const period = periodOf(value);
  const effect = readString(value, "effect");
  const cause = readString(value, "cause");
  const url = readString(value, "url");
  const id = hashId(`${header}|${period.startsAt ?? ""}|${period.endsAt ?? ""}`);

  return {
    id,
    header: header || description.split("\n")[0] || "Service alert",
    ...(description ? { description } : {}),
    severity: severityOf(value),
    ...(effect ? { effect } : {}),
    ...(cause ? { cause } : {}),
    ...(url ? { url } : {}),
    ...period,
    lines: [...new Set(options.lines ?? [])],
    stops: [...(options.stops ?? [])],
    source: options.source,
  };
}

/** Merge alerts that share an id, keeping every affected line and stop. */
export function mergeAlerts(alerts: readonly TransitAlert[]): TransitAlert[] {
  const byId = new Map<string, TransitAlert>();
  for (const alert of alerts) {
    const existing = byId.get(alert.id);
    if (!existing) {
      byId.set(alert.id, {
        ...alert,
        lines: [...alert.lines],
        stops: alert.stops.map((stop) => ({ ...stop })),
      });
      continue;
    }
    for (const line of alert.lines) {
      if (!existing.lines.includes(line)) existing.lines.push(line);
    }
    for (const stop of alert.stops) {
      if (
        !existing.stops.some(
          (entry) =>
            entry.name === stop.name
            && Math.abs(entry.lat - stop.lat) < 1e-6
            && Math.abs(entry.lon - stop.lon) < 1e-6,
        )
      ) {
        existing.stops.push({ ...stop });
      }
    }
    // Prefer the more specific severity text if one source has it.
    if (
      existing.severity === "UNKNOWN_SEVERITY"
      && alert.severity !== "UNKNOWN_SEVERITY"
    ) {
      existing.severity = alert.severity;
    }
  }
  return sortAlerts([...byId.values()]);
}

const SEVERITY_RANK: Record<TransitAlertSeverity, number> = {
  SEVERE: 0,
  WARNING: 1,
  INFO: 2,
  UNKNOWN_SEVERITY: 3,
};

export function sortAlerts(alerts: readonly TransitAlert[]): TransitAlert[] {
  return [...alerts].sort((a, b) => {
    const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rank !== 0) return rank;
    const startA = a.startsAt ? Date.parse(a.startsAt) : Number.MAX_SAFE_INTEGER;
    const startB = b.startsAt ? Date.parse(b.startsAt) : Number.MAX_SAFE_INTEGER;
    return startA - startB;
  });
}

interface CacheEntry {
  at: number;
  alerts: TransitAlert[];
}

const stopCache = new Map<string, CacheEntry>();

/** Test seam: drop the stop-time alert cache. */
export function clearAlertCache(): void {
  stopCache.clear();
}

interface StopTimesResponse {
  stopTimes?: unknown;
}

function alertsForStop(
  data: unknown,
  candidate: AlertStopCandidate,
): TransitAlert[] {
  if (!isRecord(data)) return [];
  const stopTimes = readArray(data as Record<string, unknown>, "stopTimes").filter(
    isRecord,
  );
  const stop: TransitAlertStop = {
    name: candidate.name,
    lat: candidate.lat,
    lon: candidate.lon,
  };
  const alerts: TransitAlert[] = [];
  for (const stopTime of stopTimes) {
    const place = isRecord(stopTime.place) ? stopTime.place : undefined;
    const placeStop: TransitAlertStop = {
      name: readString(place, "name") ?? stop.name,
      lat: candidate.lat,
      lon: candidate.lon,
    };
    for (const raw of readArray(place, "alerts")) {
      const alert = normalizeMotisAlert(raw, {
        source: "area",
        stops: [placeStop],
      });
      if (alert) alerts.push(alert);
    }
  }
  return alerts;
}

async function fetchStopAlerts(
  candidate: AlertStopCandidate,
  signal: AbortSignal | undefined,
  nowMs: number,
  cacheTtlMs: number,
): Promise<TransitAlert[]> {
  const cached = stopCache.get(candidate.stopId);
  if (cached && nowMs - cached.at < cacheTtlMs) return cached.alerts;

  const params = new URLSearchParams({
    stopId: candidate.stopId,
    n: String(ALERT_STOP_TIMES_PER_PLATFORM),
    window: String(ALERT_WINDOW_S),
    withAlerts: "true",
  });
  const data = await fetchJson<StopTimesResponse>(
    `${MOTIS_V6_BASE}/stoptimes?${params.toString()}`,
    {
      signal,
      timeoutMs: ALERT_TIMEOUT_MS,
      provider: "motis",
    },
  );
  const alerts = alertsForStop(data, candidate);
  stopCache.delete(candidate.stopId);
  stopCache.set(candidate.stopId, { at: nowMs, alerts });
  while (stopCache.size > CACHE_LIMIT) {
    const oldest = stopCache.keys().next().value;
    if (oldest === undefined) break;
    stopCache.delete(oldest);
  }
  return alerts;
}

/**
 * Sample alerts from a few stops in the current view.
 *
 * Individual stop failures are ignored: one stale stop must not hide alerts
 * from the others. A total failure (every request failed) is reported so the
 * panel can show an error instead of a misleading "no disruptions".
 */
export async function fetchAreaAlerts(
  query: AreaAlertsQuery,
): Promise<TransitAlert[]> {
  const nowMs = query.now ?? Date.now();
  const cacheTtlMs = query.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxStops = Math.max(1, query.maxStops ?? MAX_ALERT_STOPS);
  const seen = new Set<string>();
  const candidates = [...query.stops]
    .filter((stop) => stop.stopId && stop.name)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .filter((stop) => {
      if (seen.has(stop.stopId)) return false;
      seen.add(stop.stopId);
      return true;
    })
    .slice(0, maxStops);

  if (candidates.length === 0) return [];

  const results = await Promise.allSettled(
    candidates.map((candidate) =>
      fetchStopAlerts(candidate, query.signal, nowMs, cacheTtlMs),
    ),
  );

  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<TransitAlert[]> =>
      result.status === "fulfilled",
  );
  if (fulfilled.length === 0 && results.length > 0) {
    const reason = (results[0] as PromiseRejectedResult).reason;
    throw reason;
  }

  return mergeAlerts(fulfilled.flatMap((result) => result.value));
}
