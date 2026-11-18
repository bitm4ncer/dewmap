import { describe, expect, it } from "vitest";
import { formatCoordinates } from "./coordinates";

describe("formatCoordinates", () => {
  it("formats a lat/lon pair for copying", () => {
    expect(formatCoordinates(51.227678, 6.775012)).toBe("51.2277, 6.7750");
  });
});
