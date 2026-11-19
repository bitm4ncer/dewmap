import { describe, expect, it } from "vitest";
import type { Maneuver, RoutePlan } from "../routing";
import {
  angleDelta,
  cameraBearing,
  computeRouteProgress,
  previewSpeedMps,
  sampleRouteAtDistance,
  smoothedBearing,
} from "./progress";

function maneuver(overrides: Partial<Maneuver>): Maneuver {
  return {
    type: "turn",
    instruction: "Turn",
    verbal: "Turn.",
    distanceM: 0,
    durationS: 0,
    startIndex: 0,
    endIndex: 0,
    ...overrides,
  };
}

function route(maneuvers: Maneuver[]): RoutePlan {
  return {
    id: "test",
    mode: "walk",
    provider: "brouter",
    distanceKm: 2.2,
    durationMin: 30,
    coordinates: [
      [0, 0],
      [0.01, 0],
      [0.02, 0],
    ],
    maneuvers,
  };
}

describe("computeRouteProgress", () => {
  it("returns the first maneuver instead of skipping it", () => {
    const plan = route([
      maneuver({ type: "depart", startIndex: 0, endIndex: 1 }),
      maneuver({ startIndex: 1, endIndex: 2 }),
      maneuver({ type: "arrive", startIndex: 2, endIndex: 2 }),
    ]);
    const progress = computeRouteProgress(plan, { lon: 0.001, lat: 0 });
    expect(progress?.next?.type).toBe("depart");
  });

  it("advances to the maneuver that covers the current segment", () => {
    const plan = route([
      maneuver({ type: "depart", startIndex: 0, endIndex: 1 }),
      maneuver({ instruction: "Second", startIndex: 1, endIndex: 2 }),
      maneuver({ type: "arrive", startIndex: 2, endIndex: 2 }),
    ]);
    const progress = computeRouteProgress(plan, { lon: 0.011, lat: 0 });
    expect(progress?.next?.instruction).toBe("Second");
  });

  it("falls back to the arrival maneuver at the end", () => {
    const plan = route([
      maneuver({ type: "depart", startIndex: 0, endIndex: 1 }),
      maneuver({ type: "arrive", startIndex: 2, endIndex: 2 }),
    ]);
    const progress = computeRouteProgress(plan, { lon: 0.02, lat: 0 });
    expect(progress?.next?.type).toBe("arrive");
  });
});

describe("sampleRouteAtDistance", () => {
  it("interpolates by distance, not by vertex count", () => {
    const coords: [number, number][] = [
      [0, 0],
      [0.001, 0],
      [0.02, 0],
    ];
    const sample = sampleRouteAtDistance(coords, 80);
    expect(sample?.lon).toBeGreaterThan(0.0004);
    expect(sample?.lon).toBeLessThan(0.0012);
    expect(sample?.lat).toBeCloseTo(0);
  });

  it("clamps beyond the end and reports the bearing", () => {
    const sample = sampleRouteAtDistance(
      [
        [0, 0],
        [0.01, 0],
      ],
      1_000_000,
    );
    expect(sample?.lon).toBeCloseTo(0.01);
    expect(sample?.bearing).toBeGreaterThan(80);
    expect(sample?.bearing).toBeLessThan(100);
  });

  it("returns null for a degenerate line", () => {
    expect(sampleRouteAtDistance([[0, 0]], 10)).toBeNull();
  });
});

describe("previewSpeedMps", () => {
  it("compresses long transit previews instead of taking hours", () => {
    const speed = previewSpeedMps({ mode: "transit", distanceKm: 600 });
    expect(speed).toBeGreaterThan(1000);
    expect(600_000 / speed).toBeLessThan(300);
  });

  it("keeps walking previews near walking speed", () => {
    expect(previewSpeedMps({ mode: "walk", distanceKm: 0.05 })).toBe(1.5);
  });
});

describe("angleDelta", () => {
  it("takes the shortest arc across zero", () => {
    expect(angleDelta(10, 350)).toBe(-20);
    expect(angleDelta(350, 10)).toBe(20);
  });

  it("is zero for equal bearings", () => {
    expect(angleDelta(179, 179)).toBe(0);
  });
});

describe("smoothedBearing", () => {
  it("moves a fraction of the shortest arc, wrapping correctly", () => {
    const next = smoothedBearing(350, 10, 0.5);
    expect(angleDelta(350, next)).toBeCloseTo(10, 5);
    expect(next).toBeCloseTo(360, 5);
  });

  it("converges onto the target", () => {
    let bearing = 0;
    for (let i = 0; i < 40; i += 1) bearing = smoothedBearing(bearing, 90);
    expect(Math.abs(angleDelta(bearing, 90))).toBeLessThan(0.1);
  });

  it("ignores invalid k", () => {
    expect(smoothedBearing(0, 100, 5)).toBe(100);
    expect(smoothedBearing(0, 100, -1)).toBe(0);
  });
});

describe("cameraBearing", () => {
  const progress = { courseBearing: 90 } as never;

  it("trusts GPS heading only above the noise floor", () => {
    expect(cameraBearing(progress, 45, 0.5)).toBe(90);
    expect(cameraBearing(progress, 45, 3)).toBe(45);
  });

  it("falls back to route course, then raw heading, then north", () => {
    expect(cameraBearing(null, null, null)).toBe(0);
    expect(cameraBearing(null, 123, 0.2)).toBe(123);
    expect(cameraBearing(progress, null, null)).toBe(90);
  });
});
