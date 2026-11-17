/**
 * BRouter provider — walking, hiking, cycling, and a car fallback.
 *
 * BRouter's GeoJSON `messages` array is *not* a list of turn instructions
 * (verified against the public server); it contains per-segment routing
 * metadata. Maneuvers are therefore derived from the geometry: cumulative
 * distance plus bearing changes.
 */

import {
  PLAN_TIMEOUT_MS,
  fetchJson,
} from "../http";
import {
  bearingDeg,
  compassDirection,
  cumulativeDistances,
  haversineM,
  normalizeBearingDelta,
} from "../geo";
import {
  ProviderError,
  isAbortError,
  isProviderError,
  isRecord,
  readArray,
  readString,
  type Maneuver,
  type ManeuverModifier,
  type RoutePlan,
  type RouteRequest,
  type TravelMode,
} from "../types";

const BROUTER_URL = "https://brouter.de/brouter";

export const BROUTER_PROFILES = [
  // Walking / hiking
  { id: "hiking-beta", label: "Hike", mode: "walk" },
  { id: "hiking-mountain", label: "Mountain", mode: "walk" },
  { id: "shortest", label: "Shortest", mode: "walk" },
  // Cycling
  { id: "trekking", label: "Trekking", mode: "bike" },
  { id: "fastbike-lowtraffic", label: "Low traffic", mode: "bike" },
  { id: "gravel", label: "Gravel", mode: "bike" },
  { id: "mtb", label: "MTB", mode: "bike" },
  // Car (fallback when Valhalla is unavailable)
  { id: "car-eco", label: "Car eco", mode: "car" },
  { id: "car-fast", label: "Car fast", mode: "car" },
] as const;

export type BrouterProfile = (typeof BROUTER_PROFILES)[number]["id"];

const PROFILE_IDS = new Set<string>(BROUTER_PROFILES.map((p) => p.id));

export function isBrouterProfile(value: string): value is BrouterProfile {
  return PROFILE_IDS.has(value);
}

export function defaultBrouterProfile(
  mode: Exclude<TravelMode, "transit">,
): BrouterProfile {
  if (mode === "walk") return "hiking-beta";
  if (mode === "bike") return "trekking";
  return "car-eco";
}

function profileLabel(profile: BrouterProfile): string {
  return BROUTER_PROFILES.find((p) => p.id === profile)?.label ?? profile;
}

export interface BrouterHandlers {
  /** Called as soon as each alternative arrives. */
  onPlan?: (plan: RoutePlan) => void;
}

