import { describe, expect, it } from "vitest";
import { basemapUsesTimeline } from "./basemaps";

describe("basemapUsesTimeline", () => {
  it("shows the timeline for the two time-aware photo basemaps", () => {
    expect(basemapUsesTimeline("s2cloudless", "photo")).toBe(true);
    expect(basemapUsesTimeline("gibs-today", "photo")).toBe(true);
  });

  it("hides it for fixed basemaps and when a vector style is active", () => {
    expect(basemapUsesTimeline("esri-imagery", "photo")).toBe(false);
    expect(basemapUsesTimeline("night", "photo")).toBe(false);
    expect(basemapUsesTimeline("s2cloudless", "vector")).toBe(false);
  });
});
