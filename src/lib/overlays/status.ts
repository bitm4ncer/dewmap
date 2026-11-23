/**
 * Status lines for the weather cards.
 *
 * Kept out of the JSX so the precedence rules are testable: an error must not
 * hide data we still have, and a failed radar image is its own state (the
 * frame list can be perfectly fine while the PNG never arrives).
 */
import { formatClock } from "./radar";
import type { RadarFramesPayload, WarningsPayload } from "./api";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

export interface RadarStatusInput {
  enabled: boolean;
  status: LoadStatus;
  error: string | null;
  frames: RadarFramesPayload | null;
  imageStatus: LoadStatus;
  imageError: string | null;
  clock?: (iso: string) => string;
}

export function framesInfo(
  frames: RadarFramesPayload | null,
  clock: (iso: string) => string = formatClock,
): string | null {
  if (!frames) return null;
  const analysis = frames.frames.filter((f) => f.kind === "analysis").length;
  const forecast = frames.frames.filter((f) => f.kind === "forecast").length;
  return `${analysis} analysis + ${forecast} nowcast frames · as of ${clock(frames.generated)}`;
}

export function radarStatusLine({
  enabled,
  status,
  error,
  frames,
  imageStatus,
  imageError,
  clock,
}: RadarStatusInput): string | null {
  if (!enabled) return null;
  const info = framesInfo(frames, clock);
  if (imageStatus === "error") {
    return `${imageError ?? "Radar image unavailable."}${info ? ` · ${info}` : ""}`;
  }
  if (status === "loading" && !frames) return "Loading radar frames…";
  if (status === "error") {
    return info ? `${info} · refresh failed` : error ?? "Radar unavailable.";
  }
  return info;
}

export interface WarningsStatusInput {
  enabled: boolean;
  status: LoadStatus;
  error: string | null;
  payload: WarningsPayload | null;
  summary: string | null;
}

export function warningsStatusLine({
  enabled,
  status,
  error,
  payload,
  summary,
}: WarningsStatusInput): string | null {
  if (!enabled) return null;
  if (status === "loading" && !payload) return "Loading warnings…";
  if (status === "error") {
    return summary ? `${summary} · refresh failed` : error ?? "Warnings unavailable.";
  }
  return summary;
}
