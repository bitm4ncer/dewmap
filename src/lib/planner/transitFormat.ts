/**
 * Pure formatting, ranking and filtering helpers for transit journeys.
 * Kept free of React and browser APIs so they are easy to test.
 */

import {
  formatClock,
  formatDayOffset,
  formatDuration,
  isProviderError,
  type ProviderError,
  type RoutePlan,
  type TransitLeg,
  type TransitStopRef,
} from "../routing";

export type JourneySort = "best" | "departure" | "arrival" | "duration" | "transfers";

export interface JourneyFilters {
  /** Free-text city / stop filter. Empty means no city filter. */
  city?: string;
  /** Maximum total walking time in minutes. */
  maxWalkMin?: number;
  /** Required transit mode keys, e.g. ["RAIL", "BUS"]. Empty = all. */
  modes?: string[];
  /** Exclude explicit NOT_ACCESSIBLE / NO legs. */
  accessible?: boolean;
  /** Exclude explicit bikesAllowed:false legs. */
  bike?: boolean;
}

export interface TransferWarning {
  at: string;
  minutes: number;
  tight: boolean;
  missed: boolean;
  platformChange: boolean;
  fromPlatform?: string;
  toPlatform?: string;
  fromLine?: string;
  toLine?: string;
}

export interface SharePlace {
  name: string;
  lat: number;
  lon: number;
  id?: string;
  city?: string;
  kind?: "address" | "stop";
}

export interface ShareParams {
  from: SharePlace | null;
  to: SharePlace | null;
  via: SharePlace[];
  when: string | null;
  arriveBy: boolean;
  maxTransfers: number | null;
  wheelchair: boolean;
}

const WALK_SPEED_MPS = 1.35;
const TRANSFER_WARN_MIN = 5;

/** 0 → amber, 1 → danger; 12+ minutes is the top of the ramp. */
export function delayIntensity(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(1, minutes / 12);
}

export type TransferSeverity = "none" | "tight" | "critical";

export function transferSeverity(minutes: number | null): TransferSeverity {
  if (minutes == null) return "none";
  if (minutes < 2) return "critical";
  if (minutes < TRANSFER_WARN_MIN) return "tight";
  return "none";
}

function minutesBetween(start: string, end: string): number {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / 60_000;
}

/** Delay of a leg's departure or arrival versus the timetable. */
export function legDelayMinutes(
  leg: TransitLeg,
  which: "departure" | "arrival" = "departure",
): number {
  const actual = which === "arrival" ? leg.arrival : leg.departure;
  const planned =
    which === "arrival" ? leg.scheduledArrival : leg.scheduledDeparture;
  const a = Date.parse(actual);
  const p = Date.parse(planned);
  if (!Number.isFinite(a) || !Number.isFinite(p)) return 0;
  return Math.round((a - p) / 60_000);
}

/** Largest positive delay across all transit legs, in minutes. */
export function journeyDelayMinutes(journey: RoutePlan): number {
  const legs = journey.transit?.legs ?? [];
  if (legs.length === 0) return 0;
  return legs.reduce((max, leg) => {
    if (leg.mode !== "transit") return max;
    return Math.max(
      max,
      legDelayMinutes(leg, "departure"),
      legDelayMinutes(leg, "arrival"),
    );
  }, 0);
}

/** Live data is only meaningful for vehicle legs, not walks. */
export function isLiveJourney(journey: RoutePlan): boolean {
  return (journey.transit?.legs ?? []).some(
    (leg) => leg.mode === "transit" && leg.realTime && !leg.cancelled,
  );
}

export function isAccessibleJourney(journey: RoutePlan): boolean {
  const legs = (journey.transit?.legs ?? []).filter((leg) => leg.mode === "transit");
  return (
    legs.length > 0
    && legs.every((leg) => (leg.wheelchairAccessible ?? "").toUpperCase() === "YES")
  );
}

export function allowsBikes(journey: RoutePlan): boolean {
  const legs = (journey.transit?.legs ?? []).filter((leg) => leg.mode === "transit");
  return legs.length > 0 && legs.every((leg) => leg.bikesAllowed === true);
}

export function needsReservation(journey: RoutePlan): boolean {
  return (journey.transit?.legs ?? []).some(
    (leg) => leg.mode === "transit" && leg.reservation === true,
  );
}

