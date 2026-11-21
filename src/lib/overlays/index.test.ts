import { describe, expect, it, beforeEach } from "vitest";
import {
  getOverlay,
  listOverlays,
  overlayGroups,
  registerOverlay,
  resetOverlayRegistry,
  unregisterOverlay,
} from "./index";
import type { OverlayDefinition } from "./types";

function def(id: string, order: number, group = "weather"): OverlayDefinition {
  return {
    id,
    label: id.toUpperCase(),
    group,
    kind: "geojson",
    description: "",
    attribution: { label: "src" },
    opacity: 1,
    timeAware: false,
    order,
    resolve: () => null,
  };
}

describe("overlay registry", () => {
  beforeEach(() => resetOverlayRegistry());

  it("registers and reads back a definition", () => {
    registerOverlay(def("radar", 10));
    expect(getOverlay("radar")?.label).toBe("RADAR");
  });

  it("replaces a definition with the same id instead of duplicating it", () => {
    registerOverlay(def("radar", 10));
    registerOverlay({ ...def("radar", 20), label: "NEW" });
    expect(listOverlays()).toHaveLength(1);
    expect(getOverlay("radar")?.label).toBe("NEW");
  });

  it("sorts by order, highest first, then by label", () => {
    registerOverlay(def("a", 1));
    registerOverlay(def("b", 100));
    registerOverlay(def("c", 50));
    expect(listOverlays().map((o) => o.id)).toEqual(["b", "c", "a"]);
  });

  it("filters by group and keeps the global order", () => {
    registerOverlay(def("radar", 100, "weather"));
    registerOverlay(def("river", 10, "water"));
    registerOverlay(def("warn", 110, "weather"));
    expect(listOverlays("weather").map((o) => o.id)).toEqual(["warn", "radar"]);
    expect(listOverlays("water").map((o) => o.id)).toEqual(["river"]);
    expect(overlayGroups()).toEqual(["weather", "water"]);
  });

  it("unregisters and rejects definitions without an id", () => {
    registerOverlay(def("radar", 1));
    expect(unregisterOverlay("radar")).toBe(true);
    expect(unregisterOverlay("radar")).toBe(false);
    expect(() =>
      registerOverlay({ ...def("", 1), id: "" }),
    ).toThrow(/needs an id/);
  });

  it("supports groups a later module introduces", () => {
    registerOverlay(def("shadow-sites", 1, "shadow"));
    expect(listOverlays("shadow")).toHaveLength(1);
    expect(overlayGroups()).toContain("shadow");
  });
});
