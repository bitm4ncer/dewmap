import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookupPoi: vi.fn(),
  reversePoi: vi.fn(),
}));

vi.mock("./nominatim", () => ({
  lookupPoi: mocks.lookupPoi,
  reversePoi: mocks.reversePoi,
}));

import { fetchPoiDetails } from "./index";

const rawStreetStop = {
  osmType: "N",
  osmId: 41751991,
  lat: 50.98,
  lon: 6.3,
  name: "Pfarrer-Reiff-Straße",
  category: "Street",
  address: "Pfarrer-Reiff-Straße, 52441 Linnich",
  socials: [],
  facts: [],
  tags: {},
};

describe("fetchPoiDetails for bus stops", () => {
  beforeEach(() => {
    mocks.lookupPoi.mockReset();
    mocks.reversePoi.mockReset();
  });

  it("keeps the stop identity and never reverse-geocodes", async () => {
    mocks.lookupPoi.mockResolvedValue(rawStreetStop);
    const details = await fetchPoiDetails({
      lon: 6.3,
      lat: 50.98,
      name: "Bus stop",
      category: "Bus stop",
      osmType: "N",
      osmId: 41751991,
    });
    expect(details?.name).toBe("Bus stop");
    expect(details?.category).toBe("Bus stop");
    expect(details?.address).toBe("Pfarrer-Reiff-Straße, 52441 Linnich");
    expect(mocks.reversePoi).not.toHaveBeenCalled();
  });

  it("does not turn a failed stop lookup into an address", async () => {
    mocks.lookupPoi.mockResolvedValue(null);
    const details = await fetchPoiDetails({
      lon: 6.31,
      lat: 50.99,
      name: "Welz Kirche",
      category: "Bus stop",
      osmType: "N",
      osmId: 41751992,
    });
    expect(details).toBeNull();
    expect(mocks.reversePoi).not.toHaveBeenCalled();
  });
});