/** Sum walking distance and duration. */
export function walkTotals(journey: RoutePlan): {
  distanceKm: number;
  minutes: number;
} {
  let distanceKm = 0;
  let minutes = 0;
  for (const leg of journey.transit?.legs ?? []) {
    if (leg.mode !== "walk") continue;
    const km = leg.distanceKm ?? 0;
    distanceKm += km;
    const timed = minutesBetween(leg.departure, leg.arrival);
    minutes += timed > 0 ? timed : (km * 1000) / WALK_SPEED_MPS / 60;
  }
  return { distanceKm, minutes };
}

export function journeyTimeZone(journey: RoutePlan): string | undefined {
  const legs = journey.transit?.legs ?? [];
  return (
    journey.transit?.timeZone
    ?? legs.find((leg) => leg.from.tz)?.from.tz
    ?? [...legs].reverse().find((leg) => leg.to.tz)?.to.tz
  );
}

/** Clock at a specific stop, falling back to the journey zone. */
export function stopClock(
  iso: string,
  stop: TransitStopRef,
  fallbackZone?: string,
  locale?: string,
): string {
  return formatClock(iso, locale, stop.tz ?? fallbackZone);
}

export function stopDayOffset(
  iso: string,
  baseIso: string,
  stop: TransitStopRef,
  fallbackZone?: string,
  locale?: string,
): string | null {
  return formatDayOffset(iso, baseIso, locale, stop.tz ?? fallbackZone);
}

/** Clock in the journey's local zone instead of the browser zone. */
export function journeyClock(
  iso: string,
  journey: RoutePlan,
  locale?: string,
): string {
  return formatClock(iso, locale, journeyTimeZone(journey));
}

export function journeyDayOffset(
  iso: string,
  journey: RoutePlan,
  baseIso?: string,
  locale?: string,
): string | null {
  const base = baseIso ?? journey.transit?.departure;
  if (!base) return null;
  return formatDayOffset(iso, base, locale, journeyTimeZone(journey));
}

/** START/END are coordinate origins from MOTIS, not station names. */
/** Minutes between one leg's arrival and the next leg's departure. */
export function transferMinutes(from: TransitLeg, to: TransitLeg): number | null {
  const arrival = Date.parse(from.arrival);
  const departure = Date.parse(to.departure);
  if (!Number.isFinite(arrival) || !Number.isFinite(departure)) return null;
  const minutes = Math.round((departure - arrival) / 60_000);
  return minutes >= 0 ? minutes : null;
}

/** Shortest layover between two ride legs, or null when there is none. */
export function minTransferMinutes(journey: RoutePlan): number | null {
  const legs = journey.transit?.legs ?? [];
  let min: number | null = null;
  for (let i = 1; i < legs.length; i++) {
    // Walk gaps are not transfers; only ride→ride layovers count.
    if (legs[i - 1].mode !== "transit" || legs[i].mode !== "transit") continue;
    const gap = transferMinutes(legs[i - 1], legs[i]);
    if (gap == null) continue;
    min = min == null ? gap : Math.min(min, gap);
  }
  return min;
}

export function stopLabel(stop: TransitStopRef): string {
  if (stop.name === "START") return "Start";
  if (stop.name === "END") return "Destination";
  return stop.name || "Stop";
}

/** Headsign only when it adds information beyond the alighting stop. */
export function legDirection(leg: TransitLeg): string {
  const to = stopLabel(leg.to);
  const headsign = leg.headsign?.trim();
  if (!headsign) return to;
  const normalize = (value: string) =>
    value.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalize(headsign) === normalize(to)) return to;
  return `${headsign} (alight ${to})`;
}

function normalizeHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(trimmed) || /^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^[0-9a-f]{3}$/i.test(trimmed) || /^[0-9a-f]{6}$/i.test(trimmed)) {
    return `#${trimmed}`;
  }
  return undefined;
}

function luminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean.split("").map((c) => `${c}${c}`).join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const channel = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function transitModeKey(leg: TransitLeg): string {
  const raw = `${leg.rawMode ?? ""} ${leg.routeType ?? ""}`.toUpperCase();
  if (raw.includes("FERRY") || raw.includes("SHIP")) return "FERRY";
  if (raw.includes("SUBWAY") || raw.includes("METRO")) return "SUBWAY";
  if (raw.includes("TRAM")) return "TRAM";
  if (raw.includes("BUS") || raw.includes("COACH")) return "BUS";
  if (raw.includes("ODM") || raw.includes("ON_DEMAND")) return "ODM";
  if (
    raw.includes("RAIL")
    || raw.includes("TRAIN")
    || raw.includes("HIGHSPEED")
    || raw.includes("LONG_DISTANCE")
    || raw.includes("REGIONAL")
  ) {
    return "RAIL";
  }
  return "TRANSIT";
}

