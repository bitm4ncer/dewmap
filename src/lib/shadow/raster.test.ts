import { describe, expect, it } from "vitest";
import {
  castShadowMask,
  combineHeights,
  rasterizeBuildings,
  sampleHeightField,
  sampleHeightFieldBilinear,
  shadowFraction,
} from "./raster";
import { localFrame } from "./geometry";
import type { Bbox, BuildingFootprint, HeightField } from "./types";

// 100 x 100 m box near Düsseldorf, 1 m cells.
const BBOX: Bbox = [6.77, 51.22, 6.7714, 51.2209];
const frame = localFrame(BBOX);

function footprint(x0: number, y0: number, x1: number, y1: number, heightM: number): BuildingFootprint {
  return {
    heightM,
    ring: [
      frame.unproject([x0, y0]),
      frame.unproject([x1, y0]),
      frame.unproject([x1, y1]),
      frame.unproject([x0, y1]),
    ],
  };
}

function flatGrid(width: number, height: number, level = 0): Float32Array {
  return new Float32Array(width * height).fill(level);
}

describe("rasterizeBuildings", () => {
  it("fills a 10 x 10 m footprint with its height", () => {
    const grid = rasterizeBuildings([footprint(-5, -5, 5, 5, 12)], {
      bbox: BBOX,
      width: 100,
      height: 100,
      resolutionM: 1,
      frame,
    });
    let covered = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === 12) covered++;
    }
    expect(covered).toBeGreaterThanOrEqual(99);
    expect(covered).toBeLessThanOrEqual(121);
  });

  it("keeps the maximum of overlapping footprints", () => {
    const grid = rasterizeBuildings(
      [footprint(-5, -5, 5, 5, 10), footprint(-5, -5, 5, 5, 30)],
      { bbox: BBOX, width: 100, height: 100, resolutionM: 1, frame },
    );
    let max = 0;
    for (let i = 0; i < grid.length; i++) max = Math.max(max, grid[i]);
    expect(max).toBe(30);
  });

  it("ignores invalid buildings", () => {
    const grid = rasterizeBuildings(
      [{ ring: [], heightM: 10 }, { ring: footprint(0, 0, 1, 1, 0).ring, heightM: 0 }],
      { bbox: BBOX, width: 100, height: 100, resolutionM: 1, frame },
    );
    expect(grid.every((value) => value === 0)).toBe(true);
  });
});

describe("castShadowMask", () => {
  const width = 100;
  const height = 100;

  function wall(heightM: number, column = 50): Float32Array {
    const dsm = flatGrid(width, height);
    for (let row = 0; row < height; row++) dsm[row * width + column] = heightM;
    return dsm;
  }

  it("casts a shadow away from an eastern sun", () => {
    const mask = castShadowMask(wall(10), {
      width,
      height,
      resolutionM: 1,
      sun: { azimuthDeg: 90, elevationDeg: 45 },
    });
    // 5 m west of the wall, the ray needs 5 m of height and finds 10 m.
    expect(mask[50 * width + 45]).toBe(1);
    // 15 m west needs 15 m and finds 10 m.
    expect(mask[50 * width + 35]).toBe(0);
  });

  it("casts a shadow the other way with a western sun", () => {
    const mask = castShadowMask(wall(10), {
      width,
      height,
      resolutionM: 1,
      sun: { azimuthDeg: 270, elevationDeg: 45 },
    });
    expect(mask[50 * width + 55]).toBe(1);
    expect(mask[50 * width + 45]).toBe(0);
  });

  it("casts almost nothing with the sun near the zenith", () => {
    const mask = castShadowMask(wall(10), {
      width,
      height,
      resolutionM: 1,
      sun: { azimuthDeg: 180, elevationDeg: 89 },
    });
    expect(shadowFraction(mask)).toBeLessThan(0.001);
  });

  it("marks everything when the sun is below the horizon", () => {
    const mask = castShadowMask(flatGrid(width, height), {
      width,
      height,
      resolutionM: 1,
      sun: { azimuthDeg: 90, elevationDeg: -2 },
    });
    expect(shadowFraction(mask)).toBe(1);
  });

  it("does not shadow flat ground", () => {
    const mask = castShadowMask(flatGrid(width, height, 40), {
      width,
      height,
      resolutionM: 1,
      sun: { azimuthDeg: 120, elevationDeg: 15 },
    });
    expect(shadowFraction(mask)).toBe(0);
  });

  it("keeps the shadow length when stepM differs from the cell size", () => {
    // 20 m wall, sun 30 deg -> 34.64 m shadow. A step in metres must stay a
    // step in metres; the bug was a step of one cell regardless of stepM.
    const wallDsm = flatGrid(width, height);
    for (let row = 0; row < height; row++) {
      for (let col = 48; col <= 52; col++) wallDsm[row * width + col] = 20;
    }
    const lengths = [0.5, 1, 2].map((stepM) => {
      const mask = castShadowMask(wallDsm, {
        width,
        height,
        resolutionM: 1,
        stepM,
        sun: { azimuthDeg: 90, elevationDeg: 30 },
      });
      let firstShadow = -1;
      for (let col = 0; col < 48; col++) {
        if (mask[50 * width + col]) {
          firstShadow = col;
          break;
        }
      }
      return 48 - firstShadow;
    });
    for (const length of lengths) {
      expect(length).toBeGreaterThanOrEqual(33);
      expect(length).toBeLessThanOrEqual(36);
    }
    // Every step size must agree with the others, not scale with 1 / stepM.
    expect(Math.abs(lengths[2] - lengths[1])).toBeLessThanOrEqual(1);
  });
});

describe("combineHeights", () => {
  it("adds buildings on top of terrain", () => {
    const terrain = Float32Array.from([10, Number.NaN, 20]);
    const buildings = Float32Array.from([1, 2, 0]);
    expect(Array.from(combineHeights(terrain, buildings))).toEqual([11, 2, 20]);
  });
});

describe("height field sampling", () => {
  const field: HeightField = {
    bbox: [6, 50, 7, 51],
    width: 2,
    height: 2,
    data: Float32Array.from([0, 10, 20, 30]),
  };

  it("samples nearest neighbour", () => {
    expect(sampleHeightField(field, 6.1, 50.1)).toBe(0);
    expect(sampleHeightField(field, 6.9, 50.9)).toBe(30);
  });

  it("returns NaN outside", () => {
    expect(Number.isNaN(sampleHeightField(field, 5, 50))).toBe(true);
  });

  it("interpolates bilinearly", () => {
    const value = sampleHeightFieldBilinear(field, 6.5, 50.5);
    expect(value).toBeCloseTo(15, 6);
  });

  it("samples across a crossing bbox instead of returning all NaN", () => {
    const crossing: HeightField = {
      bbox: [179.9, -1, -179.9, 1],
      width: 4,
      height: 2,
      data: Float32Array.from([0, 10, 20, 30, 40, 50, 60, 70]),
    };
    expect(sampleHeightField(crossing, 179.95, -0.5)).toBe(10);
    expect(sampleHeightField(crossing, 180, -0.5)).toBe(20);
    expect(sampleHeightField(crossing, -179.95, -0.5)).toBe(30);
    expect(Number.isNaN(sampleHeightField(crossing, 0, -0.5))).toBe(true);
  });
});
