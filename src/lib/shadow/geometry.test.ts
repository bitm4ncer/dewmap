import { describe, expect, it } from "vitest";
import {
  bboxAround,
  bboxSpanM,
  buildingHeightFromTags,
  convexHull,
  expandBboxM,
  localFrame,
  lonFraction,
  polygonAreaM2,
  projectFootprint,
  ringBbox,
  shadowOffset,
  sweptFootprint,
} from "./geometry";
import type { Bbox, LngLat } from "./types";

const BBOX: Bbox = [6.76, 51.21, 6.79, 51.23];
const frame = localFrame(BBOX);

function metricRing(points: [number, number][]): LngLat[] {
  return points.map((p) => frame.unproject(p));
}

describe("localFrame", () => {
  it("round-trips a point to sub-millimetre precision", () => {
    const point: LngLat = [6.7735, 51.2277];
    const back = frame.unproject(frame.project(point));
    expect(back[0]).toBeCloseTo(point[0], 9);
    expect(back[1]).toBeCloseTo(point[1], 9);
  });

  it("uses metres", () => {
    const a = frame.project([6.76, 51.21]);
    const b = frame.project([6.77, 51.21]);
    expect(b[0] - a[0]).toBeGreaterThan(600);
    expect(b[0] - a[0]).toBeLessThan(800);
  });
});

describe("shadowOffset", () => {
  it("points north when the sun is due south", () => {
    const offset = shadowOffset(10, { azimuthDeg: 180, elevationDeg: 45 });
    expect(offset.x).toBeCloseTo(0, 9);
    expect(offset.y).toBeCloseTo(10, 9);
    expect(offset.lengthM).toBeCloseTo(10, 9);
  });

  it("points west when the sun is in the east", () => {
    const offset = shadowOffset(10, { azimuthDeg: 90, elevationDeg: 45 });
    expect(offset.x).toBeCloseTo(-10, 9);
    expect(offset.y).toBeCloseTo(0, 9);
  });

  it("points east when the sun is in the west", () => {
    const offset = shadowOffset(5, { azimuthDeg: 270, elevationDeg: 45 });
    expect(offset.x).toBeCloseTo(5, 9);
  });
});

describe("convexHull", () => {
  it("drops interior points", () => {
    const hull = convexHull([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5, 5],
    ]);
    expect(hull).toHaveLength(4);
  });

  it("keeps a triangle", () => {
    const hull = convexHull([
      [0, 0],
      [10, 0],
      [0, 10],
    ]);
    expect(hull).toHaveLength(3);
  });

  it("handles duplicate points", () => {
    const hull = convexHull([
      [0, 0],
      [0, 0],
      [10, 0],
      [0, 10],
    ]);
    expect(hull).toHaveLength(3);
  });
});