function lonlatsParam(waypoints: readonly { lat: number; lon: number }[]): string {
  return waypoints
    .map((point) => `${point.lon.toFixed(6)},${point.lat.toFixed(6)}`)
    .join("|");
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function numericProperty(
  properties: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = properties?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function estimateDurationS(mode: TravelMode, distanceKm: number): number {
  const speedKmh = mode === "walk" ? 4.8 : mode === "bike" ? 16 : 50;
  return (distanceKm / speedKmh) * 3600;
}

// ---------------------------------------------------------------------------
// Geometry -> maneuvers
// ---------------------------------------------------------------------------

const TURN_THRESHOLD_DEG = 25;
const MIN_SEGMENT_M = 5;
/** Do not merge bends that are separated by a long straight stretch. */
const RESET_ACCUMULATION_M = 200;
/** Insert "continue straight" hints on very long instruction-free stretches. */
const CONTINUE_GAP_M = 10_000;
/** Only split stretches that are clearly longer than one chunk. */
const CONTINUE_MIN_GAP_M = 15_000;

interface TurnEvent {
  index: number;
  angle: number;
}

type ActionKind = "depart" | "turn" | "continue" | "arrive";

interface RouteAction {
  index: number;
  kind: ActionKind;
  angle?: number;
}

function detectTurnEvents(
  coordinates: readonly [number, number, number?][],
  cumulative: readonly number[],
): TurnEvent[] {
  if (coordinates.length < 3) return [];

  const distances: number[] = [];
  const bearings: number[] = [];
  for (let i = 1; i < coordinates.length; i++) {
    distances.push(haversineM(coordinates[i - 1], coordinates[i]));
    bearings.push(bearingDeg(coordinates[i - 1], coordinates[i]));
  }

  const raw: TurnEvent[] = [];
  let lastBearing: number | null = null;
  let accumulated = 0;
  let accumulatedIndex = -1;
  let sinceBendM = 0;

  for (let segment = 0; segment < bearings.length; segment++) {
    sinceBendM += distances[segment];
    if (distances[segment] < MIN_SEGMENT_M) continue;
    const bearing = bearings[segment];
    if (lastBearing === null) {
      lastBearing = bearing;
      continue;
    }
    const delta = normalizeBearingDelta(bearing - lastBearing);
    lastBearing = bearing;

    // Ignore GPS/geometry jitter but keep it out of the accumulator.
    if (Math.abs(delta) < 8) continue;

    if (sinceBendM > RESET_ACCUMULATION_M) {
      accumulated = 0;
      accumulatedIndex = -1;
    }
    sinceBendM = 0;

    if (accumulated === 0 || Math.sign(delta) === Math.sign(accumulated)) {
      accumulated += delta;
      accumulatedIndex = segment;
    } else {
      if (
        Math.abs(accumulated) >= TURN_THRESHOLD_DEG
        && accumulatedIndex >= 0
      ) {
        raw.push({ index: accumulatedIndex, angle: accumulated });
      }
      accumulated = delta;
      accumulatedIndex = segment;
    }

    if (Math.abs(accumulated) >= TURN_THRESHOLD_DEG) {
      raw.push({ index: accumulatedIndex, angle: accumulated });
      accumulated = 0;
      accumulatedIndex = -1;
    }
  }

  // Merge turns that are only a few metres apart so a roundabout / hairpin
  // does not produce a burst of near-identical instructions.
  const merged: TurnEvent[] = [];
  for (const event of raw) {
    const index = Math.min(
      Math.max(1, event.index),
      Math.max(1, coordinates.length - 2),
    );
    const previous = merged[merged.length - 1];
    if (
      previous
      && cumulative[index] - cumulative[previous.index] < 25
    ) {
      previous.angle += event.angle;
      previous.index = index;
    } else {
      merged.push({ index, angle: event.angle });
    }
  }
  return merged;
}

function findIndexAtDistance(
  cumulative: readonly number[],
  target: number,
  fromIndex: number,
  toIndex: number,
): number {
  for (let i = fromIndex + 1; i < toIndex; i++) {
    if (cumulative[i] >= target) return i;
  }
  return toIndex;
}

function buildActions(
  turnEvents: readonly TurnEvent[],
  coordinates: readonly [number, number, number?][],
  cumulative: readonly number[],
): RouteAction[] {
  const last = coordinates.length - 1;
  const actions: RouteAction[] = [{ index: 0, kind: "depart" }];

  for (const event of turnEvents) {
    if (event.index <= 0 || event.index >= last) continue;
    actions.push({ index: event.index, kind: "turn", angle: event.angle });
  }
  actions.push({ index: last, kind: "arrive" });

  const expanded: RouteAction[] = [];
  for (const action of actions) {
    const previous = expanded[expanded.length - 1];
    if (previous) {
      const gap = cumulative[action.index] - cumulative[previous.index];
      if (gap > CONTINUE_MIN_GAP_M) {
        for (
          let target = cumulative[previous.index] + CONTINUE_GAP_M;
          target < cumulative[action.index] - 500;
          target += CONTINUE_GAP_M
        ) {
          const index = findIndexAtDistance(
            cumulative,
            target,
            previous.index,
            action.index,
          );
          const lastExpanded = expanded[expanded.length - 1];
          if (index > lastExpanded.index && index < action.index) {
            expanded.push({ index, kind: "continue" });
          }
        }
      }
    }
    // Drop duplicate indices while always keeping the arrival last.
    const current = expanded[expanded.length - 1];
    if (current && action.index === current.index) {
      if (action.kind === "arrive") expanded[expanded.length - 1] = action;
      continue;
    }
    expanded.push(action);
  }
  return expanded;
}

interface TurnDescription {
  instruction: string;
  modifier: ManeuverModifier;
}

function describeTurn(angle: number): TurnDescription {
  const magnitude = Math.abs(angle);
  const side = angle > 0 ? "right" : "left";
  if (magnitude >= 160) {
    return { instruction: "Make a U-turn", modifier: "uturn" };
  }
  if (magnitude >= 100) {
    return {
      instruction: `Turn sharply ${side}`,
      modifier: side === "right" ? "sharp-right" : "sharp-left",
    };
  }
  if (magnitude >= 45) {
    return {
      instruction: `Turn ${side}`,
      modifier: side === "right" ? "right" : "left",
    };
  }
  return {
    instruction: `Bear ${side}`,
    modifier: side === "right" ? "slight-right" : "slight-left",
  };
}

/**
 * Derive navigation maneuvers from a BRouter geometry.
 *
 * This is intentionally deterministic and provider-agnostic: it only needs a
 * `[lon, lat]` list and a total duration. Distances on each maneuver cover the
 * stretch *after* the instruction, matching how navigation UIs present them.
 */
export function deriveBrouterManeuvers(
  coordinates: readonly [number, number, number?][],
  totalDurationS = 0,
): Maneuver[] {
  if (coordinates.length === 0) return [];
  if (coordinates.length === 1) {
    return [
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
        startIndex: 0,
        endIndex: 0,
      },
    ];
  }

  const cumulative = cumulativeDistances(coordinates);
  const totalDistance = cumulative[cumulative.length - 1];
  const turnEvents = detectTurnEvents(coordinates, cumulative);
  const actions = buildActions(turnEvents, coordinates, cumulative);

  let firstBearing: number | null = null;
  for (let i = 1; i < coordinates.length; i++) {
    if (haversineM(coordinates[i - 1], coordinates[i]) >= MIN_SEGMENT_M) {
      firstBearing = bearingDeg(coordinates[i - 1], coordinates[i]);
      break;
    }
  }
  if (firstBearing === null && coordinates.length >= 2) {
    firstBearing = bearingDeg(coordinates[0], coordinates[1]);
  }

  const maneuvers: Maneuver[] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const next = actions[i + 1];
    const startIndex = action.index;
    const endIndex = next ? next.index : action.index;
    const distanceM = Math.max(
      0,
      cumulative[endIndex] - cumulative[startIndex],
    );
    const durationS =
      totalDistance > 0
        ? (totalDurationS * distanceM) / totalDistance
        : totalDurationS / actions.length;

    if (action.kind === "depart") {
      const direction =
        firstBearing === null ? "" : ` ${compassDirection(firstBearing)}`;
      maneuvers.push({
        type: "depart",
        instruction: `Head${direction}`,
        verbal: `Head${direction}.`,
        distanceM: Math.round(distanceM),
        durationS: Math.round(durationS),
        startIndex,
        endIndex,
      });
    } else if (action.kind === "continue") {
      maneuvers.push({
        type: "continue",
        instruction: "Continue straight",
        verbal: "Continue straight.",
        distanceM: Math.round(distanceM),
        durationS: Math.round(durationS),
        startIndex,
        endIndex,
        modifier: "straight",
      });
    } else if (action.kind === "arrive") {
      maneuvers.push({
        type: "arrive",
        instruction: "Arrive at destination",
        verbal: "You have arrived at your destination.",
        distanceM: 0,
        durationS: 0,
        startIndex,
        endIndex: coordinates.length - 1,
      });
    } else {
      const description = describeTurn(action.angle ?? 0);
      maneuvers.push({
        type: "turn",
        instruction: description.instruction,
        verbal: `${description.instruction}.`,
        distanceM: Math.round(distanceM),
        durationS: Math.round(durationS),
        startIndex,
        endIndex,
        modifier: description.modifier,
      });
    }
  }

  return maneuvers;
}

