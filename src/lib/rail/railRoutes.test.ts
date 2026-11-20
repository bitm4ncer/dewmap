import { describe, expect, it } from "vitest";
import type { OverpassElement } from "../overpass";
import { classifyRailRoute, parseRailRoutes } from "./railRoutes";

describe("classifyRailRoute", () => {
  it("maps light rail modes directly", () => {
    expect(classifyRailRoute({ route: "subway" })).toBe("subway");
    expect(classifyRailRoute({ route: "tram" })).toBe("tram");
    expect(classifyRailRoute({ route: "light_rail" })).toBe("tram");
  });

  it("recognises S-Bahn relations", () => {
    expect(classifyRailRoute({ route: "train", network: "S-Bahn Rhein-Ruhr" })).toBe("sbahn");
    expect(classifyRailRoute({ route: "train", ref: "S 11" })).toBe("sbahn");
    expect(classifyRailRoute({ route: "train", train: "commuter" })).toBe("sbahn");
  });

  it("recognises regional and long-distance services", () => {
    expect(classifyRailRoute({ route: "train", train: "regional" })).toBe("regional");
    expect(classifyRailRoute({ route: "train", ref: "RE 1" })).toBe("regional");
    expect(classifyRailRoute({ route: "train", ref: "RB 38" })).toBe("regional");
    expect(classifyRailRoute({ route: "train", train: "national" })).toBe("longDistance");
    expect(classifyRailRoute({ route: "train", ref: "ICE 10" })).toBe("longDistance");
    expect(classifyRailRoute({ route: "train", ref: "IC 30" })).toBe("longDistance");
  });

  it("falls back to regional for unclassified heavy rail", () => {
    expect(classifyRailRoute({ route: "train" })).toBe("regional");
  });

  it("ignores other route relations", () => {
    expect(classifyRailRoute({ route: "bus" })).toBeNull();
    expect(classifyRailRoute(undefined)).toBeNull();
  });
});

function relation(id: number, tags: Record<string, string>, ways: number[]) {
  return {
    type: "relation" as const,
    id,
    tags,
    members: ways.map((ref) => ({
      type: "way" as const,
      ref,
      role: "",
      geometry: [
        { lat: 51.22, lon: 6.77 },
        { lat: 51.23, lon: 6.78 },
      ],
    })),
  } satisfies OverpassElement;
}

describe("parseRailRoutes", () => {
  it("keeps the most local service when ways are shared", () => {
    const network = parseRailRoutes([
      relation(1, { route: "train", ref: "ICE 10", train: "national" }, [100]),
      relation(2, { route: "train", network: "S-Bahn" }, [100]),
    ]);
    expect(network.routes.features).toHaveLength(1);
    expect(network.routes.features[0].properties?.kind).toBe("sbahn");
  });

  it("drops members without usable geometry and non-rail relations", () => {
    const network = parseRailRoutes([
      relation(1, { route: "bus" }, [1]),
      {
        type: "relation",
        id: 2,
        tags: { route: "train" },
        members: [
          { type: "way", ref: 3, role: "", geometry: [{ lat: 51.2, lon: 6.7 }] },
          { type: "node", ref: 4, role: "", geometry: [] },
        ],
      } as OverpassElement,
    ]);
    expect(network.routes.features).toHaveLength(0);
  });
});
