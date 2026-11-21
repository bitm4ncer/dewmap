import { describe, expect, it } from "vitest";
import { computeShadowLayer, MAX_RASTER_CELLS, shadowFeatureCollection } from "./index";
import { localFrame } from "./geometry";
import type { Bbox, BuildingFootprint } from "./types";

const BBOX: Bbox = [6.77, 51.22, 6.7714, 51.2209];
const frame = localFrame(BBOX);
const TIME = new Date("2026-06-21T09:00:00Z");
const BASE_SUN = {
  azimuthDeg: 180,
  elevationDeg: 45,
  elevationGeometricDeg: 45,
  declinationDeg: 0,
  hourAngleDeg: 0,
  equationOfTimeMin: 0,
};

function building(x0: number, y0: number, x1: number, y1: number, heightM: number): BuildingFootprint {
  return {
    ring: [
      frame.unproject([x0, y0]),
      frame.unproject([x1, y0]),
      frame.unproject([x1, y1]),
      frame.unproject([x0, y1]),
    ],
    heightM,
  };
}

describe("computeShadowLayer", () => {
  it("returns one polygon per building in vector mode", () => {
    const result = computeShadowLayer({
      bbox: BBOX,
      time: TIME,
      mode: "vector",
      buildings: [building(-10, -10, 0, 0, 20), building(10, 10, 20, 20, 10)],
    });
    expect(result.mode).toBe("vector");
    expect(result.geojson?.features).toHaveLength(2);
    expect(result.geojson?.features[0].properties.heightM).toBe(20);
    expect(result.sun.elevationDeg).toBeGreaterThan(0);
    expect(result.stats.polygonCount).toBe(2);
  });

  it("returns a raster mask with the requested resolution", () => {
    const result = computeShadowLayer({
      bbox: BBOX,
      time: TIME,
      mode: "raster",
      resolutionM: 2,
      buildings: [building(-10, -10, 10, 10, 30)],
    });
    expect(result.mode).toBe("raster");
    expect(result.mask?.resolutionM).toBe(2);
    expect(result.mask?.width).toBeGreaterThanOrEqual(45);
    expect(result.mask?.width).toBeLessThanOrEqual(55);
    expect(result.stats.shadowFraction).toBeGreaterThan(0);
    expect(result.stats.shadowFraction).toBeLessThan(1);
  });

  it("accepts a sun override", () => {
    const sun = {
      azimuthDeg: 90,
      elevationDeg: 45,
      elevationGeometricDeg: 45,
      declinationDeg: 0,
      hourAngleDeg: 0,
      equationOfTimeMin: 0,
    };
    const result = computeShadowLayer({
      bbox: BBOX,
      time: TIME,
      mode: "vector",
      sun,
      buildings: [building(0, 0, 10, 10, 10)],
    });
    expect(result.sun).toEqual(sun);
  });

  it("honours the terrain grid", () => {
    const bare = computeShadowLayer({
      bbox: BBOX,
      time: TIME,
      mode: "raster",
      resolutionM: 4,
      buildings: [],
      sun: { ...BASE_SUN, azimuthDeg: 90, elevationDeg: 20, elevationGeometricDeg: 20 },
    });
    const withTerrain = computeShadowLayer({
      bbox: BBOX,
      time: TIME,
      mode: "raster",
      resolutionM: 4,
      buildings: [],
      sun: { ...BASE_SUN, azimuthDeg: 90, elevationDeg: 20, elevationGeometricDeg: 20 },
      terrain: {
        bbox: BBOX,
        width: 2,
        height: 2,
        // Row 0 is south: a 100 m block in the south-east quadrant.
        data: Float32Array.from([0, 100, 0, 0]),
      },
    });
    expect(bare.stats.shadowFraction).toBe(0);
    expect(withTerrain.stats.shadowFraction).toBeGreaterThan(0.05);
  });

  it("handles a bbox that crosses the antimeridian", () => {
    const result = computeShadowLayer({
      bbox: [179.9, -0.001, -179.9, 0.001],
      time: TIME,
      mode: "raster",
      resolutionM: 100,
      buildings: [],
    });
    expect(result.mask?.width).toBeGreaterThan(150);
    expect(result.mask?.height).toBeGreaterThanOrEqual(1);
  });

  it("refuses to allocate an absurd raster", () => {
    const wide: Bbox = [6, 51, 7, 52];
    expect(() =>
      computeShadowLayer({
        bbox: wide,
        time: TIME,
        mode: "raster",
        resolutionM: 1,
      }),
    ).toThrow(RangeError);
  });

  it("keeps the documented cell cap", () => {
    expect(MAX_RASTER_CELLS).toBe(16_000_000);
  });
});

describe("shadowFeatureCollection", () => {
  it("builds closed polygon rings", () => {
    const collection = shadowFeatureCollection(
      [building(-5, -5, 5, 5, 10)],
      BBOX,
      { azimuthDeg: 180, elevationDeg: 45 },
    );
    const ring = collection.features[0].geometry.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });
});
