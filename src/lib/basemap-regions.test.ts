import { describe, expect, it } from "vitest";
import { REGION_POLYGONS, pointInRegion, type BasemapRegion } from "./basemap-regions";

const inside: Record<BasemapRegion, [number, number]> = {
  de: [13.405, 52.52], // Berlin
  by: [11.582, 48.135], // Munich
  at: [16.373, 48.208], // Vienna
  ch: [8.54, 47.37], // Zurich
  fr: [2.352, 48.857], // Paris
  nl: [4.904, 52.367], // Amsterdam
  no: [10.752, 59.914], // Oslo
  cz: [14.437, 50.075], // Prague
  pl: [21.012, 52.23], // Warsaw
  es: [-3.703, 40.417], // Madrid
  uk: [-0.127, 51.507], // London
  jp: [139.691, 35.689], // Tokyo
};

describe("basemap region outlines", () => {
  it("contains each country's capital or reference city", () => {
    for (const [region, point] of Object.entries(inside)) {
      expect(pointInRegion(region as BasemapRegion, point[0], point[1]), region).toBe(true);
    }
  });

  it("distinguishes neighbouring countries", () => {
    expect(pointInRegion("de", 8.54, 47.37)).toBe(false); // Zurich
    expect(pointInRegion("ch", 13.405, 52.52)).toBe(false); // Berlin
    expect(pointInRegion("at", 11.582, 48.135)).toBe(false); // Munich
    expect(pointInRegion("by", 13.05, 47.81)).toBe(false); // Salzburg
    expect(pointInRegion("jp", 126.978, 37.566)).toBe(false); // Seoul
    expect(pointInRegion("fr", 6.143, 46.204)).toBe(false); // Geneva
  });

  it("has a usable outline for every region", () => {
    for (const region of Object.keys(inside) as BasemapRegion[]) {
      expect(REGION_POLYGONS[region].length, region).toBeGreaterThan(0);
      expect(REGION_POLYGONS[region][0].length, region).toBeGreaterThan(3);
    }
  });
});