export function modeLabel(leg: TransitLeg): string {
  if (leg.mode === "walk") return "Walk";
  if (leg.mode === "bike") return "Bike";
  if (leg.mode === "car") return "Car";
  switch (transitModeKey(leg)) {
    case "RAIL":
      return "Train";
    case "BUS":
      return "Bus";
    case "TRAM":
      return "Tram";
    case "SUBWAY":
      return "Metro";
    case "FERRY":
      return "Ferry";
    case "ODM":
      return "On demand";
    default:
      return "Transit";
  }
}

const LINE_KIND_COLORS = {
  sbahn: "#1E8A4C",
  ice: "#F2F5F7",
  regio: "#C7362F",
  tram: "#E8C547",
  flix: "#A6F53C",
} as const;

export type TransitLineKind = keyof typeof LINE_KIND_COLORS | "other";

/** Classifies a leg so rail/tram types carry a stable, known colour. */
export function transitLineKind(leg: TransitLeg): TransitLineKind {
  if (leg.mode !== "transit") return "other";
  const line = (leg.line ?? "").toLowerCase();
  const text = [leg.line, leg.agency, leg.rawMode, leg.routeType, leg.tripShortName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("flix")) return "flix";
  if (transitModeKey(leg) === "TRAM") return "tram";
  if (
    /\bs\d{1,3}\b/.test(line)
    || text.includes("s-bahn")
    || text.includes("sbahn")
    || text.includes("suburban")
  ) {
    return "sbahn";
  }
  if (
    /\bice\b/.test(text)
    || text.includes("intercityexpress")
    || text.includes("highspeed")
    || text.includes("high_speed")
  ) {
    return "ice";
  }
  if (
    /\b(re|rb|ire|mrb|mex)\s?\d/.test(line)
    || text.includes("db regio")
    || text.includes("regional")
    || text.includes("regional_rail")
  ) {
    return "regio";
  }
  return "other";
}

/** A stable, readable line colour; known types win over provider colours. */
export function lineColor(leg: TransitLeg): string {
  const kind = transitLineKind(leg);
  if (kind !== "other") return LINE_KIND_COLORS[kind];
  const provider = normalizeHex(leg.routeColor);
  if (provider) return provider;
  switch (transitModeKey(leg)) {
    case "RAIL":
      return "#2f6fed";
    case "BUS":
      return "#d97706";
    case "TRAM":
      return "#dc2626";
    case "SUBWAY":
      return "#7c3aed";
    case "FERRY":
      return "#0891b2";
    case "ODM":
      return "#be185d";
    default:
      return "#8cc8ff";
  }
}

export function lineTextColor(leg: TransitLeg): string {
  if (transitLineKind(leg) === "other") {
    const provider = normalizeHex(leg.routeTextColor);
    if (provider) return provider;
  }
  return luminance(lineColor(leg)) > 0.42 ? "#10120b" : "#ffffff";
}

export function lineLabel(leg: TransitLeg): string {
  return leg.line ?? leg.tripShortName ?? modeLabel(leg);
}

export function legDurationMin(leg: TransitLeg): number {
  const minutes = minutesBetween(leg.departure, leg.arrival);
  if (minutes > 0) return minutes;
  const km = leg.distanceKm ?? 0;
  return (km * 1000) / WALK_SPEED_MPS / 60;
}

/** Best = earliest arrival, then shortest, then fewest changes. */
export function bestJourneyId(journeys: RoutePlan[]): string | null {
  if (journeys.length === 0) return null;
  const ranked = [...journeys].sort((a, b) => {
    const arrivalA = Date.parse(a.transit?.arrival ?? "");
    const arrivalB = Date.parse(b.transit?.arrival ?? "");
    if (Number.isFinite(arrivalA) && Number.isFinite(arrivalB) && arrivalA !== arrivalB) {
      return arrivalA - arrivalB;
    }
    if (a.durationMin !== b.durationMin) return a.durationMin - b.durationMin;
    const transfersA = a.transit?.transfers ?? Number.MAX_SAFE_INTEGER;
    const transfersB = b.transit?.transfers ?? Number.MAX_SAFE_INTEGER;
    return transfersA - transfersB;
  });
  return ranked[0]?.id ?? null;
}

