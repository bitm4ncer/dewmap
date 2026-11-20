import { describe, expect, it, vi } from "vitest";
import type { GeoJSONFeature } from "maplibre-gl";
import {
  distanceToSegment,
  installFeatureTapPipeline,
  nearestRenderedFeature,
  pickNearestFeature,
  registerFeatureTaps,
  screenDistanceToGeometry,
} from "./featureTaps";

/** Identity projection: lngLat tuples are already screen coordinates. */
const identity = ([x, y]: [number, number]) => ({ x, y });
const tap = { x: 100, y: 100 };

describe("distanceToSegment", () => {
  it("is zero on the segment", () => {
    expect(distanceToSegment(5, 5, 0, 0, 10, 10)).toBeCloseTo(0);
  });

  it("clamps to the nearest endpoint", () => {
    expect(distanceToSegment(-4, 0, 0, 0, 10, 0)).toBe(4);
    expect(distanceToSegment(14, 0, 0, 0, 10, 0)).toBe(4);
  });

  it("measures perpendicular distance", () => {
    expect(distanceToSegment(5, 3, 0, 0, 10, 0)).toBe(3);
  });
});

describe("screenDistanceToGeometry", () => {
  it("measures point distance", () => {
    const d = screenDistanceToGeometry(
      { type: "Point", coordinates: [110, 100] },
      identity,
      tap,
    );
    expect(d).toBe(10);
  });

  it("returns null for unprojectable geometry", () => {
    const d = screenDistanceToGeometry(
      { type: "Point", coordinates: [1, 2] },
      () => null,
      tap,
    );
    expect(d).toBeNull();
  });

  it("measures the closest point on a line", () => {
    const d = screenDistanceToGeometry(
      { type: "LineString", coordinates: [[0, 100], [200, 100]] },
      identity,
      tap,
    );
    expect(d).toBe(0);
  });

  it("subsampled lines stay within tolerance of the true distance", () => {
    // 200 tiny segments; the true nearest approach is 5px at x=100.
    const coords = Array.from({ length: 201 }, (_, i) => [i, 105] as [number, number]);
    const d = screenDistanceToGeometry(
      { type: "LineString", coordinates: coords },
      identity,
      tap,
    );
    expect(d).not.toBeNull();
    expect(d!).toBeLessThanOrEqual(6);
    expect(d!).toBeGreaterThanOrEqual(4);
  });

  it("measures polygon rings", () => {
    const d = screenDistanceToGeometry(
      {
        type: "Polygon",
        coordinates: [[[90, 90], [110, 90], [110, 110], [90, 110], [90, 90]]],
      },
      identity,
      tap,
    );
    expect(d).toBe(0);
  });

  it("handles multi-geometries", () => {
    const d = screenDistanceToGeometry(
      {
        type: "MultiLineString",
        coordinates: [[[0, 0], [10, 10]], [[200, 200], [220, 220]]],
      },
      identity,
      tap,
    );
    expect(d).toBeCloseTo(Math.hypot(90, 90), 5);
  });
});

function feature(geometry: GeoJSON.Geometry, id: string): GeoJSONFeature {
  return {
    id,
    type: "Feature",
    geometry,
    properties: { id },
    layer: { id: "test" },
  } as unknown as GeoJSONFeature;
}

describe("pickNearestFeature", () => {
  it("prefers the closest feature", () => {
    const far = feature({ type: "Point", coordinates: [140, 100] }, "far");
    const near = feature({ type: "Point", coordinates: [104, 100] }, "near");
    const picked = pickNearestFeature([far, near], identity, tap);
    expect(picked?.feature).toBe(near);
    expect(picked?.distancePx).toBe(4);
  });

  it("compares points against line features fairly", () => {
    const line = feature(
      { type: "LineString", coordinates: [[100, 130], [140, 130]] },
      "line",
    );
    const point = feature({ type: "Point", coordinates: [100, 118] }, "point");
    const picked = pickNearestFeature([line, point], identity, tap);
    expect(picked?.feature).toBe(point);
  });

  it("returns null when nothing is projectable", () => {
    const f = feature({ type: "Point", coordinates: [1, 1] }, "x");
    expect(pickNearestFeature([f], () => null, tap)).toBeNull();
  });
});

// ── nearestRenderedFeature (mocked map) ───────────────────────────────

function mockMap(paddedFeatures: GeoJSONFeature[]) {
  return {
    getLayer: () => true,
    // Exact point query → nothing under the finger; padded box → results.
    queryRenderedFeatures: (point: unknown) =>
      Array.isArray(point) && Array.isArray(point[0]) ? paddedFeatures : [],
    project: ([x, y]: [number, number]) => ({ x, y }),
  } as unknown as Parameters<typeof nearestRenderedFeature>[0];
}

describe("selection hook", () => {
  it("notifies onFeatureSelect before the group handler", () => {
    let click: ((event: unknown) => void) | null = null;
    const site = feature({ type: "Point", coordinates: [6.78, 51.23] }, "site");
    const map = {
      on: (event: string, handler: (event: unknown) => void) => {
        if (event === "click") click = handler;
      },
      getLayer: () => true,
      queryRenderedFeatures: (point: unknown) =>
        Array.isArray(point) && typeof point[0] === "number" ? [site] : [],
      project: ([x, y]: [number, number]) => ({ x, y }),
      getCanvasContainer: () => ({ appendChild() {} }),
      getCanvas: () => ({ style: {} }),
    };
    const calls: string[] = [];
    const onFeature = vi.fn(() => calls.push("handler"));
    const onFeatureSelect = vi.fn(() => calls.push("select"));
    registerFeatureTaps(map as never, {
      id: "history-sites",
      layers: ["l"],
      hapticKind: null,
      ripple: false,
      onFeature,
    });
    installFeatureTapPipeline(map as never, { onFeatureSelect });

    click!({
      point: [100, 100],
      lngLat: { lng: 6.78, lat: 51.23 },
      defaultPrevented: false,
      preventDefault: vi.fn(),
    });

    expect(calls).toEqual(["select", "handler"]);
    expect(onFeatureSelect).toHaveBeenCalledWith(
      site,
      expect.objectContaining({ id: "history-sites" }),
    );
  });
});

describe("nearestRenderedFeature", () => {
  it("falls back to the nearest feature inside the padded box", () => {
    const near = feature({ type: "Point", coordinates: [108, 100] }, "near");
    const far = feature({ type: "Point", coordinates: [160, 100] }, "far");
    const picked = nearestRenderedFeature(mockMap([far, near]), tap, ["l"], 22);
    expect(picked?.feature).toBe(near);
    expect(picked?.distancePx).toBe(8);
  });

  it("rejects features beyond the tolerance", () => {
    const far = feature({ type: "Point", coordinates: [160, 100] }, "far");
    expect(nearestRenderedFeature(mockMap([far]), tap, ["l"], 22)).toBeNull();
  });

  it("returns null when no layer exists", () => {
    const map = {
      getLayer: () => false,
      queryRenderedFeatures: () => [],
    } as unknown as Parameters<typeof nearestRenderedFeature>[0];
    expect(nearestRenderedFeature(map, tap, ["missing"], 22)).toBeNull();
  });
});