describe("projectFootprint", () => {
  const square = metricRing([
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ]);

  it("extends a square by the shadow length", () => {
    const { ring, lengthM } = projectFootprint(square, 10, {
      azimuthDeg: 180,
      elevationDeg: 45,
    }, frame);
    expect(lengthM).toBeCloseTo(10, 6);
    // 10 x 10 footprint plus a 10 m shadow = 10 x 20 m.
    expect(polygonAreaM2(ring, frame)).toBeCloseTo(200, 3);
  });

  it("returns a closed ring", () => {
    const { ring } = projectFootprint(square, 10, { azimuthDeg: 90, elevationDeg: 30 }, frame);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it("keeps the footprint when the sun is at the zenith", () => {
    const { ring } = projectFootprint(square, 10, { azimuthDeg: 0, elevationDeg: 90 }, frame);
    expect(polygonAreaM2(ring, frame)).toBeCloseTo(100, 3);
  });
});

describe("sweptFootprint", () => {
  it("emits the footprint, its translation and one quad per edge", () => {
    const square = metricRing([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const { polygons } = sweptFootprint(square, 10, { azimuthDeg: 180, elevationDeg: 45 }, frame);
    // 4 vertices -> closed ring has 5, so 2 + 4 = 6 pieces.
    expect(polygons).toHaveLength(6);
  });
});

describe("buildingHeightFromTags", () => {
  it("parses a metric height", () => {
    expect(buildingHeightFromTags({ height: "42" }).heightM).toBe(42);
  });

  it("accepts a comma decimal and a trailing unit", () => {
    expect(buildingHeightFromTags({ height: "12,5 m" }).heightM).toBe(12.5);
  });

  it("falls back to levels with a roof allowance", () => {
    const result = buildingHeightFromTags({ "building:levels": "4" });
    expect(result.source).toBe("levels");
    expect(result.heightM).toBeCloseTo(13.8, 6);
  });

  it("uses the default when nothing is tagged", () => {
    const result = buildingHeightFromTags({ building: "yes" });
    expect(result.source).toBe("fallback");
    expect(result.heightM).toBe(10);
  });

  it("ignores nonsense", () => {
    expect(buildingHeightFromTags({ height: "tall", "building:levels": "-2" }).source).toBe(
      "fallback",
    );
  });
});

describe("bbox helpers", () => {
  it("expands by metres on every side", () => {
    const expanded = expandBboxM([6.77, 51.22, 6.78, 51.23], 1000);
    expect(expanded[1]).toBeLessThan(51.22);
    expect(expanded[3]).toBeGreaterThan(51.23);
    expect(expanded[0]).toBeLessThan(6.77);
  });

  it("builds a box around a point", () => {
    const box = bboxAround(6.7735, 51.2277, 1000);
    expect(box[3] - box[1]).toBeCloseTo(0.018, 2);
  });

  it("returns the ring bounds", () => {
    expect(ringBbox([[6.77, 51.22], [6.78, 51.23]])).toEqual([6.77, 51.22, 6.78, 51.23]);
  });
});

describe("global bounds", () => {
  it("round-trips a point across the antimeridian", () => {
    const frame = localFrame([179.9, -1, -179.9, 1]);
    const point: LngLat = [179.95, 0.5];
    const back = frame.unproject(frame.project(point));
    expect(back[0]).toBeCloseTo(point[0], 6);
    expect(back[1]).toBeCloseTo(point[1], 6);
  });

  it("measures a crossing bbox the short way round", () => {
    const box: Bbox = [179.9, -1, -179.9, 1];
    const span = bboxSpanM(box, localFrame(box));
    expect(span.x).toBeGreaterThan(20_000);
    expect(span.x).toBeLessThan(25_000);
  });

  it("wraps unverpacked longitudes east of 180", () => {
    const frame = localFrame([179.5, 50, 180.4, 51]);
    const back = frame.unproject(frame.project([179.9, 50.5]));
    expect(back[0]).toBeCloseTo(179.9, 6);
    expect(back[1]).toBeCloseTo(50.5, 6);
  });

  it("rejects latitudes outside the Web Mercator range", () => {
    expect(() => localFrame([0, 89, 1, 90])).toThrow(RangeError);
  });

  it("rejects a bbox wider than 180 degrees", () => {
    const world: Bbox = [-180, -85, 180, 85];
    expect(() => bboxSpanM(world, localFrame([0, 0, 1, 1]))).toThrow(RangeError);
  });

  it("rejects an inverted bbox instead of returning the whole world", () => {
    expect(() => localFrame([10, 0, -10, 1])).toThrow(RangeError);
  });

  it("places a longitude across the seam", () => {
    const bbox: Bbox = [179.9, -1, -179.9, 1];
    expect(lonFraction(bbox, 179.95)).toBeCloseTo(0.25, 6);
    expect(lonFraction(bbox, -179.95)).toBeCloseTo(0.75, 6);
    expect(lonFraction(bbox, 180)).toBeCloseTo(0.5, 6);
    expect(lonFraction(bbox, 0)).toBeNull();
  });

  it("keeps a crossing bbox crossing when expanded", () => {
    const expanded = expandBboxM([179.9, -1, -179.9, 1], 1000);
    expect(expanded[2]).toBeLessThan(expanded[0]);
  });
});