export function sortJourneys(
  journeys: RoutePlan[],
  sort: JourneySort,
): RoutePlan[] {
  const best = bestJourneyId(journeys);
  const time = (plan: RoutePlan, key: "departure" | "arrival") => {
    const parsed = Date.parse(plan.transit?.[key] ?? "");
    return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
  };
  return [...journeys].sort((a, b) => {
    if (sort === "best") {
      if (a.id === best) return -1;
      if (b.id === best) return 1;
      return time(a, "arrival") - time(b, "arrival");
    }
    if (sort === "departure") return time(a, "departure") - time(b, "departure");
    if (sort === "arrival") return time(a, "arrival") - time(b, "arrival");
    if (sort === "duration") return a.durationMin - b.durationMin;
    return (
      (a.transit?.transfers ?? 0) - (b.transit?.transfers ?? 0)
      || time(a, "arrival") - time(b, "arrival")
    );
  });
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function filterJourneys(
  journeys: RoutePlan[],
  filters: JourneyFilters,
): RoutePlan[] {
  const city = normalizeText(filters.city?.trim() ?? "");
  const modes = filters.modes ?? [];
  return journeys.filter((journey) => {
    const legs = journey.transit?.legs ?? [];
    const transitLegs = legs.filter((leg) => leg.mode === "transit");

    if (city) {
      const haystack = normalizeText(
        legs
          .flatMap((leg) => [
            stopLabel(leg.from),
            stopLabel(leg.to),
            leg.from.city ?? "",
            leg.to.city ?? "",
            leg.line ?? "",
            leg.agency ?? "",
          ])
          .join(" "),
      );
      if (!haystack.includes(city)) return false;
    }

    if (filters.maxWalkMin !== undefined) {
      if (walkTotals(journey).minutes > filters.maxWalkMin + 0.01) return false;
    }

    if (modes.length > 0) {
      if (!transitLegs.some((leg) => modes.includes(transitModeKey(leg)))) {
        return false;
      }
    }

    if (filters.accessible) {
      if (
        transitLegs.some((leg) =>
          ["NO", "NOT_ACCESSIBLE"].includes(
            (leg.wheelchairAccessible ?? "").toUpperCase(),
          ),
        )
      ) {
        return false;
      }
    }

    if (filters.bike) {
      if (transitLegs.some((leg) => leg.bikesAllowed === false)) return false;
    }

    return true;
  });
}

export function transferWarnings(legs: TransitLeg[]): TransferWarning[] {
  const warnings: TransferWarning[] = [];
  for (let i = 0; i < legs.length; i += 1) {
    const from = legs[i];
    if (from.mode !== "transit") continue;
    let j = i + 1;
    while (j < legs.length && legs[j].mode !== "transit") j += 1;
    if (j >= legs.length) break;
    const to = legs[j];
    const minutes = minutesBetween(from.arrival, to.departure);
    const tight = minutes < TRANSFER_WARN_MIN;
    warnings.push({
      at: stopLabel(from.to),
      minutes,
      tight,
      missed: minutes < 0,
      platformChange:
        Boolean(from.to.platform && to.from.platform)
        && from.to.platform !== to.from.platform,
      fromPlatform: from.to.platform,
      toPlatform: to.from.platform,
      fromLine: from.line,
      toLine: to.line,
    });
  }
  return warnings;
}

export function describeTransitError(err: unknown): string {
  if (!isProviderError(err)) {
    return err instanceof Error ? err.message : "Transit search failed.";
  }
  const error = err as ProviderError;
  switch (error.kind) {
    case "rate-limit": {
      const retry = error.retryAfterS;
      if (retry && retry > 0) {
        const minutes = Math.max(1, Math.ceil(retry / 60));
        return `Too many transit requests. Try again in ${minutes} min.`;
      }
      return "Too many transit requests. Please wait a moment and try again.";
    }
    case "no-route":
      return "No connection found for this time. Try a different time or stop.";
    case "network":
      return "The transit service is unreachable. Check your connection and retry.";
    case "bad-response":
      return "The transit service returned an unexpected response.";
    case "aborted":
      return "";
    default:
      return error.message || "Transit search failed.";
  }
}

function placeParam(prefix: string, place: SharePlace | null): [string, string][] {
  if (!place) return [];
  const entries: [string, string][] = [
    [prefix, `${place.lat},${place.lon}`],
    [`${prefix}Name`, place.name],
  ];
  if (place.id) entries.push([`${prefix}Id`, place.id]);
  if (place.city) entries.push([`${prefix}City`, place.city]);
  if (place.kind) entries.push([`${prefix}Kind`, place.kind]);
  return entries;
}

/** Build a shareable URL without dropping existing query parameters. */
export function buildShareUrl(
  base: string,
  params: {
    from: SharePlace | null;
    to: SharePlace | null;
    via?: SharePlace[];
    when?: string;
    arriveBy?: boolean;
    maxTransfers?: number;
    wheelchair?: boolean;
  },
): string {
  const url = new URL(base);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("tr")) url.searchParams.delete(key);
  }
  const entries: [string, string][] = [
    ...placeParam("trFrom", params.from),
    ...placeParam("trTo", params.to),
    ...(params.via ?? []).slice(0, 2).flatMap((place, index) =>
      placeParam(`trVia${index}`, place)
    ),
  ];
  if (params.when) entries.push(["trWhen", params.when]);
  if (params.arriveBy) entries.push(["trArrive", "1"]);
  if (params.maxTransfers !== undefined) {
    entries.push(["trMax", String(params.maxTransfers)]);
  }
  if (params.wheelchair) entries.push(["trWheel", "1"]);
  for (const [key, value] of entries) url.searchParams.set(key, value);
  return url.toString();
}

