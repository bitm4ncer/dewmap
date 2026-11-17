/**
 * Valhalla provider — car routing with toll/highway/ferry preferences.
 *
 * Public demo endpoint: https://valhalla1.openstreetmap.de/route
 * Fair use only; see README.
 */

import { PLAN_TIMEOUT_MS, fetchJson } from "../http";
import { decodePolyline } from "../polyline";
import {
  ProviderError,
  isRecord,
  readArray,
  readBoolean,
  readNumber,
  readString,
  type Maneuver,
  type ManeuverModifier,
  type ManeuverType,
  type RoutePlan,
  type RouteRequest,
  type TravelMode,
} from "../types";

const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route";

export { decodePolyline };

export type ValhallaCosting =
  | "auto"
  | "bus"
  | "taxi"
  | "truck"
  | "bicycle"
  | "pedestrian"
  | "motor_scooter"
  | "motorcycle"
  | "multimodal";

const COSTINGS = new Set<string>([
  "auto",
  "bus",
  "taxi",
  "truck",
  "bicycle",
  "pedestrian",
  "motor_scooter",
  "motorcycle",
  "multimodal",
]);

export function isValhallaCosting(value: string): value is ValhallaCosting {
  return COSTINGS.has(value);
}

export function costingForMode(
  mode: TravelMode,
  profile?: string,
): ValhallaCosting {
  if (profile && isValhallaCosting(profile)) return profile;
  if (mode === "bike") return "bicycle";
  if (mode === "walk") return "pedestrian";
  return "auto";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Valhalla maneuver codes -> normalized types
// ---------------------------------------------------------------------------

/**
 * Valhalla uses a large numeric enum. The official meanings are used here;
 * `rawType` is always preserved on the maneuver so UIs can refine icons.
 */
export function mapValhallaManeuverType(type: number): ManeuverType {
  switch (type) {
    case 1:
    case 2:
    case 3:
      return "depart";
    case 4:
    case 5:
    case 6:
      return "arrive";
    case 7:
    case 8:
    case 22:
      return "continue";
    case 9:
    case 10:
    case 11:
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
    case 20:
    case 21:
      return "turn";
    case 17:
    case 18:
    case 19:
      return "ramp";
    case 23:
    case 24:
      return "fork";
    case 25:
    case 35:
    case 36:
      return "merge";
    case 26:
    case 27:
      return "roundabout";
    case 28:
    case 29:
      return "ferry";
    case 30:
    case 31:
    case 32:
    case 33:
    case 34:
      return "transit";
    default:
      return "continue";
  }
}

export function mapValhallaModifier(
  type: number,
): ManeuverModifier | undefined {
  switch (type) {
    case 9:
      return "slight-right";
    case 10:
      return "slight-left";
    case 11:
      return "sharp-right";
    case 12:
      return "sharp-left";
    case 13:
    case 14:
      return "uturn";
    case 15:
    case 20:
    case 23:
    case 35:
      return "right";
    case 16:
    case 21:
    case 24:
    case 36:
      return "left";
    case 22:
      return "straight";
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Request body
// ---------------------------------------------------------------------------

function costingOptions(
  costing: ValhallaCosting,
  options: RouteRequest["options"],
): Record<string, Record<string, unknown>> | undefined {
  if (!options) return undefined;
  const values: Record<string, unknown> = {};

  const useHighways =
    options.useHighways
    ?? (options.avoidHighways === undefined
      ? undefined
      : options.avoidHighways
        ? 0
        : 1);
  const useTolls =
    options.useTolls
    ?? (options.avoidTolls === undefined
      ? undefined
      : options.avoidTolls
        ? 0
        : 1);
  const useFerry =
    options.useFerry
    ?? (options.avoidFerries === undefined
      ? undefined
      : options.avoidFerries
        ? 0
        : 1);

  if (useHighways !== undefined) values.use_highways = clamp01(useHighways);
  if (useTolls !== undefined) values.use_tolls = clamp01(useTolls);
  if (useFerry !== undefined) values.use_ferry = clamp01(useFerry);

  if (options.shortest) values.shortest = true;
  if (options.servicePenalty !== undefined) {
    values.service_penalty = Math.max(0, options.servicePenalty);
  }
  if (options.walkwayFactor !== undefined) {
    values.walkway_factor = Math.max(0, options.walkwayFactor);
  }
  if (options.alleyFactor !== undefined) {
    values.alley_factor = Math.max(0, options.alleyFactor);
  }
  if (options.drivewayFactor !== undefined) {
    values.driveway_factor = Math.max(0, options.drivewayFactor);
  }
  if (options.stepPenalty !== undefined) {
    values.step_penalty = Math.max(0, options.stepPenalty);
  }

  return Object.keys(values).length > 0 ? { [costing]: values } : undefined;
}

export interface ValhallaRequestBody {
  locations: Array<{ lat: number; lon: number }>;
  costing: ValhallaCosting;
  costing_options?: Record<string, Record<string, unknown>>;
  directions_options: { units: "kilometers"; language: string };
  alternates?: number;
}

export function buildValhallaBody(
  request: RouteRequest,
  costing: ValhallaCosting,
): ValhallaRequestBody {
  const body: ValhallaRequestBody = {
    locations: request.waypoints.map((point) => ({
      lat: point.lat,
      lon: point.lon,
    })),
    costing,
    directions_options: { units: "kilometers", language: "en" },
  };

  const options = costingOptions(costing, request.options);
  if (options) body.costing_options = options;

  const alternates = Math.min(
    Math.max(0, (request.alternatives ?? 1) - 1),
    3,
  );
  if (alternates > 0) body.alternates = alternates;

  return body;
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function parseManeuver(
  value: unknown,
  indexOffset: number,
): Maneuver | null {
  if (!isRecord(value)) return null;
  const rawType = readNumber(value, "type");
  const type = rawType === undefined ? "continue" : mapValhallaManeuverType(rawType);
  const instruction =
    readString(value, "instruction") ?? "Continue";
  const verbal =
    readString(value, "verbal_pre_transition_instruction")
    ?? readString(value, "verbal_succinct_transition_instruction")
    ?? readString(value, "verbal_transition_alert_instruction")
    ?? instruction;

  const streetNames = readArray(value, "street_names").filter(
    (name): name is string => typeof name === "string",
  );
  const modifier =
    rawType === undefined ? undefined : mapValhallaModifier(rawType);

  const maneuver: Maneuver = {
    type,
    instruction,
    verbal,
    distanceM: (readNumber(value, "length") ?? 0) * 1000,
    durationS: readNumber(value, "time") ?? 0,
    startIndex: indexOffset + (readNumber(value, "begin_shape_index") ?? 0),
    endIndex: indexOffset + (readNumber(value, "end_shape_index") ?? 0),
    ...(streetNames[0] ? { streetName: streetNames[0] } : {}),
    ...(rawType === undefined ? {} : { rawType }),
    ...(modifier ? { modifier } : {}),
  };
  return maneuver;
}

function parseTrip(
  trip: unknown,
  params: {
    index: number;
    mode: TravelMode;
    costing: ValhallaCosting;
    waypoints: readonly { lat: number; lon: number }[];
  },
): RoutePlan {
  const record = isRecord(trip) ? trip : undefined;
  if (!record) {
    throw new ProviderError("no-route", "Valhalla returned no trip.", {
      provider: "valhalla",
    });
  }

  const summary = isRecord(record.summary) ? record.summary : undefined;
  const legs = readArray(record, "legs").filter(isRecord);

  const coordinates: [number, number, number?][] = [];
  const maneuvers: Maneuver[] = [];

  for (const leg of legs) {
    const shape = readString(leg, "shape") ?? "";
    const decoded = decodePolyline(shape, 6);
    const offset = coordinates.length;
    for (const point of decoded) {
      coordinates.push([point.lon, point.lat]);
    }
    for (const maneuverValue of readArray(leg, "maneuvers")) {
      const maneuver = parseManeuver(maneuverValue, offset);
      if (maneuver) maneuvers.push(maneuver);
    }
  }

  if (coordinates.length < 2) {
    throw new ProviderError(
      "no-route",
      "Valhalla returned no usable geometry.",
      { provider: "valhalla" },
    );
  }

  if (maneuvers.length === 0) {
    const lastIndex = coordinates.length - 1;
    maneuvers.push(
      {
        type: "depart",
        instruction: "Start route",
        verbal: "Start route.",
        distanceM: 0,
        durationS: 0,
        startIndex: 0,
        endIndex: 0,
      },
      {
        type: "arrive",
        instruction: "Arrive at destination",
        verbal: "You have arrived at your destination.",
        distanceM: 0,
        durationS: 0,
        startIndex: lastIndex,
        endIndex: lastIndex,
      },
    );
  }

  const summaryTime = readNumber(summary, "time");
  const summaryLength = readNumber(summary, "length");
  const distanceKm =
    summaryLength
    ?? maneuvers.reduce((sum, maneuver) => sum + maneuver.distanceM, 0) / 1000;
  const durationMin =
    summaryTime !== undefined
      ? summaryTime / 60
      : maneuvers.reduce((sum, maneuver) => sum + maneuver.durationS, 0) / 60;

  const fingerprint = hashString(
    `${params.costing}:${params.index}:${params.waypoints
      .map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`)
      .join("|")}`,
  );

  return {
    id: `valhalla:${params.costing}:${params.index}:${fingerprint}`,
    mode: params.mode,
    provider: "valhalla",
    profile: params.costing,
    distanceKm,
    durationMin,
    coordinates,
    maneuvers,
    summary: `Valhalla ${params.costing}`,
    hasToll: readBoolean(summary, "has_toll") ?? false,
    hasHighway: readBoolean(summary, "has_highway") ?? false,
    hasFerry: readBoolean(summary, "has_ferry") ?? false,
  };
}

function parseValhallaResponse(
  data: unknown,
  params: {
    mode: TravelMode;
    costing: ValhallaCosting;
    waypoints: readonly { lat: number; lon: number }[];
  },
): RoutePlan[] {
  const root = isRecord(data) ? data : undefined;
  const trip = root && isRecord(root.trip) ? root.trip : undefined;
  if (!trip) {
    const error = root ? readString(root, "error") : undefined;
    throw new ProviderError(
      "no-route",
      error ? `Valhalla: ${error}` : "Valhalla returned no route.",
      { provider: "valhalla" },
    );
  }

  const trips: unknown[] = [trip];
  if (root) {
    for (const alternate of readArray(root, "alternates")) {
      if (!isRecord(alternate)) continue;
      if (isRecord(alternate.trip)) trips.push(alternate.trip);
    }
  }

  return trips.map((value, index) =>
    parseTrip(value, {
      index,
      mode: params.mode,
      costing: params.costing,
      waypoints: params.waypoints,
    }),
  );
}

/**
 * Plan a car (or explicitly-costed) route with Valhalla.
 * Returns the primary trip followed by any alternates.
 */
export async function planValhalla(
  request: RouteRequest,
): Promise<RoutePlan[]> {
  if (request.waypoints.length < 2) {
    throw new ProviderError(
      "bad-response",
      "At least two waypoints are required.",
      { provider: "valhalla" },
    );
  }

  const costing = costingForMode(request.mode, request.profile);
  const body = buildValhallaBody(request, costing);
  const data = await fetchJson<unknown>(VALHALLA_URL, {
    method: "POST",
    json: body,
    signal: request.signal,
    timeoutMs: PLAN_TIMEOUT_MS,
    provider: "valhalla",
    noRouteStatuses: [400, 404, 422],
  });

  return parseValhallaResponse(data, {
    mode: request.mode,
    costing,
    waypoints: request.waypoints,
  });
}
