/**
 * Decide what to compute: which bbox, at which resolution, and whether the
 * pilot has any data there at all.
 *
 * Kept apart from the worker so the panel can answer "zoom in", "outside the
 * pilot" and "window clipped" without starting a computation, and so the
 * rules are unit-testable without a map.
 */
import { bboxSpanM, localFrame, normalizeBbox } from "./geometry";
import { resolutionForZoom } from "./tiles";
import { MAX_REQUEST_CELLS, MAX_WINDOW_M, PILOT_BBOX, PILOT_MIN_ZOOM } from "./pilot";
import type { Bbox } from "./types";

export type ShadowWindowKind = "ok" | "zoomed-out" | "outside";

export interface ShadowWindow {
  kind: ShadowWindowKind;
  /** Window actually rasterised (intersection of viewport and pilot). */
  bbox: Bbox | null;
  resolutionM: number;
  width: number;
  height: number;
  /** The viewport extends past the pilot or past `MAX_WINDOW_M`. */
  partial: boolean;
  /** Viewport the map is showing, for the panel copy. */
  viewport: Bbox;
}

const METRES_PER_DEG_LAT = 111_132;

/** Area of the intersection of two non-crossing bboxes, in deg². */
export function bboxIntersection(a: Bbox, b: Bbox): Bbox | null {
  const west = Math.max(a[0], b[0]);
  const south = Math.max(a[1], b[1]);
  const east = Math.min(a[2], b[2]);
  const north = Math.min(a[3], b[3]);
  if (west >= east || south >= north) return null;
  return [west, south, east, north];
}

/** Share of `inner` covered by `outer`, 0..1 by planar area. */
export function bboxCoverage(inner: Bbox, outer: Bbox): number {
  const area = (b: Bbox) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const total = area(inner);
  if (total <= 0) return 0;
  const inside = bboxIntersection(inner, outer);
  return inside ? Math.min(1, area(inside) / total) : 0;
}

/** Centre-aligned window of at most `maxM` metres around the viewport. */
export function clampWindow(viewport: Bbox, maxM = MAX_WINDOW_M): { bbox: Bbox; clipped: boolean } {
  const bbox = normalizeBbox(viewport);
  const span = bboxSpanM(bbox, localFrame(bbox));
  if (span.x <= maxM && span.y <= maxM) return { bbox, clipped: false };
  const lon = (bbox[0] + bbox[2]) / 2;
  const lat = (bbox[1] + bbox[3]) / 2;
  const latSpan = maxM / METRES_PER_DEG_LAT;
  const lonSpan = maxM / (METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return {
    bbox: [lon - lonSpan / 2, lat - latSpan / 2, lon + lonSpan / 2, lat + latSpan / 2],
    clipped: true,
  };
}

/**
 * Output resolution: the engine's per-zoom table (2–8 m), raised until the
 * cell budget holds. The budget wins: an oversized bbox gets coarser cells
 * rather than a worker run that blocks the UI for seconds. `planShadowWindow`
 * caps the window first, so in the app this only ever returns 2–8 m.
 */
export function resolutionForWindow(bbox: Bbox, zoom: number): number {
  const lat = (bbox[1] + bbox[3]) / 2;
  const base = Math.min(8, Math.max(2, resolutionForZoom(zoom, lat)));
  const span = bboxSpanM(bbox, localFrame(bbox));
  const area = span.x * span.y;
  const needed = Math.sqrt(area / MAX_REQUEST_CELLS);
  return Math.max(base, Math.ceil(needed));
}

/**
 * Full plan for one map viewport.
 *
 * Order matters: the zoom gate first (cheap, and the honest message), then the
 * coverage gate, then the size caps.
 */
export function planShadowWindow(
  viewport: Bbox,
  zoom: number,
  options: {
    minZoom?: number;
    pilot?: Bbox;
    maxWindowM?: number;
    maxCells?: number;
  } = {},
): ShadowWindow {
  const minZoom = options.minZoom ?? PILOT_MIN_ZOOM;
  const pilot = options.pilot ?? PILOT_BBOX;
  const normalized = normalizeBbox(viewport);
  const empty: ShadowWindow = {
    kind: "zoomed-out",
    bbox: null,
    resolutionM: 0,
    width: 0,
    height: 0,
    partial: false,
    viewport: normalized,
  };
  if (zoom < minZoom) return empty;

  const coverage = bboxCoverage(normalized, pilot);
  if (coverage <= 0.02) return { ...empty, kind: "outside" };

  const clamped = clampWindow(normalized, options.maxWindowM ?? MAX_WINDOW_M);
  const bbox = bboxIntersection(clamped.bbox, pilot);
  if (!bbox) return { ...empty, kind: "outside" };

  const resolutionM = resolutionForWindow(bbox, zoom);
  const span = bboxSpanM(bbox, localFrame(bbox));
  const width = Math.max(1, Math.ceil(span.x / resolutionM));
  const height = Math.max(1, Math.ceil(span.y / resolutionM));
  return {
    kind: "ok",
    bbox,
    resolutionM,
    width,
    height,
    // Clipped by the 6 km cap, by the pilot edge, or both.
    partial: coverage < 0.98 || clamped.clipped,
    viewport: normalized,
  };
}
