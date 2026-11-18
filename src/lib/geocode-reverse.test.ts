import { describe, expect, it } from "vitest";
import { reverseAddressName } from "./geocode";

describe("reverseAddressName", () => {
  it("builds the street address without repeating the city", () => {
    expect(
      reverseAddressName({
        street: "Scheibenstraße",
        housenumber: "39",
        city: "Düsseldorf",
      }),
    ).toBe("Scheibenstraße 39");
  });

  it("falls back to the feature name", () => {
    expect(reverseAddressName({ name: "Hauptbahnhof", city: "Köln" })).toBe(
      "Hauptbahnhof",
    );
  });

  it("keeps a name that already contains the city", () => {
    expect(
      reverseAddressName({ name: "Düsseldorf Hauptbahnhof", city: "Düsseldorf" }),
    ).toBe("Düsseldorf Hauptbahnhof");
  });
});
