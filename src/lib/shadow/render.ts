/**
 * The viewport render: serialise footprints for the worker, rasterise, ray-march.
 *
 * Pure except for `performance.now()`. No DOM, no network, no MapLibre — the
 * worker calls this and the tests call it directly.
 */
import { solarPosition } from "./sun";
import { computeShadowLayer } from "./index";
import { MAX_REQUEST_CELLS } from "./pilot";
import type { Bbox, BuildingFootprint, ShadowMask, SolarPosition } from "./types";

/**
 * Transferable building payload.
 *
 * A `BuildingFootprint[]` with nested arrays is ~40 objects per building and
 * structured-clones into the worker one property at a time. Three typed
 * arrays move as buffers instead; 5000 buildings cost ~0.5 ms to unpack.
 */
export interface SerializedBuildings {
  count: number;
  /** Height in metres per building. */
  heights: Float32Array;
  /** `offsets[i] .. offsets[i + 1]` index into `coords` (lon/lat pairs). */
  offsets: Uint32Array;
  coords: Float64Array;
  ids: string[];
}

export function serializeBuildings(buildings: readonly BuildingFootprint[]): SerializedBuildings {
  let points = 0;
  for (const building of buildings) points += building.ring.length;
  const heights = new Float32Array(buildings.length);
  const offsets = new Uint32Array(buildings.length + 1);
  const coords = new Float64Array(points * 2);
  const ids: string[] = [];
  let pointIndex = 0;
  buildings.forEach((building, i) => {
    heights[i] = building.heightM;
    ids.push(building.id === undefined ? "" : String(building.id));
    for (const [lon, lat] of building.ring) {
      coords[pointIndex * 2] = lon;
      coords[pointIndex * 2 + 1] = lat;
      pointIndex += 1;
    }
    offsets[i + 1] = pointIndex;
  });
  return { count: buildings.length, heights, offsets, coords, ids };
}

export function deserializeBuildings(serialized: SerializedBuildings): BuildingFootprint[] {
  const { count, heights, offsets, coords, ids } = serialized;
  const out: BuildingFootprint[] = [];
  for (let i = 0; i < count; i++) {
    const ring: [number, number][] = [];
    for (let p = offsets[i]; p < offsets[i + 1]; p++) {
      ring.push([coords[p * 2], coords[p * 2 + 1]]);
    }
    out.push({
      id: ids[i] || undefined,
      heightM: heights[i],
      ring,
    });
  }
  return out;
}

export interface ShadowRenderInput {
  bbox: Bbox;
  timeMs: number;
  resolutionM: number;
  buildings: SerializedBuildings;
  /** Test hook; production reads the clock through the caller. */
  sun?: SolarPosition;
}

export type ShadowRenderStatus = "rendered" | "no-buildings" | "night" | "too-large";

export interface ShadowRenderOutput {
  status: ShadowRenderStatus;
  bbox: Bbox;
  width: number;
  height: number;
  resolutionM: number;
  sun: SolarPosition;
  mask?: ShadowMask;
  stats: {
    buildingCount: number;
    cells: number;
    shadowFraction: number;
    computeMs: number;
  };
}

export function renderShadowWindow(input: ShadowRenderInput): ShadowRenderOutput {
  const { bbox, resolutionM, timeMs } = input;
  const [west, south, east, north] = bbox;
  const centerLat = (south + north) / 2;
  const centerLon = (west + east) / 2;
  const sun = input.sun ?? solarPosition(new Date(timeMs), centerLat, centerLon);
  const started = performance.now();
  const buildings = deserializeBuildings(input.buildings);

  const empty = (status: ShadowRenderStatus): ShadowRenderOutput => ({
    status,
    bbox,
    width: 0,
    height: 0,
    resolutionM,
    sun,
    stats: {
      buildingCount: buildings.length,
      cells: 0,
      shadowFraction: 0,
      computeMs: performance.now() - started,
    },
  });

  if (buildings.length === 0) return empty("no-buildings");
  // The engine fills the mask with 1 below the horizon; a solid shadow
  // rectangle is not a shadow, it is a night overlay. The panel says so.
  if (sun.elevationDeg <= 0) return empty("night");

  const result = computeShadowLayer(
    {
      bbox,
      time: new Date(timeMs),
      mode: "raster",
      resolutionM,
      buildings,
      sun,
    },
    { maxCells: MAX_REQUEST_CELLS * 2 },
  );
  const mask = result.mask;
  if (!mask) return empty("no-buildings");
  return {
    status: "rendered",
    bbox: result.bbox,
    width: mask.width,
    height: mask.height,
    resolutionM: mask.resolutionM,
    sun: result.sun,
    mask,
    stats: {
      buildingCount: buildings.length,
      cells: mask.width * mask.height,
      shadowFraction: result.stats.shadowFraction ?? 0,
      computeMs: performance.now() - started,
    },
  };
}

/**
 * Alpha for the shadow pixels: dusk (0–3°) gets lighter shadows, because the
 * sun disc is partly below the horizon and direct light is already weak.
 */
export function duskAlpha(elevationDeg: number): number {
  if (elevationDeg >= 3) return 255;
  if (elevationDeg <= 0) return 0;
  return Math.round(90 + (elevationDeg / 3) * 165);
}
