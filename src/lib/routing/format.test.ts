import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDayOffset,
  formatDistance,
  formatDuration,
  formatRouteLabel,
  formatRelativeDelay,
} from "./format";

describe("formatDuration", () => {
  it("handles zero, sub-minute, and invalid values", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(-2)).toBe("0 min");
    expect(formatDuration(Number.NaN)).toBe("0 min");
    expect(formatDuration(0.4)).toBe("<1 min");
  });

  it("formats minutes and hours", () => {
    expect(formatDuration(5.4)).toBe("5 min");
    expect(formatDuration(59.6)).toBe("1 h");
    expect(formatDuration(60)).toBe("1 h");
    expect(formatDuration(75)).toBe("1 h 15 min");
    expect(formatDuration(125.2)).toBe("2 h 5 min");
  });
});

describe("formatRouteLabel", () => {
  it("combines distance and duration for map labels", () => {
    expect(formatRouteLabel(12.4, 38)).toBe("12 km · 38 min");
    expect(formatRouteLabel(0.35, 5)).toBe("350 m · 5 min");
  });
});

describe("formatDistance", () => {
  it("uses metres below one kilometre", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(-1)).toBe("0 m");
    expect(formatDistance(0.35)).toBe("350 m");
  });

  it("uses kilometres with sensible precision", () => {
    expect(formatDistance(1)).toBe("1.0 km");
    expect(formatDistance(2.34)).toBe("2.3 km");
    expect(formatDistance(9.99)).toBe("10.0 km");
    expect(formatDistance(12.6)).toBe("13 km");
  });
});

describe("formatClock", () => {
  it("formats a valid ISO timestamp", () => {
    expect(formatClock("2026-11-17T12:00:00Z", "en-GB", "UTC")).toBe("12:00");
    expect(formatClock("2026-11-17T08:05:00Z", "en-GB", "UTC")).toBe("08:05");
  });

  it("returns a dash for invalid timestamps", () => {
    expect(formatClock("not-a-date")).toBe("—");
    expect(formatClock("")).toBe("—");
  });
});

describe("formatDayOffset", () => {
  it("detects a midnight crossing in the journey zone", () => {
    expect(
      formatDayOffset(
        "2026-11-18T23:30:00Z",
        "2026-11-18T22:00:00Z",
        "en-GB",
        "Europe/Berlin",
      ),
    ).toBe("+1");
  });

  it("returns null for the same local day and handles negative offsets", () => {
    expect(
      formatDayOffset(
        "2026-11-18T10:00:00Z",
        "2026-11-18T12:00:00Z",
        "en-GB",
        "Europe/Berlin",
      ),
    ).toBeNull();
    expect(
      formatDayOffset(
        "2026-11-17T22:30:00Z",
        "2026-11-18T00:30:00Z",
        "en-GB",
        "Europe/Berlin",
      ),
    ).toBe("-1");
  });
});

describe("formatRelativeDelay", () => {
  it("treats small differences as on time", () => {
    expect(formatRelativeDelay(0)).toBe("on time");
    expect(formatRelativeDelay(30)).toBe("on time");
    expect(formatRelativeDelay(-45)).toBe("on time");
  });

  it("formats late and early delays in minutes", () => {
    expect(formatRelativeDelay(120)).toBe("+2 min");
    expect(formatRelativeDelay(90)).toBe("+2 min");
    expect(formatRelativeDelay(-180)).toBe("-3 min");
  });

  it("handles invalid values", () => {
    expect(formatRelativeDelay(Number.NaN)).toBe("—");
  });
});
