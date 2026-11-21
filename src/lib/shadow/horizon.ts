/**
 * Horizon maps.
 *
 * The expensive part of shadow casting is walking terrain for every pixel.
 * A horizon map does that once, for a fixed set of compass directions, and
 * stores the maximum elevation angle seen in each direction. After that a
 * time step is a single comparison per cell:
 *
 *   in shadow  <=>  sun.elevation < horizon(azimuth)
 *
 * That is what makes a time slider feel instant: panning costs a rebuild,
 * scrubbing the day costs one pass over the grid (~1-5 ms per million cells).
 *
 * Cost of the build is `cells x directions x steps`, so it is used for the
 * coarse terrain field (10-30 m), not for the 1 m building raster.
 *
 * Not wired into `computeShadowLayer` yet: that facade ray-marches terrain and
 * buildings together (simplest correct path, measured in the POC). Phase 2
 * uses this map for the coarse terrain part so the slider is instant.
 */
import type { Bbox, HorizonMap, SolarPosition } from "./types";

export interface HorizonOptions {
  width: number;
  height: number;
  resolutionM: number;
  /** Number of directions, default 32 (11.25 deg spacing). */
  directions?: number;
  /** Terrain search radius in metres, default 2000. */
  maxDistanceM?: number;
  /** March step in metres, default 2x resolution. */
  stepM?: number;
}

export function buildHorizonMap(
  elevations: Float32Array,
  bbox: Bbox,
  options: HorizonOptions,
): HorizonMap {
  const { width, height, resolutionM } = options;
  const directions = options.directions ?? 32;
  const maxDistance = options.maxDistanceM ?? 2000;
  const stepM = options.stepM ?? resolutionM * 2;
  const steps = Math.max(1, Math.floor(maxDistance / stepM));
  const data = new Float32Array(width * height * directions);

  for (let d = 0; d < directions; d++) {
    const angle = (d / directions) * Math.PI * 2;
    const ux = Math.sin(angle);
    const uy = Math.cos(angle);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const z0 = elevations[row * width + col];
        let maxAngle = 0;
        for (let s = 1; s <= steps; s++) {
          const distance = s * stepM;
          const sx = Math.floor(col + (ux * distance) / resolutionM);
          const sy = Math.floor(row + (uy * distance) / resolutionM);
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) break;
          const dz = elevations[sy * width + sx] - z0;
          if (dz > 0) {
            const angleUp = Math.atan2(dz, distance);
            if (angleUp > maxAngle) maxAngle = angleUp;
          }
        }
        data[(row * width + col) * directions + d] = maxAngle;
      }
    }
  }

  return {
    bbox,
    width,
    height,
    resolutionM,
    directions,
    data,
  };
}

/** Horizon elevation in radians at a cell for an arbitrary azimuth. */
export function horizonAt(map: HorizonMap, col: number, row: number, azimuthDeg: number): number {
  const dirs = map.directions;
  const position = (((azimuthDeg % 360) + 360) % 360) / 360 * dirs;
  const d0 = Math.floor(position) % dirs;
  const d1 = (d0 + 1) % dirs;
  const frac = position - Math.floor(position);
  const base = (row * map.width + col) * dirs;
  return map.data[base + d0] * (1 - frac) + map.data[base + d1] * frac;
}

/** Mask from a horizon map and a sun position. */
export function shadowFromHorizon(
  map: HorizonMap,
  sun: Pick<SolarPosition, "azimuthDeg" | "elevationDeg">,
): Uint8Array {
  const mask = new Uint8Array(map.width * map.height);
  const elevation = (sun.elevationDeg * Math.PI) / 180;
  const azimuth = ((sun.azimuthDeg % 360) + 360) % 360;
  const position = (azimuth / 360) * map.directions;
  const d0 = Math.floor(position) % map.directions;
  const d1 = (d0 + 1) % map.directions;
  const frac = position - Math.floor(position);
  const baseStep = map.directions;

  if (elevation <= 0) {
    mask.fill(1);
    return mask;
  }

  for (let cell = 0; cell < map.width * map.height; cell++) {
    const base = cell * baseStep;
    const horizon =
      map.data[base + d0] * (1 - frac) + map.data[base + d1] * frac;
    if (elevation < horizon) mask[cell] = 1;
  }
  return mask;
}

/** One-off cost estimate for a grid, used by callers to pick a resolution. */
export function horizonBuildOperations(
  width: number,
  height: number,
  options: Pick<HorizonOptions, "resolutionM" | "directions" | "maxDistanceM" | "stepM">,
): number {
  const dirs = options.directions ?? 32;
  const maxDistance = options.maxDistanceM ?? 2000;
  const step = options.stepM ?? options.resolutionM * 2;
  const steps = Math.max(1, Math.floor(maxDistance / step));
  return width * height * dirs * steps;
}
