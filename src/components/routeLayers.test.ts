import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hiking = readFileSync(
  new URL("./hiking/useHikingLayers.ts", import.meta.url),
  "utf8",
);
const car = readFileSync(
  new URL("./planner/usePlannerLayers.ts", import.meta.url),
  "utf8",
);

describe("car, walk and bike route layers", () => {
  it("gives each mode its own primary route colour", () => {
    // A red car line under a green bike line is what made a stale car route
    // look like the new one.
    expect(car).toContain("THEME.danger");
    expect(hiking).toContain("THEME.routeHike");
    for (const src of [hiking, car]) {
      expect(src).toContain('"line-dasharray": [2, 1.5]');
    }
  });

  it("uses a wide hit path for alternatives and routes taps through the pipeline", () => {
    for (const src of [hiking, car]) {
      expect(src).toContain("ALT_HIT");
      // Alt-route taps resolve via the central feature-tap pipeline,
      // which owns preventDefault + haptic + ripple feedback.
      expect(src).toContain("registerFeatureTaps");
    }
  });

  it("labels every route with distance and duration", () => {
    for (const src of [hiking, car]) {
      expect(src).toContain("formatRouteLabel");
      expect(src).toContain('"text-field": ["get", "label"]');
    }
  });
});
