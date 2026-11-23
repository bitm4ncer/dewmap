/**
 * Worker protocol and request handling.
 *
 * The handler is a pure async function so the message contract, the empty
 * states and the version counter can be tested in Node without a browser.
 * `worker.ts` is only the `onmessage` shell around it.
 *
 * Cancellation: the worker terminates and is recreated by
 * `ShadowWorkerClient`, because a synchronous ray-march cannot observe a
 * message posted while it runs. That is the only reliable abort.
 */
import { duskAlpha, renderShadowWindow, type SerializedBuildings } from "./render";
import type { Bbox, ShadowMask, SolarPosition } from "./types";

export interface ShadowRenderRequest {
  type: "render";
  /** Monotonic per client; the worker echoes it back. */
  id: number;
  bbox: Bbox;
  timeMs: number;
  resolutionM: number;
  buildings: SerializedBuildings;
}

export interface ShadowCancelRequest {
  type: "cancel";
  id: number;
}

export type ShadowWorkerRequest = ShadowRenderRequest | ShadowCancelRequest;

export interface ShadowWorkerStats {
  buildingCount: number;
  cells: number;
  shadowFraction: number;
  computeMs: number;
  encodeMs: number;
}

export type ShadowWorkerResponse =
  | {
      type: "result";
      id: number;
      pngUrl: string;
      bbox: Bbox;
      width: number;
      height: number;
      resolutionM: number;
      sun: SolarPosition;
      stats: ShadowWorkerStats;
    }
  | {
      type: "empty";
      id: number;
      reason: "no-buildings" | "night" | "too-large";
      sun: SolarPosition | null;
    }
  | {
      type: "error";
      id: number;
      code: "no-canvas" | "compute" | "invalid";
      message: string;
    };

export type ShadowMaskEncoder = (
  mask: ShadowMask,
  options: { alpha: number },
) => Promise<string | null>;

/**
 * One message in, one response out. Returns `null` for messages that need no
 * answer (cancel).
 */
export async function handleShadowRequest(
  request: ShadowWorkerRequest,
  encode: ShadowMaskEncoder,
): Promise<ShadowWorkerResponse | null> {
  if (!request || typeof request !== "object") return null;
  if (request.type === "cancel") return null;
  if (request.type !== "render" || typeof request.id !== "number") {
    return { type: "error", id: -1, code: "invalid", message: "unknown message" };
  }
  const { id, bbox, timeMs, resolutionM, buildings } = request;
  if (
    !Array.isArray(bbox) ||
    bbox.length !== 4 ||
    !bbox.every((value) => Number.isFinite(value)) ||
    !Number.isFinite(timeMs) ||
    !Number.isFinite(resolutionM) ||
    resolutionM <= 0 ||
    !buildings ||
    buildings.count !== buildings.heights.length
  ) {
    return { type: "error", id, code: "invalid", message: "malformed render request" };
  }

  let output;
  try {
    output = renderShadowWindow({ bbox, timeMs, resolutionM, buildings });
  } catch (error) {
    return {
      type: "error",
      id,
      code: "compute",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (output.status !== "rendered" || !output.mask) {
    return {
      type: "empty",
      id,
      reason: output.status === "night" ? "night" : output.status === "too-large" ? "too-large" : "no-buildings",
      sun: output.sun,
    };
  }

  const encodeStarted = Date.now();
  let pngUrl: string | null = null;
  try {
    pngUrl = await encode(output.mask, { alpha: duskAlpha(output.sun.elevationDeg) });
  } catch (error) {
    return {
      type: "error",
      id,
      code: "compute",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!pngUrl) {
    return { type: "error", id, code: "no-canvas", message: "PNG encoding unavailable" };
  }

  return {
    type: "result",
    id,
    pngUrl,
    bbox: output.bbox,
    width: output.width,
    height: output.height,
    resolutionM: output.resolutionM,
    sun: output.sun,
    stats: {
      ...output.stats,
      encodeMs: Date.now() - encodeStarted,
    },
  };
}
