import { describe, expect, it } from "vitest";
import { classifyStationSubclass, mergeStations } from "./stationMarkers";

describe("classifyStationSubclass", () => {
  it("maps tile subclasses to marker kinds", () => {
    expect(classifyStationSubclass("station")).toBe("rail");
    expect(classifyStationSubclass("halt")).toBe("rail");
    expect(classifyStationSubclass("subway")).toBe("subway");
    expect(classifyStationSubclass("tram_stop")).toBe("tram");
    expect(classifyStationSubclass("bus_stop")).toBeNull();
  });
});

describe("mergeStations", () => {
  it("combines same-name modes into one marker with rings", () => {
    const merged = mergeStations([
      { name: "Heinrich-Heine-Allee", lon: 6.776, lat: 51.227, kind: "tram" },
      { name: "Heinrich-Heine-Allee", lon: 6.7762, lat: 51.2271, kind: "subway" },
      { name: "Heinrich-Heine-Allee", lon: 6.7764, lat: 51.2272, kind: "rail" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kinds).toEqual(["rail", "subway", "tram"]);
    expect(merged[0].lon).toBeCloseTo(6.7764, 4);
  });

  it("does not merge unrelated stops with the same name far apart", () => {
    const merged = mergeStations([
      { name: "Bahnhof", lon: 6.77, lat: 51.22, kind: "tram" },
      { name: "Bahnhof", lon: 6.9, lat: 51.4, kind: "rail" },
    ]);
    expect(merged).toHaveLength(2);
  });

  it("keeps unnamed stops separate", () => {
    const merged = mergeStations([
      { name: "", lon: 6.77, lat: 51.22, kind: "tram" },
      { name: "", lon: 6.7701, lat: 51.2201, kind: "tram" },
    ]);
    expect(merged).toHaveLength(2);
  });
});
