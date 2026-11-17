/**
 * MOTIS / Transitous provider — public transport journeys and stop search.
 *
 * Endpoint: https://api.transitous.org/api/v1
 * Transitous is free for non-commercial use; see README.
 */

import { GEOCODE_TIMEOUT_MS, PLAN_TIMEOUT_MS, fetchJson } from "../http";
import { cumulativeDistances, haversineM } from "../geo";
import { decodePolyline, toLonLat } from "../polyline";
import {
  ProviderError,
  isRecord,
  readArray,
  readBoolean,
  readNumber,
  readString,
  type LatLng,
  type Maneuver,
  type RoutePlan,
  type RouteRequest,
  type TransitJourney,
  type TransitLeg,
  type TransitLegMode,
  type TransitStopRef,
} from "../types";

const MOTIS_BASE = "https://api.transitous.org/api/v1";

export interface MotisStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: string;
  modes: string[];
  country?: string;
  areas: string[];
}

function degreeDistance(a: [number, number], b: LatLng): number {
  return Math.hypot(a[0] - b.lon, a[1] - b.lat);
}

function endpointError(
  coordinates: readonly [number, number][],
  from: LatLng,
  to: LatLng,
): number {
  if (coordinates.length === 0) return Number.POSITIVE_INFINITY;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  return degreeDistance(first, from) + degreeDistance(last, to);
}

/**
 * MOTIS encodes polylines at precision 7 today but the field is not always
 * present. Decode candidates and pick the one whose endpoints line up with
 * the leg's `from` / `to` stops. Also handles reversed geometry.
 */
export function decodeLegGeometry(
  geometry: unknown,
  from: LatLng,
  to: LatLng,
): [number, number][] {
  if (!isRecord(geometry)) return [];
  const encoded = readString(geometry, "points");
  if (!encoded) return [];

  const advertised = readNumber(geometry, "precision");
  const precisions: number[] = [];
  if (advertised !== undefined && Number.isInteger(advertised)) {
    precisions.push(advertised);
  }
  for (const fallback of [7, 6]) {
    if (!precisions.includes(fallback)) precisions.push(fallback);
  }

  let best: { coordinates: [number, number][]; error: number } | null = null;

  for (const precision of precisions) {
    const decoded = decodePolyline(encoded, precision);
    if (decoded.length === 0) continue;
    const coordinates = toLonLat(decoded);
    const forwardError = endpointError(coordinates, from, to);
    const reversed = [...coordinates].reverse();
    const reverseError = endpointError(reversed, from, to);
    const candidate =
      reverseError < forwardError
        ? { coordinates: reversed, error: reverseError }
        : { coordinates, error: forwardError };

    if (best === null || candidate.error < best.error) best = candidate;
    // ~110 m per 0.001 degrees; a correct decode is usually far below this.
    if (best.error < 0.002) break;
  }

  return best?.coordinates ?? [];
}

