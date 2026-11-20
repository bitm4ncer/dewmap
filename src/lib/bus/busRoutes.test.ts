import type { Map as MLMap } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import type { OverpassElement } from "../overpass";
import {
  BUS_STOP_LAYER_ID,
  bboxContains,
  busStopPoiSelection,
  ensureBusLayers,
  isEmptyBusNetwork,
  parseBusNetwork,
  snapBboxToGrid,
} from "./busRoutes";

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

  it("turns top-level way elements into LineStrings", () => {
    const network = parseBusNetwork([
      {
        type: "way",
        id: 5,
        geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }],
      },
    ]);
    expect(network.routes.features).toHaveLength(1);
    expect(network.routes.features[0].properties?.wayId).toBe(5);
    expect(network.routes.features[0].geometry.coordinates).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(network.stops.features).toHaveLength(0);
  });

  it("deduplicates a way that appears both top-level and as a relation member", () => {
    const geometry = [
      { lat: 51.2, lon: 6.8 },
      { lat: 51.21, lon: 6.81 },
    ];
    const network = parseBusNetwork([
      { type: "way", id: 11, geometry },
      relation(1, "703", [{ ref: 11, geometry }]),
    ]);
    expect(network.routes.features).toHaveLength(1);
  });

  it("drops null and invalid points instead of throwing", () => {
    const geometry = [
      { lat: 51.2, lon: 6.8 },
      null,
      { lat: Number.NaN, lon: 6.805 },
      { lat: 51.21, lon: 6.81 },
    ] as unknown as { lat: number; lon: number }[];
    const network = parseBusNetwork([relation(1, "703", [{ ref: 11, geometry }])]);
    expect(network.routes.features).toHaveLength(1);
    expect(network.routes.features[0].geometry.coordinates).toEqual([
      [6.8, 51.2],
      [6.81, 51.21],
    ]);
  });

  it("skips ways with fewer than two valid points", () => {
    const allNull = [null, null] as unknown as { lat: number; lon: number }[];
    const onePoint = [
      { lat: 51.2, lon: 6.8 },
      null,
    ] as unknown as { lat: number; lon: number }[];
    const network = parseBusNetwork([
      relation(1, "703", [
        { ref: 11, geometry: allNull },
        { ref: 12, geometry: onePoint },
      ]),
      {
        type: "way",
        id: 13,
        geometry: [null, { lat: 51.2, lon: 6.8 }] as unknown as {
          lat: number;
          lon: number;
        }[],
      },
    ]);
    expect(network.routes.features).toHaveLength(0);
  });
});

describe("busStopPoiSelection", () => {
  it("opens the exact stop as a bus-stop place card", () => {
    expect(
      busStopPoiSelection([6.79, 51.22], {
        id: 900,
        name: "Degerstraße",
      }),
    ).toMatchObject({
      osmType: "N",
      osmId: 900,
      lon: 6.79,
      lat: 51.22,
      name: "Degerstraße",
      category: "Bus stop",
    });
  });

  it("keeps unnamed stops readable", () => {
    expect(busStopPoiSelection([6.79, 51.22], null)).toMatchObject({
      name: "Bus stop",
      category: "Bus stop",
    });
  });
});

describe("bus stop layers", () => {
  it("draws larger dots so stops read from farther out", () => {
    const layers = new Map<string, { paint?: Record<string, unknown> }>();
    const sources = new Set<string>();
    const map = {
      getSource: (id: string) => (sources.has(id) ? {} : undefined),
      addSource: (id: string) => {
        sources.add(id);
      },
      getLayer: (id: string) => layers.get(id),
      addLayer: (layer: { id: string; paint?: Record<string, unknown> }) => {
        layers.set(layer.id, layer);
      },
      getStyle: () => ({ layers: [] }),
    } as unknown as MLMap;

    ensureBusLayers(map, {
      routes: { type: "FeatureCollection", features: [] },
      stops: { type: "FeatureCollection", features: [] },
    });

    expect(layers.get(BUS_STOP_LAYER_ID)?.paint?.["circle-radius"]).toEqual([
      "interpolate",
      ["linear"],
      ["zoom"],
      10,
      4,
      12,
      5,
      14,
      6,
      17,
      7,
    ]);
  });
});

describe("isEmptyBusNetwork", () => {
  it("is true only when routes and stops are both empty", () => {
    expect(
      isEmptyBusNetwork({
        routes: { type: "FeatureCollection", features: [] },
        stops: { type: "FeatureCollection", features: [] },
      }),
    ).toBe(true);
    expect(
      isEmptyBusNetwork(
        parseBusNetwork([
          { type: "way", id: 1, geometry: [{ lat: 1, lon: 1 }, { lat: 2, lon: 2 }] },
        ]),
      ),
    ).toBe(false);
  });
});

describe("bus cache coverage", () => {
  const cached: [number, number, number, number] = [51.15, 6.65, 51.3, 6.9];

  it("snaps a bbox outward to the coarse grid", () => {
    const snapped = snapBboxToGrid([51.221, 6.771, 51.233, 6.789]);
    expect(snapped[0]).toBeLessThanOrEqual(51.221);
    expect(snapped[1]).toBeLessThanOrEqual(6.771);
    expect(snapped[2]).toBeGreaterThanOrEqual(51.233);
    expect(snapped[3]).toBeGreaterThanOrEqual(6.789);
    for (const value of snapped) {
      const steps = value / 0.05;
      expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    }
  });

  it("serves a viewport that is fully inside a cached cell", () => {
    expect(bboxContains(cached, [51.22, 6.75, 51.24, 6.8])).toBe(true);
  });

  it("detects when a viewport leaves the cached coverage", () => {
    expect(bboxContains(cached, [51.35, 6.75, 51.4, 6.8])).toBe(false);
    expect(bboxContains(cached, [51.0, 6.75, 51.2, 6.8])).toBe(false);
    expect(bboxContains(cached, [51.22, 6.6, 51.24, 6.8])).toBe(false);
  });
});
