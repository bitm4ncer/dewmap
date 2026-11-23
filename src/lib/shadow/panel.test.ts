import { describe, expect, it } from "vitest";
import {
  formatShadowClock,
  formatShadowDay,
  formatShadowOffset,
  shadowStatusLine,
  sunSummary,
} from "./panel";
import type { ShadowStatsView } from "./state";

const stats: ShadowStatsView = {
  buildings: 1234,
  shadowFraction: 0.18,
  computeMs: 87.4,
  encodeMs: 12,
  resolutionM: 4,
  width: 300,
  height: 200,
  tiles: 6,
  tileBytes: 43_000,
  cacheHits: 0,
  partial: false,
};

describe("shadow panel copy", () => {
  it("formats the pilot clock in Berlin time", () => {
    const date = new Date("2026-06-21T10:00:00Z");
    expect(formatShadowClock(date)).toBe("12:00");
    expect(formatShadowClock(new Date(Number.NaN))).toBe("--:--");
  });

  it("labels the slider offset", () => {
    expect(formatShadowOffset(0)).toBe("now");
    expect(formatShadowOffset(45)).toBe("+45 min");
    expect(formatShadowOffset(-45)).toBe("−45 min");
    expect(formatShadowOffset(125)).toBe("+2 h 05");
    expect(formatShadowOffset(-120)).toBe("−2 h");
  });

  it("labels a different day only when it is one, in English", () => {
    const now = new Date("2026-06-21T10:00:00Z");
    expect(formatShadowDay(now, now)).toBeNull();
    // 2026-06-22 is a Monday; the app is `lang="en"`, so no "Mo".
    expect(formatShadowDay(new Date("2026-06-22T05:00:00Z"), now)).toBe("Mon");
  });

  it("explains every empty state", () => {
    expect(shadowStatusLine({ phase: "zoomed-out", message: null, stats: null, sun: null })).toBe(
      "Zoom in to 14",
    );
    expect(
      shadowStatusLine({ phase: "outside", message: null, stats: null, sun: null }),
    ).toContain("Outside the Düsseldorf pilot");
    expect(
      shadowStatusLine({ phase: "empty", message: "No buildings in this view.", stats: null, sun: null }),
    ).toBe("No buildings in this view.");
    expect(
      shadowStatusLine({
        phase: "night",
        message: "Sun below the horizon — no cast shadows.",
        stats: null,
        sun: null,
      }),
    ).toContain("below the horizon");
    expect(shadowStatusLine({ phase: "off", message: null, stats: null, sun: null })).toBeNull();
  });

  it("starts the loading line with resolving so the card shows a spinner", () => {
    expect(shadowStatusLine({ phase: "loading", message: null, stats, sun: null })).toMatch(
      /^resolving/,
    );
  });

  it("summarises a ready run", () => {
    const line = shadowStatusLine({
      phase: "ready",
      message: null,
      stats: { ...stats, partial: true },
      sun: {
        azimuthDeg: 180,
        elevationDeg: 31.6,
        elevationGeometricDeg: 31.6,
        declinationDeg: 0,
        hourAngleDeg: 0,
        equationOfTimeMin: 0,
      },
    });
    expect(line).toContain("1,234 buildings");
    expect(line).toContain("4 m");
    expect(line).toContain("87 ms");
    expect(line).toContain("clipped to pilot");
    expect(line).toContain("sun 32°");
    expect(sunSummary(null)).toBeNull();
  });
});
