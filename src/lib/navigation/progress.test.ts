import { describe, expect, it } from "vitest";
import type { Maneuver, RoutePlan } from "../routing";
import {
  computeRouteProgress,
  previewSpeedMps,
  sampleRouteAtDistance,
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