function readPlace(
  params: URLSearchParams,
  prefix: string,
): SharePlace | null {
  const raw = params.get(prefix);
  if (!raw) return null;
  const [latRaw, lonRaw] = raw.split(",");
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = params.get(`${prefix}Name`)?.trim() || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const id = params.get(`${prefix}Id`) ?? undefined;
  const city = params.get(`${prefix}City`) ?? undefined;
  const kindRaw = params.get(`${prefix}Kind`);
  const kind = kindRaw === "address" || kindRaw === "stop" ? kindRaw : undefined;
  return {
    name,
    lat,
    lon,
    ...(id ? { id } : {}),
    ...(city ? { city } : {}),
    ...(kind ? { kind } : {}),
  };
}

export function parseShareParams(
  input: string | URLSearchParams,
): ShareParams | null {
  const params =
    typeof input === "string" ? new URLSearchParams(input) : input;
  const from = readPlace(params, "trFrom");
  const to = readPlace(params, "trTo");
  const via = [readPlace(params, "trVia0"), readPlace(params, "trVia1")].filter(
    (place): place is SharePlace => place !== null,
  );
  const when = params.get("trWhen");
  const maxRaw = params.get("trMax");
  const maxTransfers =
    maxRaw !== null && Number.isFinite(Number(maxRaw))
      ? Math.max(0, Math.min(5, Math.round(Number(maxRaw))))
      : null;
  if (!from && !to && !when && via.length === 0) return null;
  return {
    from,
    to,
    via,
    when: when && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when) ? when : null,
    arriveBy: params.get("trArrive") === "1",
    maxTransfers,
    wheelchair: params.get("trWheel") === "1",
  };
}

function icsDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldIcsLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = rest.slice(75);
  }
  chunks.push(rest);
  return chunks.join("\r\n ");
}

/** Minimal calendar event for the selected journey, in UTC. */
export function buildIcs(journey: RoutePlan): string {
  const transit = journey.transit;
  if (!transit) return "";
  const start = icsDate(transit.departure);
  const end = icsDate(transit.arrival);
  if (!start || !end) return "";
  const legs = transit.legs;
  const first = legs[0]?.from;
  const last = legs[legs.length - 1]?.to;
  const summary = `${first ? stopLabel(first) : "Start"} → ${
    last ? stopLabel(last) : "Destination"
  }`;
  const description = legs
    .map((leg) => {
      const time = formatClock(
        leg.departure,
        "en-GB",
        leg.from.tz,
      );
      const line =
        leg.mode === "walk"
          ? `Walk ${formatDuration(legDurationMin(leg))}`
          : `${lineLabel(leg)} ${legDirection(leg)}`;
      return `${time} ${stopLabel(leg.from)} → ${stopLabel(leg.to)} · ${line}`;
    })
    .join("\n");
  const uid = `${(journey.id || "journey").replace(/[^a-zA-Z0-9._-]/g, "-")}@kugelmaps`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//KugelMaps//Transit//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `LOCATION:${icsEscape(first ? stopLabel(first) : "")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
