/**
 * Raster shadow casting.
 *
 * The DSM is a height grid in metres. A cell is in shadow when the ray from
 * the cell towards the sun hits a cell that rises above the ray. That is a
 * parallel-ray test, so it is exact for a rasterised DSM and needs no
 * polygons, no union and no z-buffer. Cost is O(cells x steps).
 *
 * Measured on one Node process (AMD/Intel desktop, no WASM), 2 x 2 km:
 *   1 m, 4.0 M cells: 2.2 s (sun 61 deg) to 7.3 s (sun 23 deg)
 *   4 m, 0.25 M cells: 0.12 s to 0.42 s
 * The 2 m step (1.0 M cells) was only measured in the browser worker:
 * 0.23 s to 0.89 s.
 * A 4 GB VPS has no GPU; a phone is roughly 3-5x slower per core, which is
 * why the layer picks resolution by zoom instead of always using 1 m.
 */
import type { Bbox, BuildingFootprint, HeightField, ShadowMask, SolarPosition } from "./types";
import { localFrame, lonFraction, type LocalFrame } from "./geometry";

export interface RasterizeOptions {
  bbox: Bbox;
  width: number;
  height: number;
  resolutionM: number;
  /** Defaults to a frame around `bbox`. */
  frame?: LocalFrame;
}

/** Rasterise building heights; overlapping footprints keep the maximum. */
export function rasterizeBuildings(
  buildings: readonly BuildingFootprint[],
  options: RasterizeOptions,
): Float32Array {
  const { bbox, width, height, resolutionM } = options;
  const frame = options.frame ?? localFrame(bbox);
  const grid = new Float32Array(width * height);
  const [west, south] = bbox;
  const originX = frame.project([west, south])[0];
  const originY = frame.project([west, south])[1];

  for (const building of buildings) {
    if (!building.ring || building.ring.length < 3) continue;
    if (!Number.isFinite(building.heightM) || building.heightM <= 0) continue;

    const pts: [number, number][] = [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of building.ring) {
      const [px, py] = frame.project(point);
      const gx = (px - originX) / resolutionM;
      const gy = (py - originY) / resolutionM;
      pts.push([gx, gy]);
      if (gy < minY) minY = gy;
      if (gy > maxY) maxY = gy;
    }

    const rowStart = Math.max(0, Math.floor(minY - 0.5));
    const rowEnd = Math.min(height - 1, Math.ceil(maxY + 0.5));
    const xs: number[] = [];
    for (let row = rowStart; row <= rowEnd; row++) {
      const scanY = row + 0.5;
      xs.length = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i];
        const [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
          xs.push(x1 + ((scanY - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const colStart = Math.max(0, Math.ceil(xs[k] - 0.5));
        const colEnd = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
        const offset = row * width;
        const h = building.heightM;
        for (let col = colStart; col <= colEnd; col++) {
          if (grid[offset + col] < h) grid[offset + col] = h;
        }
      }
    }
  }
  return grid;
}

/** Add building heights on top of a terrain grid. Returns a new array. */
export function combineHeights(terrain: Float32Array, buildings: Float32Array): Float32Array {
  const out = new Float32Array(terrain.length);
  for (let i = 0; i < out.length; i++) {
    const t = terrain[i];
    out[i] = (Number.isFinite(t) ? t : 0) + buildings[i];
  }
  return out;
}

export interface CastShadowOptions {
  width: number;
  height: number;
  resolutionM: number;
  sun: Pick<SolarPosition, "azimuthDeg" | "elevationDeg">;
  /**
   * March step in metres. Defaults to `resolutionM`.
   *
   * The step is a real distance: the ray advances `stepM` metres per
   * iteration, independent of the cell size. Values above `resolutionM` skip
   * cells and can miss thin occluders; values below it cost time without
   * adding accuracy. Keep it at or below `resolutionM`.
   */
  stepM?: number;
  /** Clamp for the search distance. Defaults to 1500 m. */
  maxDistanceM?: number;
  /** Highest occluder in the DSM in metres. Defaults to the observed max. */
  maxHeightM?: number;
}

/** Ray-march a DSM towards the sun and return a 1/0 shadow mask. */
export function castShadowMask(dsm: Float32Array, options: CastShadowOptions): Uint8Array {
  const { width, height, resolutionM, sun } = options;
  if (sun.elevationDeg <= 0) {
    // Sun below the horizon: everything is in shadow.
    return new Uint8Array(width * height).fill(1);
  }
  const stepM = options.stepM ?? resolutionM;
  const tanEl = Math.tan((sun.elevationDeg * Math.PI) / 180);
  const azimuth = (sun.azimuthDeg * Math.PI) / 180;
  const ux = Math.sin(azimuth);
  const uy = Math.cos(azimuth);

  let maxHeight = options.maxHeightM ?? 0;
  if (!maxHeight) {
    for (let i = 0; i < dsm.length; i++) if (dsm[i] > maxHeight) maxHeight = dsm[i];
  }
  const maxDistance = Math.min(
    options.maxDistanceM ?? 1500,
    maxHeight / tanEl + 2 * stepM,
  );
  const steps = Math.max(1, Math.floor(maxDistance / stepM));
  const mask = new Uint8Array(width * height);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const index = row * width + col;
      const z0 = dsm[index];
      let hit = false;
      for (let s = 1; s <= steps; s++) {
        // `distance` is in metres; the cell offset is metres / metres-per-cell.
        const distance = s * stepM;
        const sx = Math.floor(col + (ux * distance) / resolutionM);
        const sy = Math.floor(row + (uy * distance) / resolutionM);
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) break;
        if (dsm[sy * width + sx] > z0 + distance * tanEl + 0.35) {
          hit = true;
          break;
        }
      }
      if (hit) mask[index] = 1;
    }
  }
  return mask;
}