function stringOrNumber(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function platformOf(stop: Record<string, unknown> | undefined): string | undefined {
  if (!stop) return undefined;
  return stringOrNumber(stop.track)
    ?? stringOrNumber(stop.scheduledTrack)
    ?? stringOrNumber(stop.platform);
}

function parseStop(value: unknown): TransitStopRef {
  const stop = isRecord(value) ? value : undefined;
  return {
    name: readString(stop, "name") ?? "Unknown stop",
    lat: readNumber(stop, "lat") ?? 0,
    lon: readNumber(stop, "lon") ?? 0,
    ...(platformOf(stop) ? { platform: platformOf(stop) } : {}),
    ...(readString(stop, "stopId")
      ? { stopId: readString(stop, "stopId") }
      : readString(stop, "id")
        ? { stopId: readString(stop, "id") }
        : {}),
  };
}

function normalizeLegMode(rawMode: string): TransitLegMode {
  const mode = rawMode.toUpperCase();
  if (mode === "WALK" || mode === "ODM") return "walk";
  if (mode === "BIKE" || mode === "BICYCLE") return "bike";
  if (mode === "CAR" || mode === "TAXI") return "car";
  return "transit";
}

function legDistanceKm(
  leg: Record<string, unknown>,
  coordinates: readonly [number, number][],
): number | undefined {
  const meters = readNumber(leg, "distance");
  if (meters !== undefined && Number.isFinite(meters)) return meters / 1000;
  if (coordinates.length >= 2) {
    return cumulativeDistances(coordinates)[coordinates.length - 1] / 1000;
  }
  return undefined;
}

function legInstruction(leg: TransitLeg): string {
  if (leg.mode === "walk") {
    return leg.to.name ? `Walk to ${leg.to.name}` : "Walk";
  }
  if (leg.mode === "bike") {
    return leg.to.name ? `Cycle to ${leg.to.name}` : "Cycle";
  }
  if (leg.mode === "car") {
    return leg.to.name ? `Drive to ${leg.to.name}` : "Drive";
  }
  const label = leg.line ?? leg.rawMode ?? "transit";
  return leg.headsign
    ? `Take ${label} toward ${leg.headsign}`
    : `Take ${label}`;
}

function parseIntermediateStops(value: unknown): TransitStopRef[] | undefined {
  const stops = readArray(
    isRecord(value) ? value : undefined,
    "intermediateStops",
  )
    .filter(isRecord)
    .map(parseStop)
    .filter((stop) => stop.name !== "Unknown stop");
  return stops.length > 0 ? stops : undefined;
}

function parseLeg(value: unknown): TransitLeg | null {
  if (!isRecord(value)) return null;
  const fromRaw = isRecord(value.from) ? value.from : undefined;
  const toRaw = isRecord(value.to) ? value.to : undefined;
  const from = parseStop(fromRaw);
  const to = parseStop(toRaw);
  const rawMode = readString(value, "mode") ?? "WALK";
  const mode = normalizeLegMode(rawMode);

  const decoded = decodeLegGeometry(value.legGeometry, from, to);
  const coordinates: [number, number][] =
    decoded.length >= 2
      ? decoded
      : [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ];

  const departure =
    readString(value, "startTime")
    ?? readString(fromRaw, "departure")
    ?? readString(value, "scheduledStartTime")
    ?? "";
  const arrival =
    readString(value, "endTime")
    ?? readString(toRaw, "arrival")
    ?? readString(value, "scheduledEndTime")
    ?? "";
  const scheduledDeparture =
    readString(value, "scheduledStartTime")
    ?? readString(fromRaw, "scheduledDeparture")
    ?? departure;
  const scheduledArrival =
    readString(value, "scheduledEndTime")
    ?? readString(toRaw, "scheduledArrival")
    ?? arrival;

  const routeShortName = readString(value, "routeShortName");
  const displayName = readString(value, "displayName");
  const routeLongName = readString(value, "routeLongName");
  const line = routeShortName ?? displayName ?? routeLongName;
  const agency = readString(value, "agencyName");
  const headsign = readString(value, "headsign");
  const distanceKm = legDistanceKm(value, coordinates);

  const cancelled =
    readBoolean(value, "cancelled")
    ?? readBoolean(fromRaw, "cancelled")
    ?? readBoolean(toRaw, "cancelled")
    ?? false;

  const leg: TransitLeg = {
    mode,
    rawMode,
    from,
    to,
    departure,
    arrival,
    scheduledDeparture,
    scheduledArrival,
    realTime: readBoolean(value, "realTime") ?? false,
    cancelled,
    coordinates,
    ...(line ? { line } : {}),
    ...(agency ? { agency } : {}),
    ...(headsign ? { headsign } : {}),
    ...(distanceKm !== undefined ? { distanceKm } : {}),
  };

  const intermediateStops = parseIntermediateStops(value);
  if (intermediateStops) leg.intermediateStops = intermediateStops;

  return leg;
}

function stopKey(stop: TransitStopRef): string {
  return stop.stopId ?? `${stop.name}@${stop.lat},${stop.lon}`;
}

/**
 * Normalize a MOTIS itinerary into a `RoutePlan` with `transit` metadata.
 * Exported for fixture-based tests and for callers that already have JSON.
 */
export function normalizeMotisItinerary(
  value: unknown,
  index = 0,
): RoutePlan {
  const itinerary = isRecord(value) ? value : undefined;
  const legs = readArray(itinerary, "legs")
    .map(parseLeg)
    .filter((leg): leg is TransitLeg => leg !== null);

  if (legs.length === 0) {
    throw new ProviderError(
      "no-route",
      "MOTIS returned an itinerary without legs.",
      { provider: "motis" },
    );
  }

  const coordinates: [number, number, number?][] = [];
  const maneuvers: Maneuver[] = [];

  for (const leg of legs) {
    const startIndex = Math.max(0, coordinates.length - 1);
    for (const coordinate of leg.coordinates) {
      const previous = coordinates[coordinates.length - 1];
      if (
        previous
        && previous[0] === coordinate[0]
        && previous[1] === coordinate[1]
      ) {
        continue;
      }
      coordinates.push([coordinate[0], coordinate[1]]);
    }
    const endIndex = Math.max(startIndex, coordinates.length - 1);
    const distanceM = (leg.distanceKm ?? 0) * 1000;
    const durationS = legDurationS(leg);
    maneuvers.push({
      type:
        leg.mode === "walk"
          ? "walk"
          : leg.mode === "transit"
            ? "transit"
            : "continue",
      instruction: legInstruction(leg),
      verbal: `${legInstruction(leg)}.`,
      distanceM,
      durationS,
      startIndex,
      endIndex,
    });
  }

  const lastIndex = Math.max(0, coordinates.length - 1);
  maneuvers.push({
    type: "arrive",
    instruction: "Arrive at destination",
    verbal: "You have arrived at your destination.",
    distanceM: 0,
    durationS: 0,
    startIndex: lastIndex,
    endIndex: lastIndex,
  });

  const departure =
    readString(itinerary, "startTime") ?? legs[0].departure;
  const arrival =
    readString(itinerary, "endTime") ?? legs[legs.length - 1].arrival;
  const durationS =
    readNumber(itinerary, "duration")
    ?? legs.reduce((sum, leg) => sum + legDurationS(leg), 0);
  const transitLegs = legs.filter((leg) => leg.mode === "transit");
  const transfers =
    readNumber(itinerary, "transfers")
    ?? Math.max(0, transitLegs.length - 1);

  const journey: TransitJourney = {
    departure,
    arrival,
    durationMin: durationS / 60,
    transfers,
    legs,
  };

  const startKey = stopKey(legs[0].from);
  const endKey = stopKey(legs[legs.length - 1].to);

  return {
    id: `motis:${index}:${transitLegs.length}:${startKey}:${endKey}:${departure}`,
    mode: "transit",
    provider: "motis",
    distanceKm: sumCoordinateKm(coordinates),
    durationMin: durationS / 60,
    coordinates,
    maneuvers,
    summary: transitLegs.length > 0
      ? `${transitLegs.length} transit leg${transitLegs.length === 1 ? "" : "s"}`
      : "Walk",
    transit: journey,
  };
}

function legDurationS(leg: TransitLeg): number {
  const departure = Date.parse(leg.departure);
  const arrival = Date.parse(leg.arrival);
  if (!Number.isNaN(departure) && !Number.isNaN(arrival)) {
    return Math.max(0, (arrival - departure) / 1000);
  }
  return 0;
}

function sumCoordinateKm(
  coordinates: readonly [number, number, number?][],
): number {
  if (coordinates.length < 2) return 0;
  let meters = 0;
  for (let i = 1; i < coordinates.length; i++) {
    meters += haversineM(coordinates[i - 1], coordinates[i]);
  }
  return meters / 1000;
}

function resolveTime(departAt: string | Date | undefined): string {
  if (departAt instanceof Date) {
    const time = departAt.getTime();
    return new Date(Number.isNaN(time) ? Date.now() : time).toISOString();
  }
  if (typeof departAt === "string") {
    const parsed = Date.parse(departAt);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

/**
 * Plan public-transport journeys between the first and last waypoint.
 * Intermediate waypoints are ignored (MOTIS only takes from/to).
 */
export async function planMotis(request: RouteRequest): Promise<RoutePlan[]> {
  if (request.waypoints.length < 2) {
    throw new ProviderError(
      "bad-response",
      "At least two waypoints are required.",
      { provider: "motis" },
    );
  }

  const from = request.waypoints[0];
  const to = request.waypoints[request.waypoints.length - 1];
  const params = new URLSearchParams({
    fromPlace: `${from.lat},${from.lon}`,
    toPlace: `${to.lat},${to.lon}`,
    time: resolveTime(request.departAt),
    arriveBy: String(request.arriveBy ?? false),
    numItineraries: String(Math.min(Math.max(1, request.alternatives ?? 3), 5)),
    detailedTransfers: String(request.options?.detailedTransfers ?? false),
  });

  if (request.maxTransfers !== undefined) {
    params.set("maxTransfers", String(Math.max(0, request.maxTransfers)));
  }
  if (request.wheelchair) params.set("wheelchair", "true");
  if (request.options?.searchWindowS !== undefined) {
    params.set(
      "searchWindow",
      String(Math.max(0, Math.round(request.options.searchWindowS))),
    );
  }

  const data = await fetchJson<unknown>(
    `${MOTIS_BASE}/plan?${params.toString()}`,
    {
      signal: request.signal,
      timeoutMs: PLAN_TIMEOUT_MS,
      provider: "motis",
      noRouteStatuses: [400, 404, 422],
    },
  );

  const root = isRecord(data) ? data : undefined;
  const itineraries = readArray(root, "itineraries").filter(isRecord);
  const direct = readArray(root, "direct").filter(isRecord);
  const results = itineraries.length > 0 ? itineraries : direct;

  if (results.length === 0) {
    throw new ProviderError(
      "no-route",
      "No public transport journey found.",
      { provider: "motis" },
    );
  }

  return results.map((itinerary, index) =>
    normalizeMotisItinerary(itinerary, index),
  );
}

/** Search stops (and only stops) by free text. */
export async function geocodeStops(
  text: string,
  signal?: AbortSignal,
  limit = 8,
): Promise<MotisStop[]> {
  const query = text.trim();
  if (query.length < 2) return [];

  const params = new URLSearchParams({ text: query, type: "STOP" });
  const data = await fetchJson<unknown>(
    `${MOTIS_BASE}/geocode?${params.toString()}`,
    {
      signal,
      timeoutMs: GEOCODE_TIMEOUT_MS,
      provider: "motis",
    },
  );

  const values = Array.isArray(data) ? data : [];
  const stops: MotisStop[] = [];

  for (const value of values) {
    if (!isRecord(value)) continue;
    const type = readString(value, "type") ?? "STOP";
    if (type !== "STOP") continue;
    const lat = readNumber(value, "lat");
    const lon = readNumber(value, "lon");
    if (lat === undefined || lon === undefined) continue;

    const modes = readArray(value, "modes").filter(
      (mode): mode is string => typeof mode === "string",
    );
    const areas = readArray(value, "areas")
      .filter(isRecord)
      .map((area) => readString(area, "name"))
      .filter((name): name is string => Boolean(name));

    stops.push({
      id: readString(value, "id") ?? `${lat},${lon}`,
      name: readString(value, "name") ?? "Unknown stop",
      lat,
      lon,
      type,
      modes,
      ...(readString(value, "country")
        ? { country: readString(value, "country") }
        : {}),
      areas,
    });

    if (stops.length >= Math.max(1, limit)) break;
  }

  return stops;
}