// ---------------------------------------------------------------------------
// BRouter request / response
// ---------------------------------------------------------------------------

interface ParsedFeature {
  coordinates: [number, number, number?][];
  properties?: Record<string, unknown>;
}

function parseFeature(data: unknown): ParsedFeature {
  const root = isRecord(data) ? data : undefined;
  const features = root ? readArray(root, "features") : [];
  const feature = features.find(isRecord);
  if (!feature) {
    throw new ProviderError("no-route", "BRouter returned no route.", {
      provider: "brouter",
    });
  }

  const geometry = isRecord(feature.geometry) ? feature.geometry : undefined;
  const geometryType = readString(geometry, "type");
  const rawCoordinates = geometry ? readArray(geometry, "coordinates") : [];
  if (geometryType !== "LineString" || rawCoordinates.length < 2) {
    throw new ProviderError(
      "no-route",
      "BRouter returned no usable geometry.",
      { provider: "brouter" },
    );
  }

  const coordinates: [number, number, number?][] = [];
  for (const value of rawCoordinates) {
    if (!Array.isArray(value) || value.length < 2) continue;
    const lon = value[0];
    const lat = value[1];
    if (
      typeof lon !== "number"
      || typeof lat !== "number"
      || !Number.isFinite(lon)
      || !Number.isFinite(lat)
    ) {
      continue;
    }
    const elevation = value[2];
    coordinates.push(
      typeof elevation === "number" && Number.isFinite(elevation)
        ? [lon, lat, elevation]
        : [lon, lat],
    );
  }

  if (coordinates.length < 2) {
    throw new ProviderError(
      "no-route",
      "BRouter returned no usable coordinates.",
      { provider: "brouter" },
    );
  }

  return {
    coordinates,
    properties: isRecord(feature.properties) ? feature.properties : undefined,
  };
}