/** Wrap a mask into the public `ShadowMask` shape. */
export function toShadowMask(
  mask: Uint8Array,
  bbox: Bbox,
  width: number,
  height: number,
  resolutionM: number,
): ShadowMask {
  return { bbox, width, height, resolutionM, data: mask };
}

/** Share of cells that are in shadow. */
export function shadowFraction(mask: Uint8Array): number {
  if (mask.length === 0) return 0;
  let shadowed = 0;
  for (let i = 0; i < mask.length; i++) shadowed += mask[i] ? 1 : 0;
  return shadowed / mask.length;
}

/** Sample a height field at a lon/lat, nearest neighbour. NaN outside. */
export function sampleHeightField(field: HeightField, lon: number, lat: number): number {
  const [, south, , north] = field.bbox;
  if (lat < south || lat > north) return Number.NaN;
  const fx = lonFraction(field.bbox, lon);
  if (fx === null) return Number.NaN;
  // The epsilon keeps a fraction that is mathematically on a cell boundary
  // (0.25 * 4) from falling into the previous cell through floating point.
  const col = Math.min(field.width - 1, Math.floor(fx * field.width + 1e-9));
  const row = Math.min(
    field.height - 1,
    Math.floor(((lat - south) / (north - south)) * field.height),
  );
  return field.data[row * field.width + col];
}

/** Bilinear sample, for terrain grids that are coarser than the output. */
export function sampleHeightFieldBilinear(
  field: HeightField,
  lon: number,
  lat: number,
): number {
  const [, south, , north] = field.bbox;
  if (lat < south || lat > north) return Number.NaN;
  const fx = lonFraction(field.bbox, lon);
  if (fx === null) return Number.NaN;
  const x = fx * (field.width - 1);
  const y = ((lat - south) / (north - south)) * (field.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const v00 = field.data[y0 * field.width + x0];
  const v10 = field.data[y0 * field.width + x1];
  const v01 = field.data[y1 * field.width + x0];
  const v11 = field.data[y1 * field.width + x1];
  const top = v00 * (1 - tx) + v10 * tx;
  const bottom = v01 * (1 - tx) + v11 * tx;
  return top * (1 - ty) + bottom * ty;
}
