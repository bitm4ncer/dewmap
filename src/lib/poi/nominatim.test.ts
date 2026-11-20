import { describe, expect, it } from "vitest";
import { parseNominatimPlace } from "./nominatim";

const museum = {
  osm_type: "relation",
  osm_id: 4211594,
  lat: "52.521",
  lon: "13.394",
  category: "tourism",
  type: "museum",
  extratags: {
    building: "yes",
    opening_hours: "Tu-Su 10:00-17:00",
    "contact:website": "www.example.org",
    "contact:phone": "+49 30 123",
    "contact:instagram": "@example",
    wheelchair: "yes",
    "payment:cards": "yes",
  },
  address: {
    road: "Am Kupfergraben",
    house_number: "1-3",
    postcode: "10117",
    city: "Berlin",
  },
  namedetails: { name: "Bode-Museum" },
};

const busStop = {
  osm_type: "node",
  osm_id: 900,
  lat: "51.22",
  lon: "6.79",
  category: "highway",
  type: "bus_stop",
  extratags: { highway: "bus_stop", name: "Degerstraße" },
  namedetails: { name: "Degerstraße" },
  address: {
    road: "Degerstraße",
    city: "Düsseldorf",
  },
};

const building = {
  osm_type: "way",
  osm_id: 99,
  lat: "51.2",
  lon: "6.8",
  category: "building",
  type: "yes",
  extratags: { building: "yes" },
  address: {
    road: "Gneisenaustraße",
    house_number: "51",
    postcode: "40477",
    city: "Düsseldorf",
  },
};

describe("parseNominatimPlace", () => {
  it("parses a museum with contact, socials, facts and hours", () => {
    const poi = parseNominatimPlace(museum);
    expect(poi?.category).toBe("Museum");
    expect(poi?.name).toBe("Bode-Museum");
    expect(poi?.address).toBe("Am Kupfergraben 1-3, 10117 Berlin");
    expect(poi?.city).toBe("Berlin");
    expect(poi?.website).toBe("https://www.example.org");
    expect(poi?.phone).toBe("+49 30 123");
    expect(poi?.openingRaw).toBe("Tu-Su 10:00-17:00");
    expect(poi?.socials).toContainEqual({
      label: "Instagram",
      url: "https://www.instagram.com/example",
    });
    expect(poi?.facts).toContainEqual({
      label: "Wheelchair access",
      value: "Yes",
    });
    expect(poi?.facts).toContainEqual({
      label: "Payment",
      value: "Cards",
    });
    expect(poi?.osmType).toBe("R");
  });

  it("labels a bus stop as a bus stop, not a street", () => {
    const poi = parseNominatimPlace(busStop);
    expect(poi?.category).toBe("Bus stop");
    expect(poi?.name).toBe("Degerstraße");
  });

  it("turns an unnamed generic building into a clean address", () => {
    const poi = parseNominatimPlace(building);
    expect(poi?.category).toBe("Address");
    expect(poi?.name).toBe("Gneisenaustraße 51");
    expect(poi?.website).toBeUndefined();
  });

  it("rejects malformed records", () => {
    expect(parseNominatimPlace(null)).toBeNull();
    expect(parseNominatimPlace({ osm_id: 1 })).toBeNull();
  });
});
