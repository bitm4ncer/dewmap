import { describe, expect, it } from "vitest";
import type { OverpassElement } from "../overpass";
import { parseBusRoutes } from "./busRoutes";

function relation(
  id: number,
  ref: string,
  members: { ref: number; geometry?: { lat: number; lon: number }[] }[],
): OverpassElement {
  return {
    type: "relation",
    id,
    tags: { route: "bus", ref },
    members: members.map((m) => ({
      type: "way" as const,
      ref: m.ref,
      role: "",
      geometry: m.geometry,
    })),
  };
}

describe("parseBusRoutes", () => {
  it("turns relation way members into LineStrings", () => {
    const data = {
      elements: [
        relation(1, "703", [
          {
            ref: 11,
            geometry: [
              { lat: 51.2, lon: 6.8 },
              { lat: 51.21, lon: 6.81 },
            ],
          },
        ]),
      ],
    };
    const fc = parseBusRoutes(data.elements);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ routeId: 1, ref: "703" });
    expect(fc.features[0].geometry.coordinates).toEqual([
      [6.8, 51.2],
      [6.81, 51.21],
    ]);
  });

  it("deduplicates ways shared by several bus lines", () => {
    const shared = {
      ref: 11,
      geometry: [
        { lat: 51.2, lon: 6.8 },
        { lat: 51.21, lon: 6.81 },
      ],
    };
    const fc = parseBusRoutes([
      relation(1, "703", [shared]),
      relation(2, "704", [shared]),
    ]);
    expect(fc.features).toHaveLength(1);
  });

  it("skips members without usable geometry", () => {
    const fc = parseBusRoutes([
      relation(1, "703", [
        { ref: 11 },
        { ref: 12, geometry: [{ lat: 1, lon: 1 }] },
      ]),
    ]);
    expect(fc.features).toHaveLength(0);
  });

  it("ignores non-relation elements", () => {
    const fc = parseBusRoutes([
      { type: "way", id: 5, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
    ]);
    expect(fc.features).toHaveLength(0);
  });
});
