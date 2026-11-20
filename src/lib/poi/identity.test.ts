import { describe, expect, it } from "vitest";
import { poiIdentity } from "./identity";
import type { RawPoi } from "./nominatim";

const rawStreet = {
  osmType: "N",
  osmId: 41751991,
  lat: 50.98,
  lon: 6.3,
  name: "Pfarrer-Reiff-Straße",
  category: "Street",
  socials: [],
  facts: [],
  tags: {},
} as RawPoi;

describe("poiIdentity", () => {
  it("keeps a bus stop identity when Nominatim returns a street", () => {
    expect(
      poiIdentity(
        {
          lon: 6.3,
          lat: 50.98,
          name: "Bus stop",
          category: "Bus stop",
          osmType: "N",
          osmId: 41751991,
        },
        rawStreet,
      ),
    ).toEqual({ name: "Bus stop", category: "Bus stop" });
  });

  it("keeps a named stop's name", () => {
    expect(
      poiIdentity(
        {
          lon: 6.3,
          lat: 50.98,
          name: "Welz Kirche",
          category: "Bus stop",
          osmType: "N",
          osmId: 1,
        },
        rawStreet,
      ),
    ).toEqual({ name: "Welz Kirche", category: "Bus stop" });
  });

  it("leaves an ordinary place untouched", () => {
    const raw = { ...rawStreet, name: "Bode-Museum", category: "Museum" };
    expect(
      poiIdentity(
        {
          lon: 13.394,
          lat: 52.521,
          name: "Bode-Museum",
          category: "Museum",
          osmType: "R",
          osmId: 4211594,
        },
        raw,
      ),
    ).toEqual({ name: "Bode-Museum", category: "Museum" });
  });
});
