/**
 * Real-time vehicle positions from MOTIS `/api/v6/map/trips`.
 *
 * The endpoint returns trip segments with real-time departure/arrival times
 * and the encoded shape. It does not return GPS coordinates, so the vehicle
 * position is interpolated along the shape between the two stops. This is the
 * best available position from the public Transitous API and stays correct
 * when the real-time times change.
 */

import { MODE_COLORS } from "./modeColors";
import { bearingDeg, cumulativeDistances } from "./geo";
import { fetchJson } from "./http";
import { decodePolyline, toLonLat } from "./polyline";
import {
  isRecord,
  readArray,
  readBoolean,
  readNumber,
  readString,
} from "./types";

const MOTIS_V6_BASE = "https://api.transitous.org/api/v6";
const LIVE_TIMEOUT_MS = 12_000;
/** Show a vehicle slightly before departure / after arrival (dwell). */
const ACTIVE_GRACE_MS = 2 * 60_000;
const LOOKBACK_MS = 2 * 60_000;
const LOOKAHEAD_MS = 10 * 60_000;

/** Below this zoom the map window is too large for a useful vehicle feed. */
export const LIVE_MIN_ZOOM = 8;
/** Freshness beats battery: positions are interpolated, 30 s keeps them live. */
export const LIVE_POLL_MS = 30_000;
/** Upper bound per frame; circle layers stay cheap well above this. */
export const MAX_LIVE_VEHICLES = 1_200;

export type LiveVehicleSource = "interpolated" | "gps";
export type LiveVehiclePhase = "moving" | "dwell";
export type LiveModeGroup =
  | "RAIL"
  | "BUS"
  | "TRAM"
  | "SUBWAY"
  | "FERRY"
  | "OTHER";

export interface LiveVehicleStop {
  id?: string;
  name: string;
  lat: number;
  lon: number;
}

export interface LiveVehicle {
  id: string;
  tripId: string;
  line: string;
  mode: string;
  modeLabel: string;
  modeGroup: LiveModeGroup;
  /** Hex colour with a leading `#`. */
  color: string;
  textColor: string;
  lat: number;
  lon: number;
  bearing: number;
  delayMin: number;
  realTime: boolean;
  /** How the position was obtained; a future server feed reports "gps". */
  source: LiveVehicleSource;
  /** Dwell means the vehicle is at `from` or `to` within the grace window. */
  phase: LiveVehiclePhase;
  stops: { from: LiveVehicleStop; to: LiveVehicleStop };
  fromName: string;
  toName: string;
  fromTz?: string;
  toTz?: string;
  departure: string;
  arrival: string;
  scheduledDeparture?: string;
  scheduledArrival?: string;
  distanceM: number;
}

export interface LiveVehicleQuery {
  /** Bounding box in WGS84 degrees. */
  south: number;
  west: number;
  north: number;
  east: number;
  zoom: number;
  now?: Date;
  signal?: AbortSignal;
}

const MODE_LABELS: Record<string, string> = {
  HIGHSPEED_RAIL: "High-speed rail",
  LONG_DISTANCE: "Long-distance train",
  REGIONAL_RAIL: "Regional train",
  REGIONAL_EXPRESS: "Regional express",
  SUBURBAN: "S-Bahn",
  METRO: "Metro",
  TRAM: "Tram",
  BUS: "Bus",
  COACH: "Coach",
  FERRY: "Ferry",
  SUBWAY: "Subway",
  LIGHT_RAIL: "Light rail",
  ODM: "On-demand",
  AIRPLANE: "Plane",
};



export function liveModeLabel(mode: string | undefined): string {
  if (!mode) return "Transit";
  return MODE_LABELS[mode.toUpperCase()] ?? mode.replaceAll("_", " ").toLowerCase();
}

