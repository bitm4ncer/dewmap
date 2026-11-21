import { describe, expect, it } from "vitest";
import {
  buildHorizonMap,
  horizonAt,
  horizonBuildOperations,
  shadowFromHorizon,
} from "./horizon";
import { shadowFraction } from "./raster";
import type { Bbox } from "./types";

const BBOX: Bbox = [6.76, 51.21, 6.79, 51.23];

function ridge(width = 101, height = 101, wallHeight = 50, column = 50): Float32Array {
  const grid = new Float32Array(width * height);
  for (let row = 0; row < height; row++) grid[row * width + column] = wallHeight;
  return grid;
}

describe("buildHorizonMap", () => {
  it("sees a 50 m wall at 79 degrees from 10 m away", () => {
    const map = buildHorizonMap(ridge(), BBOX, {
      width: 101,
      height: 101,
      resolutionM: 1,
      directions: 16,
      maxDistanceM: 200,
      stepM: 1,
    });
    const angle = horizonAt(map, 40, 50, 90);
    expect((angle * 180) / Math.PI).toBeCloseTo(78.69, 0);
  });

  it("sees nothing looking away from the wall", () => {
    const map = buildHorizonMap(ridge(), BBOX, {
      width: 101,
      height: 101,
      resolutionM: 1,
      directions: 16,
      maxDistanceM: 200,
      stepM: 1,
    });
    expect(horizonAt(map, 70, 50, 90)).toBe(0);
  });

  it("interpolates between compass directions", () => {
    const map = buildHorizonMap(ridge(), BBOX, {
      width: 101,
      height: 101,
      resolutionM: 1,
      directions: 16,
      maxDistanceM: 200,
      stepM: 1,
    });
    const exact = horizonAt(map, 40, 50, 90);
    const between = horizonAt(map, 40, 50, 90 + 11.25 / 2);
    expect(between).toBeGreaterThanOrEqual(0);
    expect(between).toBeLessThanOrEqual(exact);
  });
});

describe("shadowFromHorizon", () => {
  const map = buildHorizonMap(ridge(), BBOX, {
    width: 101,
    height: 101,
    resolutionM: 1,
    directions: 16,
    maxDistanceM: 200,
    stepM: 1,
  });

  it("shadows the west side at a low eastern sun", () => {
    const mask = shadowFromHorizon(map, { azimuthDeg: 90, elevationDeg: 20 });
    expect(mask[50 * 101 + 40]).toBe(1);
  });

  it("leaves the west side lit when the sun is above the ridge", () => {
    const mask = shadowFromHorizon(map, { azimuthDeg: 90, elevationDeg: 85 });
    expect(mask[50 * 101 + 40]).toBe(0);
  });

  it("leaves the east side lit", () => {
    const mask = shadowFromHorizon(map, { azimuthDeg: 90, elevationDeg: 20 });
    expect(mask[50 * 101 + 70]).toBe(0);
  });

  it("is all shadow below the horizon", () => {
    const mask = shadowFromHorizon(map, { azimuthDeg: 90, elevationDeg: -1 });
    expect(shadowFraction(mask)).toBe(1);
  });
});

describe("horizonBuildOperations", () => {
  it("scales with cells, directions and steps", () => {
    const ops = horizonBuildOperations(1000, 1000, {
      resolutionM: 2,
      directions: 32,
      maxDistanceM: 2000,
      stepM: 4,
    });
    expect(ops).toBe(1000 * 1000 * 32 * 500);
  });
});
