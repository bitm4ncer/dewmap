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
  it("draws the primary route red and alternatives dashed in accent", () => {
    for (const src of [hiking, car]) {
      expect(src).toContain("THEME.danger");
      expect(src).toContain('"line-dasharray": [2, 1.5]');
    }
  });

  it("labels every route with distance and duration", () => {
    for (const src of [hiking, car]) {
      expect(src).toContain("formatRouteLabel");
      expect(src).toContain('"text-field": ["get", "label"]');
    }
  });
});
