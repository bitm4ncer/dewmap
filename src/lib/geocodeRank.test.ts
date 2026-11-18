import { describe, expect, it } from "vitest";
import { rankByProximity } from "./geocode";

const near: [number, number] = [8.69, 49.41]; // Heidelberg

describe("rankByProximity", () => {
  it("puts a nearby shop ahead of a far city with the same name", () => {
    const results = [
      { name: "Rewe", coordinates: [-3.5, 50.78] as [number, number] },
      { name: "REWE", coordinates: [10.04, 48.41] as [number, number] },
      { name: "REWE", coordinates: [8.69, 49.41] as [number, number] },
    ];
    expect(rankByProximity(results, near).map((r) => r.name)).toEqual([
      "REWE",
      "REWE",
      "Rewe",
    ]);
  });

  it("keeps a strong far city match above a weak local match", () => {
    const results = [
      { name: "London", coordinates: [9.0, 50.0] as [number, number] },
      { name: "A", coordinates: near },
      { name: "B", coordinates: near },
      { name: "C", coordinates: near },
      { name: "D", coordinates: near },
      { name: "E", coordinates: near },
    ];
    expect(rankByProximity(results, near)[0].name).toBe("London");
  });

  it("preserves API order when no origin is available", () => {
    const results = [
      { name: "A", coordinates: [0, 0] as [number, number] },
      { name: "B", coordinates: [1, 1] as [number, number] },
    ];
    expect(rankByProximity(results, undefined)).toEqual(results);
  });
});
