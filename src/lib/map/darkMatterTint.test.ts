import { describe, expect, it } from "vitest";
import { applyDarkMatterTint, type DarkMatterMap } from "./darkMatterTint";

function fakeMap(layers: { id: string; type: string }[], withOutline = true) {
  const paint: Record<string, unknown> = {};
  const layout: Record<string, unknown> = {};
  const map: DarkMatterMap = {
    getStyle: () => ({ layers }),
    getPaintProperty: (_id, name) => (withOutline || name !== "fill-outline-color" ? "#000000" : undefined),
    setPaintProperty: (id, name, value) => {
      paint[`${id}:${name}`] = value;
    },
    setLayoutProperty: (id, name, value) => {
      layout[`${id}:${name}`] = value;
    },
  };
  return { map, paint, layout };
}

describe("applyDarkMatterTint", () => {
  it("flattens the surface ramp to graphite", () => {
    const { map, paint } = fakeMap([
      { id: "background", type: "background" },
      { id: "water", type: "fill" },
      { id: "landuse", type: "fill" },
      { id: "building", type: "fill" },
      { id: "road_pri", type: "line" },
      { id: "road_pri_case", type: "line" },
      { id: "waterway", type: "line" },
      { id: "admin", type: "line" },
    ]);
    applyDarkMatterTint(map);
    expect(paint["background:background-color"]).toBe("#2c2d31");
    expect(paint["water:fill-color"]).toBe("#26272b");
    expect(paint["landuse:fill-color"]).toBe("#292a2e");
    expect(paint["building:fill-color"]).toBe("#303136");
    expect(paint["road_pri:line-color"]).toBe("#4a4b50");
    expect(paint["road_pri_case:line-color"]).toBe("#35363b");
    expect(paint["waterway:line-color"]).toBe("#3a3e44");
    expect(paint["admin:line-color"]).toBe("#515258");
  });

  it("keeps the label hierarchy and enlarges the quiet tiers", () => {
    const { map, paint, layout } = fakeMap([
      { id: "place_city", type: "symbol" },
      { id: "place_suburbs", type: "symbol" },
      { id: "roadname_pri", type: "symbol" },
    ]);
    applyDarkMatterTint(map);
    expect(paint["place_city:text-color"]).toBe("#d7dade");
    expect(paint["place_suburbs:text-color"]).toBe("#a9aeb7");
    expect(paint["roadname_pri:text-color"]).toBe("#8f939b");
    expect(paint["roadname_pri:text-halo-color"]).toBe("#26272b");
    expect(layout["place_suburbs:text-letter-spacing"]).toBe(0.04);
    expect(layout["place_suburbs:text-size"]).toBeDefined();
    expect(layout["roadname_pri:text-size"]).toBeDefined();
  });

  it("skips layers that do not expose an outline colour", () => {
    const { map, paint } = fakeMap([{ id: "water", type: "fill" }], false);
    applyDarkMatterTint(map);
    expect(paint["water:fill-outline-color"]).toBeUndefined();
    expect(paint["water:fill-color"]).toBe("#26272b");
  });
});
