import { describe, expect, it } from "vitest";
import {
  bboxCoverage,
  bboxIntersection,
  clampWindow,
  planShadowWindow,
  resolutionForWindow,
} from "./window";
import { MAX_REQUEST_CELLS, MAX_WINDOW_M, PILOT_BBOX } from "./pilot";
import type { Bbox } from "./types";

const DUSSELDORF_CENTRE: Bbox = [6.7750, 51.2270, 6.7850, 51.2320];

describe("bbox helpers", () => {
  it("intersects and reports zero coverage when disjoint", () => {
    expect(bboxIntersection([0, 0, 2, 2], [1, 1, 3, 3])).toEqual([1, 1, 2, 2]);
    expect(bboxIntersection([0, 0, 1, 1], [2, 2, 3, 3])).toBeNull();
    expect(bboxCoverage([0, 0, 2, 2], [0, 0, 1, 1])).toBeCloseTo(0.25);
    expect(bboxCoverage([10, 10, 11, 11], PILOT_BBOX)).toBe(0);
  });
});

describe("clampWindow", () => {
  it("keeps a small viewport untouched", () => {
    const { bbox, clipped } = clampWindow(DUSSELDORF_CENTRE);
    expect(clipped).toBe(false);
    bbox.forEach((value, index) => expect(value).toBeCloseTo(DUSSELDORF_CENTRE[index], 9));
  });

  it("caps a large viewport to the window limit, centred", () => {
    const wide: Bbox = [6.3, 50.9, 6.9, 51.5];
    const { bbox, clipped } = clampWindow(wide, 6000);
    expect(clipped).toBe(true);
    expect(bbox[2] - bbox[0]).toBeLessThan(0.1);
    expect((bbox[0] + bbox[2]) / 2).toBeCloseTo((wide[0] + wide[2]) / 2, 4);
    expect((bbox[1] + bbox[3]) / 2).toBeCloseTo((wide[1] + wide[3]) / 2, 4);
  });
});

describe("planShadowWindow", () => {
  it("refuses below zoom 14 with a zoomed-out plan", () => {
    const plan = planShadowWindow(DUSSELDORF_CENTRE, 13.5);
    expect(plan.kind).toBe("zoomed-out");
    expect(plan.bbox).toBeNull();
  });

  it("refuses far away from the pilot, honestly", () => {
    const plan = planShadowWindow([13.3, 52.4, 13.5, 52.6], 16);
    expect(plan.kind).toBe("outside");
    expect(plan.bbox).toBeNull();
  });

  it("plans a Düsseldorf window inside the pilot", () => {
    const plan = planShadowWindow(DUSSELDORF_CENTRE, 15);
    expect(plan.kind).toBe("ok");
    const bbox = plan.bbox!;
    expect(bbox[0]).toBeGreaterThanOrEqual(PILOT_BBOX[0]);
    expect(bbox[1]).toBeGreaterThanOrEqual(PILOT_BBOX[1]);
    expect(bbox[2]).toBeLessThanOrEqual(PILOT_BBOX[2]);
    expect(bbox[3]).toBeLessThanOrEqual(PILOT_BBOX[3]);
    expect(plan.partial).toBe(false);
    expect(plan.resolutionM).toBe(4);
    expect(plan.width * plan.height).toBeLessThan(MAX_REQUEST_CELLS * 1.2);
  });

  it("clips a viewport that hangs over the pilot edge", () => {
    const overEdge: Bbox = [6.90, 51.30, 6.98, 51.36];
    const plan = planShadowWindow(overEdge, 15);
    expect(plan.kind).toBe("ok");
    expect(plan.partial).toBe(true);
    expect(plan.bbox![2]).toBeLessThanOrEqual(PILOT_BBOX[2]);
    expect(plan.bbox![3]).toBeLessThanOrEqual(PILOT_BBOX[3]);
  });

  it("never exceeds the cell budget on a wide window", () => {
    const plan = planShadowWindow([6.68, 51.14, 6.92, 51.34], 15);
    expect(plan.kind).toBe("ok");
    expect(plan.partial).toBe(true);
    expect(plan.width * plan.height).toBeLessThanOrEqual(MAX_REQUEST_CELLS * 1.2);
  });
});

describe("resolutionForWindow", () => {
  it("never goes finer than 2 m", () => {
    expect(resolutionForWindow(DUSSELDORF_CENTRE, 19)).toBeGreaterThanOrEqual(2);
    expect(resolutionForWindow(DUSSELDORF_CENTRE, 15)).toBeLessThanOrEqual(8);
  });

  it("coarsens instead of exploding the grid", () => {
    const huge: Bbox = [6.68, 51.14, 6.92, 51.34];
    const resolution = resolutionForWindow(huge, 15);
    const metres = MAX_WINDOW_M;
    expect(resolution).toBeGreaterThanOrEqual(Math.floor(metres / 400));
  });
});
