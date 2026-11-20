import { describe, expect, it } from "vitest";
import type { OverpassElement } from "../overpass";
import { parseBusNetwork } from "./busRoutes";

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

describe("parseBusNetwork", () => {
  it("turns relation way members into LineStrings", () => {
    const network = parseBusNetwork([
      relation(1, "703", [
        {
          ref: 11,
          geometry: [
            { lat: 51.2, lon: 6.8 },
            { lat: 51.21, lon: 6.81 },
          ],
        },
      ]),
    ]);
    expect(network.routes.type).toBe("FeatureCollection");
    expect(network.routes.features).toHaveLength(1);
    expect(network.routes.features[0].properties).toMatchObject({
      routeId: 1,
      ref: "703",
    });
    expect(network.routes.features[0].geometry.coordinates).toEqual([
      [6.8, 51.2],
      [6.81, 51.21],
    ]);
  });

  it("collects bus stops from nodes", () => {
    const network = parseBusNetwork([
      {
        type: "node",
        id: 900,
        lat: 51.22,
        lon: 6.79,
        tags: { highway: "bus_stop", name: "Degerstraße" },
      },
    ]);
    expect(network.stops.features).toHaveLength(1);
    expect(network.stops.features[0].geometry.coordinates).toEqual([6.79, 51.22]);
    expect(network.stops.features[0].properties).toMatchObject({
      id: 900,
      name: "Degerstraße",
    });
  });

  it("skips nodes without coordinates", () => {
    const network = parseBusNetwork([
      { type: "node", id: 901, lat: Number.NaN, lon: 6.79 },
    ]);
    expect(network.stops.features).toHaveLength(0);
  });

  it("deduplicates ways shared by several bus lines", () => {
    const shared = {
      ref: 11,
      geometry: [
        { lat: 51.2, lon: 6.8 },
        { lat: 51.21, lon: 6.81 },
      ],
    };
    const network = parseBusNetwork([
      relation(1, "703", [shared]),
      relation(2, "704", [shared]),
    ]);
    expect(network.routes.features).toHaveLength(1);
  });

  it("skips members without usable geometry", () => {
    const network = parseBusNetwork([
      relation(1, "703", [
        { ref: 11 },
        { ref: 12, geometry: [{ lat: 1, lon: 1 }] },
      ]),
    ]);
    expect(network.routes.features).toHaveLength(0);
  });

  it("ignores non-relation, non-node elements", () => {
    const network = parseBusNetwork([
      { type: "way", id: 5, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
    ]);
    expect(network.routes.features).toHaveLength(0);
    expect(network.stops.features).toHaveLength(0);
  });
});