/** Coarse grouping used by filters, the legend and the map layers. */
export function liveModeGroup(mode: string | undefined): LiveModeGroup {
  switch ((mode ?? "").toUpperCase()) {
    case "HIGHSPEED_RAIL":
    case "LONG_DISTANCE":
    case "REGIONAL_RAIL":
    case "REGIONAL_EXPRESS":
    case "SUBURBAN":
    case "NIGHT_RAIL":
      return "RAIL";
    case "BUS":
    case "COACH":
      return "BUS";
    case "TRAM":
    case "LIGHT_RAIL":
      return "TRAM";
    case "METRO":
    case "SUBWAY":
      return "SUBWAY";
    case "FERRY":
      return "FERRY";
    default:
      return "OTHER";
  }
}

/** Empty `groups` means "all". Unknown groups are ignored. */
export function filterLiveVehicles(
  vehicles: readonly LiveVehicle[],
  groups: readonly string[],
): LiveVehicle[] {
  if (groups.length === 0) return [...vehicles];
  const wanted = new Set(groups);
  return vehicles.filter((vehicle) => wanted.has(vehicle.modeGroup));
}

/**
 * Combine a future GPS feed with the interpolated feed.
 *
 * One position per `tripId`: a GPS fix always wins, everything else keeps the
 * interpolated value. The UI does not care which source produced a vehicle.
 */
export function mergeVehiclePositions(
  interpolated: readonly LiveVehicle[],
  gps: readonly LiveVehicle[],
): LiveVehicle[] {
  const byTrip = new Map<string, LiveVehicle>();
  for (const vehicle of interpolated) byTrip.set(vehicle.tripId, vehicle);
  for (const vehicle of gps) {
    if (vehicle.source !== "gps") continue;
    byTrip.set(vehicle.tripId, vehicle);
  }
  return [...byTrip.values()];
}

