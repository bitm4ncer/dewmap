import { describe, expect, it } from "vitest";
import { buildRoutePoints } from "./routing";

describe("buildRoutePoints", () => {
  it("returns null for fewer than two waypoints", () => {
    expect(buildRoutePoints([])).toBeNull();
    expect(
      buildRoutePoints([
        { id: "a", lat: 52.5, lon: 13.4, label: "A", source: "search" },
      ]),
    ).toBeNull();
  });

  it("maps waypoints to lon/lat in traversal order", () => {
    expect(
      buildRoutePoints([
        { id: "a", lat: 52.5, lon: 13.4, label: "A", source: "search" },
        { id: "b", lat: 53.5, lon: 9.9, label: "B", source: "gps" },
      ]),
    ).toEqual([
      { lat: 52.5, lon: 13.4 },
      { lat: 53.5, lon: 9.9 },
    ]);
  });
});