function parseBrouterPlan(params: {
  data: unknown;
  profile: BrouterProfile;
  alternativeIdx: number;
  mode: TravelMode;
  waypoints: readonly { lat: number; lon: number }[];
}): RoutePlan {
  const feature = parseFeature(params.data);
  const { properties, coordinates } = feature;

  const cumulative = cumulativeDistances(coordinates);
  const geometryLengthM = cumulative[cumulative.length - 1];
  const trackLengthM = numericProperty(properties, "track-length");
  const distanceKm = (trackLengthM ?? geometryLengthM) / 1000;

  const totalTimeS = numericProperty(properties, "total-time");
  const durationS =
    totalTimeS !== undefined && totalTimeS > 0
      ? totalTimeS
      : estimateDurationS(params.mode, distanceKm);

  const ascent =
    numericProperty(properties, "filtered ascend")
    ?? numericProperty(properties, "plain-ascend");
  const descent =
    numericProperty(properties, "filtered descend")
    ?? numericProperty(properties, "plain-descend");

  const fingerprint = hashString(
    `${params.profile}:${params.alternativeIdx}:${params.waypoints
      .map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`)
      .join("|")}`,
  );

  return {
    id: `brouter:${params.profile}:${params.alternativeIdx}:${fingerprint}`,
    mode: params.mode,
    provider: "brouter",
    profile: params.profile,
    distanceKm,
    durationMin: durationS / 60,
    ascentM: ascent,
    descentM: descent,
    coordinates,
    maneuvers: deriveBrouterManeuvers(coordinates, durationS),
    summary: `BRouter ${profileLabel(params.profile)}`,
  };
}

function brouterQuery(
  waypoints: readonly { lat: number; lon: number }[],
  profile: BrouterProfile,
  alternativeIdx: number,
): string {
  return new URLSearchParams({
    lonlats: lonlatsParam(waypoints),
    profile,
    alternativeidx: String(alternativeIdx),
    format: "geojson",
  }).toString();
}

async function fetchBrouterAlternative(
  request: RouteRequest,
  profile: BrouterProfile,
  alternativeIdx: number,
): Promise<RoutePlan> {
  const url = `${BROUTER_URL}?${brouterQuery(
    request.waypoints,
    profile,
    alternativeIdx,
  )}`;
  const data = await fetchJson<unknown>(url, {
    signal: request.signal,
    timeoutMs: PLAN_TIMEOUT_MS,
    provider: "brouter",
    noRouteStatuses: [400, 404],
  });

  return parseBrouterPlan({
    data,
    profile,
    alternativeIdx,
    mode: request.mode,
    waypoints: request.waypoints,
  });
}

/**
 * Request one or more BRouter alternatives. Alternatives stream through
 * `handlers.onPlan` as they arrive; the returned array preserves BRouter's
 * `alternativeidx` order.
 */
export async function planBrouter(
  request: RouteRequest,
  handlers: BrouterHandlers = {},
): Promise<RoutePlan[]> {
  if (request.mode === "transit") {
    throw new ProviderError(
      "bad-response",
      "BRouter does not support transit routing.",
      { provider: "brouter" },
    );
  }
  if (request.waypoints.length < 2) {
    throw new ProviderError(
      "bad-response",
      "At least two waypoints are required.",
      { provider: "brouter" },
    );
  }

  const profile: BrouterProfile =
    request.profile && isBrouterProfile(request.profile)
      ? request.profile
      : defaultBrouterProfile(request.mode);

  const count = Math.min(Math.max(1, request.alternatives ?? 3), 5);
  const errors: unknown[] = [];

  const tasks = Array.from({ length: count }, (_, alternativeIdx) =>
    fetchBrouterAlternative(request, profile, alternativeIdx)
      .then((plan) => {
        if (!request.signal?.aborted) handlers.onPlan?.(plan);
        return plan;
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || request.signal?.aborted) throw err;
        errors.push(err);
        return null;
      }),
  );

  const settled = await Promise.all(tasks);
  const plans = settled.filter((plan): plan is RoutePlan => plan !== null);

  if (plans.length === 0) {
    if (errors.length > 0) {
      const firstMeaningful =
        errors.find(
          (err) => !(isProviderError(err) && err.kind === "no-route"),
        ) ?? errors[0];
      throw firstMeaningful;
    }
    throw new ProviderError("no-route", "BRouter returned no route.", {
      provider: "brouter",
    });
  }

  return plans;
}
