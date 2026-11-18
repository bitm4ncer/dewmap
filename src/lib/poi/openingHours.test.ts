import { describe, expect, it } from "vitest";
import { parseOpeningHours } from "./openingHours";

const monday10 = new Date(2026, 10, 16, 10, 0);
const sunday12 = new Date(2026, 10, 22, 12, 0);

describe("parseOpeningHours", () => {
  it("expands 24/7", () => {
    const result = parseOpeningHours("24/7", monday10);
    expect(result?.openNow).toBe(true);
    expect(result?.rows).toHaveLength(7);
    expect(result?.rows.every((row) => row.ranges[0] === "24 hours")).toBe(true);
  });

  it("parses weekday ranges and a closed Sunday", () => {
    const result = parseOpeningHours(
      "Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off",
      monday10,
    );
    expect(result?.openNow).toBe(true);
    expect(result?.rows[0].ranges).toEqual(["09:00–18:00"]);
    expect(result?.rows[5].ranges).toEqual(["10:00–14:00"]);
    expect(result?.rows[6].closed).toBe(true);
    expect(result?.todayIndex).toBe(0);
  });

  it("marks Sunday as closed", () => {
    const result = parseOpeningHours(
      "Mo-Fr 09:00-18:00; Sa 10:00-14:00; Su off",
      sunday12,
    );
    expect(result?.openNow).toBe(false);
    expect(result?.todayIndex).toBe(6);
  });

  it("keeps multiple windows per day", () => {
    const result = parseOpeningHours(
      "Mo-Fr 09:00-12:00,13:00-18:00",
      monday10,
    );
    expect(result?.rows[0].ranges).toEqual(["09:00–12:00", "13:00–18:00"]);
    expect(result?.openNow).toBe(true);
  });

  it("handles overnight ranges", () => {
    const night = parseOpeningHours(
      "Mo-Su 18:00-02:00",
      new Date(2026, 10, 16, 23, 0),
    );
    expect(night?.openNow).toBe(true);
    const early = parseOpeningHours(
      "Mo-Su 18:00-02:00",
      new Date(2026, 10, 16, 1, 0),
    );
    expect(early?.openNow).toBe(true);
    const noon = parseOpeningHours(
      "Mo-Su 18:00-02:00",
      new Date(2026, 10, 16, 12, 0),
    );
    expect(noon?.openNow).toBe(false);
  });

  it("falls back to the raw value for unsupported selectors", () => {
    const result = parseOpeningHours("PH off; Jan 1 off", monday10);
    expect(result?.raw).toBe("PH off; Jan 1 off");
    expect(result?.openNow).toBeNull();
    expect(result?.rows.every((row) => row.ranges.length === 0)).toBe(true);
  });

  it("returns undefined for empty input", () => {
    expect(parseOpeningHours(undefined)).toBeUndefined();
    expect(parseOpeningHours("   ")).toBeUndefined();
  });
});
