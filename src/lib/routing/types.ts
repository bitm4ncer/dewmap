/**
 * Normalized routing types shared by every provider.
 *
 * All coordinates in GeoJSON-style arrays are `[lon, lat, ele?]` so a plan
 * can be dropped straight into MapLibre. Named objects use `{ lat, lon }`.
 */

export type TravelMode = "walk" | "bike" | "car" | "transit";

export type ProviderId = "brouter" | "valhalla" | "motis";

export interface LatLng {
  lat: number;
  lon: number;
}

/** Normalized maneuver kinds. Provider-specific codes live in `rawType`. */
export type ManeuverType =
  | "depart"
  | "arrive"
  | "turn"
  | "continue"
  | "merge"
  | "fork"
  | "roundabout"
  | "ramp"
  | "ferry"
  | "transit"
  | "walk";

export type ManeuverModifier =
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "sharp-left"
  | "sharp-right"
  | "straight"
  | "uturn";

export interface Maneuver {
  type: ManeuverType;
  /** Human-readable instruction, e.g. "Turn left". */
  instruction: string;
  /** Spoken instruction, falls back to `instruction` when unavailable. */
  verbal: string;
  distanceM: number;
  durationS: number;
  /** Index into `RoutePlan.coordinates` where this maneuver starts. */
  startIndex: number;
  /** Index into `RoutePlan.coordinates` where this maneuver ends. */
  endIndex: number;
  streetName?: string;
  modifier?: ManeuverModifier;
  /** Unmodified provider maneuver code, useful for debugging / icons. */
  rawType?: number;
}

export interface TransitStopRef {
  name: string;
  lat: number;
  lon: number;
  platform?: string;
  stopId?: string;
}

/** Whether a leg is walked, cycled, driven, or uses public transport. */
export type TransitLegMode = "walk" | "bike" | "car" | "transit";

export interface TransitLeg {
  /** Normalized leg mode. The provider string is kept in `rawMode`. */
  mode: TransitLegMode;
  /** Raw provider mode, e.g. "TRAM" or "REGIONAL_RAIL". */
  rawMode?: string;
  from: TransitStopRef;
  to: TransitStopRef;
  /** ISO timestamps with real-time data applied. */
  departure: string;
  arrival: string;
  /** ISO timestamps from the timetable, ignoring real-time updates. */
  scheduledDeparture: string;
  scheduledArrival: string;
  realTime: boolean;
  cancelled: boolean;
  /** Short line label, e.g. "RNV 26" or "S1". */
  line?: string;
  agency?: string;
  headsign?: string;
  distanceKm?: number;
  /** `[lon, lat]` polyline for this leg. */
  coordinates: [number, number][];
  intermediateStops?: TransitStopRef[];
  steps?: Maneuver[];
}

export interface TransitJourney {
  departure: string;
  arrival: string;
  durationMin: number;
  transfers: number;
  legs: TransitLeg[];
}

export interface RoutePlan {
  id: string;
  mode: TravelMode;
  provider: ProviderId;
  /** Provider profile / costing used, e.g. "trekking" or "auto". */
  profile?: string;
  distanceKm: number;
  durationMin: number;
  ascentM?: number;
  descentM?: number;
  /** `[lon, lat, ele?]` */
  coordinates: [number, number, number?][];
  maneuvers: Maneuver[];
  /** Short provider summary, when one is available. */
  summary?: string;
  hasToll?: boolean;
  hasHighway?: boolean;
  hasFerry?: boolean;
  transit?: TransitJourney;
}

export interface RouteOptions {
  /** Valhalla costing factors, 0..1 (higher = prefer the road type). */
  useHighways?: number;
  useTolls?: number;
  useFerry?: number;
  /** Convenience flags, converted to 0 / 1 costing factors. */
  avoidHighways?: boolean;
  avoidTolls?: boolean;
  avoidFerries?: boolean;
  /** Valhalla auto costing penalty for service roads (seconds). */
  servicePenalty?: number;
  /** Valhalla: prefer the shortest distance over the fastest time. */
  shortest?: boolean;
  /** Valhalla pedestrian costing factors. */
  walkwayFactor?: number;
  alleyFactor?: number;
  drivewayFactor?: number;
  stepPenalty?: number;
  /** MOTIS transit search window in seconds. */
  searchWindowS?: number;
  /** MOTIS: request detailed transfer walking instructions. */
  detailedTransfers?: boolean;
}

export interface RouteRequest {
  mode: TravelMode;
  /** Ordered stops. Every provider needs at least two. */
  waypoints: LatLng[];
  /** Provider profile/costing override. */
  profile?: string;
  /** Number of route alternatives to request (provider-dependent). */
  alternatives?: number;
  signal?: AbortSignal;
  /** Transit departure time. Defaults to now. */
  departAt?: string | Date;
  /** Transit: plan backwards from `departAt` (arrival time). */
  arriveBy?: boolean;
  /** Transit: maximum number of transfers. */
  maxTransfers?: number;
  /** Transit: prefer wheelchair-accessible journeys. */
  wheelchair?: boolean;
  /** Provider-specific knobs. */
  options?: RouteOptions;
}

export type ProviderErrorKind =
  | "network"
  | "rate-limit"
  | "no-route"
  | "bad-response"
  | "aborted"
  | "unknown";

export interface ProviderErrorOptions {
  status?: number;
  retryAfterS?: number;
  provider?: ProviderId;
  cause?: unknown;
}

/** Typed error thrown by every provider. */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly retryAfterS?: number;
  readonly provider?: ProviderId;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options: ProviderErrorOptions = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ProviderError";
    this.kind = kind;
    this.status = options.status;
    this.retryAfterS = options.retryAfterS;
    this.provider = options.provider;
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}

/** True for both our normalized abort error and native AbortError. */
export function isAbortError(err: unknown): boolean {
  if (isProviderError(err)) return err.kind === "aborted";
  return (
    typeof err === "object"
    && err !== null
    && "name" in err
    && (err as { name?: unknown }).name === "AbortError"
  );
}

export function toProviderError(
  err: unknown,
  provider?: ProviderId,
): ProviderError {
  if (isProviderError(err)) return err;
  if (isAbortError(err)) {
    return new ProviderError("aborted", "Request aborted.", {
      provider,
      cause: err,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError("unknown", message || "Unknown routing error.", {
    provider,
    cause: err,
  });
}

// ---------------------------------------------------------------------------
// Small, dependency-free helpers for narrowing provider JSON (no `any`).
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readNumber(
  source: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readString(
  source: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = source?.[key];
  return typeof value === "string" ? value : undefined;
}

export function readBoolean(
  source: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const value = source?.[key];
  return typeof value === "boolean" ? value : undefined;
}

export function readArray(
  source: Record<string, unknown> | undefined,
  key: string,
): unknown[] {
  const value = source?.[key];
  return Array.isArray(value) ? value : [];
}
