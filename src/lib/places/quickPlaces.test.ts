import { describe, expect, it } from "vitest";
import { visibleQuickPlaces } from "./quickPlaces";

describe("visibleQuickPlaces", () => {
  it("drops ephemeral map picks so they do not duplicate the map action", () => {
    const places = [
      { name: "Map point" },
      { name: "Heidelberg Hbf" },
      { name: "map point " },
      { name: "Mannheim" },
    ];
    expect(visibleQuickPlaces(places).map((p) => p.name)).toEqual([
      "Heidelberg Hbf",
      "Mannheim",
    ]);
  });

  it("keeps at most four shortcuts", () => {
    const places = Array.from({ length: 6 }, (_, i) => ({ name: `P${i}` }));
    expect(visibleQuickPlaces(places)).toHaveLength(4);
  });
});