/** Normalize a provider colour (`00aa00`, `#0a0`, ...) to `#rrggbb`. */
export function normalizeLiveColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const hex = trimmed.slice(1);
    return `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(trimmed)) return `#${trimmed}`.toLowerCase();
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${trimmed[0]}${trimmed[0]}${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}`.toLowerCase();
  }
  return undefined;
}

function vehicleColor(mode: string | undefined, routeColor: string | undefined): string {
  return (
    normalizeLiveColor(routeColor)
    ?? MODE_COLORS[(mode ?? "").toUpperCase()]
    ?? "#8cc8ff"
  );
}

function textColorFor(
  mode: string | undefined,
  routeTextColor: string | undefined,
): string {
  return (
    normalizeLiveColor(routeTextColor)
    ?? ((mode ?? "").toUpperCase() === "BUS" ? "#241b08" : "#0e0f0c")
  );
}

function delayMinutes(
  actual: string | undefined,
  scheduled: string | undefined,
): number {
  if (!actual || !scheduled) return 0;
  const a = Date.parse(actual);
  const s = Date.parse(scheduled);
  if (!Number.isFinite(a) || !Number.isFinite(s)) return 0;
  return Math.round((a - s) / 60_000);
}

function pointAtFraction(
  coordinates: readonly [number, number][],
  fraction: number,
): { lat: number; lon: number; bearing: number } | null {
  if (coordinates.length < 2) return null;
  const cumulative = cumulativeDistances(coordinates);
  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= 0) return null;
  const target = total * Math.max(0, Math.min(1, fraction));
  let index = 0;
  while (index < cumulative.length - 2 && cumulative[index + 1] < target) {
    index += 1;
  }
  const a = coordinates[index];
  const b = coordinates[index + 1];
  const segment = cumulative[index + 1] - cumulative[index];
  const t = segment > 0 ? (target - cumulative[index]) / segment : 0;
  return {
    lon: a[0] + (b[0] - a[0]) * t,
    lat: a[1] + (b[1] - a[1]) * t,
    bearing: bearingDeg(a, b),
  };
}

function liveStop(
  value: Record<string, unknown> | undefined,
  fallback: { lat: number; lon: number },
): LiveVehicleStop {
  const stopId = readString(value, "parentId") ?? readString(value, "stopId");
  return {
    ...(stopId ? { id: stopId } : {}),
    name: readString(value, "name") ?? "Unknown stop",
    lat: readNumber(value, "lat") ?? fallback.lat,
    lon: readNumber(value, "lon") ?? fallback.lon,
  };
}

interface Candidate {
  vehicle: LiveVehicle;
  /** Distance of `now` from the middle of this segment; lower wins. */
  score: number;
}

/**
 * Normalize and interpolate `/api/v6/map/trips` segments.
 *
 * Each trip can appear as several consecutive segments. Keep exactly one
 * active segment per trip so a vehicle is never drawn twice at a transfer.
 */
export function normalizeLiveVehicles(
  data: unknown,
  nowMs = Date.now(),
): LiveVehicle[] {
  const root = isRecord(data) ? readArray(data, "trips") : data;
  if (!Array.isArray(root) || !Number.isFinite(nowMs)) return [];

  const byTrip = new Map<string, Candidate>();

  for (const value of root) {
    if (!isRecord(value)) continue;
    const polyline = readString(value, "polyline");
    if (!polyline) continue;
    const departure = readString(value, "departure");
    const arrival = readString(value, "arrival");
    if (!departure || !arrival) continue;
    const dep = Date.parse(departure);
    const arr = Date.parse(arrival);
    if (!Number.isFinite(dep) || !Number.isFinite(arr) || arr <= dep) continue;
    if (nowMs < dep - ACTIVE_GRACE_MS || nowMs > arr + ACTIVE_GRACE_MS) continue;

    const trips = readArray(value, "trips").filter(isRecord);
    const trip = trips[0];
    const tripId =
      readString(trip, "tripId") ?? `${readString(value, "mode") ?? "trip"}:${departure}`;
    const from = isRecord(value.from) ? value.from : undefined;
    const to = isRecord(value.to) ? value.to : undefined;
    const coordinates = toLonLat(decodePolyline(polyline, 5));
    const fraction = (nowMs - dep) / (arr - dep);
    const point = pointAtFraction(coordinates, fraction);
    if (!point) continue;

    const mode = readString(value, "mode") ?? readString(trip, "mode") ?? "TRANSIT";
    const scheduledDeparture = readString(value, "scheduledDeparture");
    const scheduledArrival = readString(value, "scheduledArrival");
    const fromName = readString(from, "name") ?? "Unknown stop";
    const toName = readString(to, "name") ?? "Unknown stop";
    const departureDelay = delayMinutes(departure, scheduledDeparture);
    const arrivalDelay = delayMinutes(arrival, scheduledArrival);
    const line =
      readString(trip, "displayName")
      ?? readString(trip, "tripShortName")
      ?? tripId;
    const routeColor = readString(value, "routeColor");
    const routeTextColor = readString(value, "routeTextColor");
    const fromStop = liveStop(from, point);
    const toStop = liveStop(to, point);

    const vehicle: LiveVehicle = {
      id: `${tripId}:${departure}`,
      tripId,
      line,
      mode,
      modeLabel: liveModeLabel(mode),
      modeGroup: liveModeGroup(mode),
      color: vehicleColor(mode, routeColor),
      textColor: textColorFor(mode, routeTextColor),
      lat: point.lat,
      lon: point.lon,
      bearing: point.bearing,
      delayMin: Math.max(departureDelay, arrivalDelay),
      realTime: readBoolean(value, "realTime") ?? false,
      source: "interpolated",
      phase: nowMs < dep || nowMs > arr ? "dwell" : "moving",
      stops: { from: fromStop, to: toStop },
      fromName,
      toName,
      ...(readString(from, "tz") ? { fromTz: readString(from, "tz") } : {}),
      ...(readString(to, "tz") ? { toTz: readString(to, "tz") } : {}),
      departure,
      arrival,
      ...(scheduledDeparture ? { scheduledDeparture } : {}),
      ...(scheduledArrival ? { scheduledArrival } : {}),
      distanceM: readNumber(value, "distance") ?? 0,
    };
    const candidate: Candidate = {
      vehicle,
      score: Math.abs(nowMs - (dep + arr) / 2),
    };
    const existing = byTrip.get(tripId);
    if (!existing || candidate.score < existing.score) {
      byTrip.set(tripId, candidate);
    }
  }

  return [...byTrip.values()].map((candidate) => candidate.vehicle);
}

/** Stops worth asking for alerts, ordered rail-first. */
export interface AlertStopCandidate {
  /** Parent station id where available; MOTIS resolves children too. */
  stopId: string;
  name: string;
  lat: number;
  lon: number;
  /** Higher wins when more than `max` candidates are available. */
  priority?: number;
}

export interface AlertBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

const MODE_PRIORITY: Record<LiveModeGroup, number> = {
  RAIL: 6,
  SUBWAY: 5,
  TRAM: 4,
  FERRY: 3,
  BUS: 2,
  OTHER: 1,
};

export function liveModePriority(group: LiveModeGroup): number {
  return MODE_PRIORITY[group] ?? 0;
}

/**
 * Stops worth asking for alerts: rail first, deduplicated by parent id and
 * restricted to the current view. A vehicle heading to Heidelberg must not
 * make Heidelberg one of the sampled stops while the map shows Frankfurt.
 */
export function alertStopCandidates(
  vehicles: readonly LiveVehicle[],
  bounds: AlertBounds,
  max = 3,
): AlertStopCandidate[] {
  const byId = new Map<
    string,
    { candidate: AlertStopCandidate; count: number }
  >();
  for (const vehicle of vehicles) {
    for (const stop of [vehicle.stops.from, vehicle.stops.to]) {
      if (!stop.id) continue;
      if (
        stop.lat < bounds.south
        || stop.lat > bounds.north
        || stop.lon < bounds.west
        || stop.lon > bounds.east
      ) {
        continue;
      }
      const priority = liveModePriority(vehicle.modeGroup);
      const existing = byId.get(stop.id);
      if (!existing) {
        byId.set(stop.id, {
          candidate: {
            stopId: stop.id,
            name: stop.name,
            lat: stop.lat,
            lon: stop.lon,
            priority,
          },
          count: 1,
        });
        continue;
      }
      existing.count += 1;
      if (priority > (existing.candidate.priority ?? 0)) {
        existing.candidate.priority = priority;
      }
    }
  }
  return [...byId.values()]
    .sort(
      (a, b) =>
        (b.candidate.priority ?? 0) - (a.candidate.priority ?? 0)
        || b.count - a.count,
    )
    .slice(0, max)
    .map((entry) => entry.candidate);
}

/** Fetch and interpolate active vehicles for a map window. */
export async function fetchLiveVehicles(
  query: LiveVehicleQuery,
): Promise<LiveVehicle[]> {
  const now = query.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];
  if (
    ![query.south, query.west, query.north, query.east, query.zoom].every(
      Number.isFinite,
    )
  ) {
    return [];
  }

  const params = new URLSearchParams({
    min: `${query.south},${query.west}`,
    max: `${query.north},${query.east}`,
    zoom: String(Math.max(0, Math.round(query.zoom))),
    startTime: new Date(nowMs - LOOKBACK_MS).toISOString(),
    endTime: new Date(nowMs + LOOKAHEAD_MS).toISOString(),
    precision: "5",
  });

  const data = await fetchJson<unknown>(
    `${MOTIS_V6_BASE}/map/trips?${params.toString()}`,
    {
      signal: query.signal,
      timeoutMs: LIVE_TIMEOUT_MS,
      provider: "motis",
    },
  );
  return normalizeLiveVehicles(data, nowMs);
}
