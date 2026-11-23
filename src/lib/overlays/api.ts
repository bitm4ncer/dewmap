/**
 * Gateway client.
 *
 * The app talks to exactly two JSON endpoints on the dewmap data API. Both
 * are cached and gzipped upstream; this module only adds a timeout, shape
 * validation and one error type so the UI can say something useful.
 */
import type { RadarFrame, RadarImage } from "./types";

export const DATA_API_BASE = (
  process.env.NEXT_PUBLIC_DEWMAP_DATA_API ?? "https://data.dewmap.app"
).replace(/\/+$/, "");

export function dataApiUrl(path: string): string {
  return path.startsWith("http") ? path : `${DATA_API_BASE}${path}`;
}

export type OverlayApiCode =
  | "timeout"
  | "offline"
  | "bad_response"
  | "upstream"
  | "aborted";

export class OverlayApiError extends Error {
  readonly code: OverlayApiCode;
  readonly status: number;

  constructor(code: OverlayApiCode, message: string, status = 0) {
    super(message);
    this.name = "OverlayApiError";
    this.code = code;
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof OverlayApiError
      ? error.code === "aborted"
      : (error as { name?: string } | null)?.name === "AbortError"
  );
}

export function overlayErrorMessage(error: unknown): string {
  if (error instanceof OverlayApiError) {
    switch (error.code) {
      case "timeout":
        return "The source did not answer in time. Retrying in a few minutes.";
      case "offline":
        return "Cannot reach the data source.";
      case "bad_response":
        return "The source returned unexpected data.";
      case "upstream":
        return "The source is unavailable right now.";
      default:
        return "Cancelled.";
    }
  }
  return "The source is unavailable right now.";
}

interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

async function getJson<T>(
  path: string,
  { signal, timeoutMs = 12_000 }: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", forward, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(dataApiUrl(path), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new OverlayApiError(
        res.status >= 500 ? "upstream" : "bad_response",
        `HTTP ${res.status}`,
        res.status,
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new OverlayApiError("bad_response", "invalid JSON");
    }
  } catch (error) {
    if (error instanceof OverlayApiError) throw error;
    if (signal?.aborted) throw new OverlayApiError("aborted", "aborted");
    if ((error as { name?: string })?.name === "AbortError") {
      throw new OverlayApiError("timeout", "timeout");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new OverlayApiError("offline", "offline");
    }
    throw new OverlayApiError("offline", String((error as Error)?.message ?? error));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forward);
  }
}

export interface RadarFramesPayload {
  ok: true;
  generated: string;
  now: string;
  anchor: string;
  intervalMinutes: number;
  forecastIntervalMinutes: number;
  image: RadarImage;
  source: string;
  attribution: { label: string; url?: string };
  frames: RadarFrame[];
}

function isFrame(value: unknown): value is RadarFrame {
  const frame = value as Partial<RadarFrame> | null;
  return Boolean(
    frame &&
      typeof frame.slot === "string" &&
      typeof frame.time === "string" &&
      typeof frame.url === "string" &&
      (frame.kind === "analysis" || frame.kind === "forecast"),
  );
}

/**
 * The frame list is computed by the gateway without an upstream call, so a
 * short budget is fine; the *image* is fetched by MapLibre, not through here.
 */
export async function fetchRadarFrames(
  options?: RequestOptions,
): Promise<RadarFramesPayload> {
  const payload = await getJson<RadarFramesPayload>(
    "/api/weather/radar/frames",
    { timeoutMs: 15_000, ...options },
  );
  if (
    !payload ||
    payload.ok !== true ||
    !Array.isArray(payload.frames) ||
    payload.frames.length === 0 ||
    !payload.frames.every(isFrame) ||
    typeof payload.anchor !== "string"
  ) {
    throw new OverlayApiError("bad_response", "unexpected frame payload");
  }
  return payload;
}

export interface WarningItem {
  id: string;
  cellId: string;
  level: number;
  levelLabel: string;
  type: number | null;
  typeLabel: string;
  event: string;
  headline: string;
  description: string;
  instruction: string;
  area: string;
  state: string;
  stateShort: string;
  from: string | null;
  to: string | null;
  altitudeFrom: number | null;
  altitudeTo: number | null;
}

export interface WarningsPayload {
  ok: true;
  generated: string;
  issuedAt: string | null;
  counts: Record<string, number>;
  total: number;
  maxLevel: number;
  validUntil: string | null;
  warnings: WarningItem[];
  areas: GeoJSON.FeatureCollection;
  areasComplete: boolean;
  /** Warned cells the DWD geometry layers do not cover. */
  areasMissing?: number;
  /** The WFS itself failed — no geometries at all for this payload. */
  areasUnavailable?: boolean;
  source: { warnings: string; areas: string };
  attribution: { label: string; url?: string };
}

export async function fetchWarnings(
  options?: RequestOptions,
): Promise<WarningsPayload> {
  // Worst case on the gateway is a cold build: 15 s for warnings.json plus
  // 15 s for the warncell geometries. The client has to outlast that, or the
  // first visitor after a restart sees a timeout for a request that would
  // have succeeded.
  const payload = await getJson<WarningsPayload>(
    "/api/weather/warnings",
    { timeoutMs: 40_000, ...options },
  );
  if (
    !payload ||
    payload.ok !== true ||
    !Array.isArray(payload.warnings) ||
    !payload.areas ||
    payload.areas.type !== "FeatureCollection" ||
    !Array.isArray(payload.areas.features)
  ) {
    throw new OverlayApiError("bad_response", "unexpected warnings payload");
  }
  return payload;
}
