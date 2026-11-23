import { describe, expect, it } from "vitest";
import { framesInfo, radarStatusLine, warningsStatusLine } from "./status";
import type { RadarFramesPayload, WarningsPayload } from "./api";

const clock = () => "14:35";

function frames(analysis = 12, forecast = 6): RadarFramesPayload {
  return {
    ok: true,
    generated: "2026-11-23T13:35:00.000Z",
    now: "2026-11-23T13:45:00.000Z",
    anchor: "2026-11-23T13:35:00.000Z",
    intervalMinutes: 5,
    forecastIntervalMinutes: 15,
    image: { width: 1000, height: 974, bounds: [1, 45, 19, 56] },
    source: "test",
    attribution: { label: "DWD" },
    frames: [
      ...Array.from({ length: analysis }, (_, i) => ({
        slot: `a${i}`,
        time: "2026-11-23T13:35:00.000Z",
        kind: "analysis" as const,
        url: `/a${i}.png`,
      })),
      ...Array.from({ length: forecast }, (_, i) => ({
        slot: `f${i}`,
        time: "2026-11-23T13:50:00.000Z",
        kind: "forecast" as const,
        url: `/f${i}.png`,
      })),
    ],
  };
}

const payload = { total: 843, maxLevel: 2 } as WarningsPayload;

describe("radar status", () => {
  it("is silent when the overlay is off", () => {
    expect(
      radarStatusLine({
        enabled: false,
        status: "ready",
        error: null,
        frames: frames(),
        imageStatus: "ready",
        imageError: null,
        clock,
      }),
    ).toBeNull();
  });

  it("summarises frames while everything is fine", () => {
    expect(
      radarStatusLine({
        enabled: true,
        status: "ready",
        error: null,
        frames: frames(),
        imageStatus: "ready",
        imageError: null,
        clock,
      }),
    ).toBe("12 analysis + 6 nowcast frames · as of 14:35");
    expect(framesInfo(null)).toBeNull();
  });

  it("shows the loading line only before the first payload", () => {
    expect(
      radarStatusLine({
        enabled: true,
        status: "loading",
        error: null,
        frames: null,
        imageStatus: "idle",
        imageError: null,
        clock,
      }),
    ).toBe("Loading radar frames…");
  });

  it("keeps the frame info when a refresh fails", () => {
    expect(
      radarStatusLine({
        enabled: true,
        status: "error",
        error: "The source is unavailable right now.",
        frames: frames(),
        imageStatus: "ready",
        imageError: null,
        clock,
      }),
    ).toBe("12 analysis + 6 nowcast frames · as of 14:35 · refresh failed");
  });

  it("falls back to the error only when there is no data at all", () => {
    expect(
      radarStatusLine({
        enabled: true,
        status: "error",
        error: "The source did not answer in time.",
        frames: null,
        imageStatus: "idle",
        imageError: null,
        clock,
      }),
    ).toBe("The source did not answer in time.");
  });

  it("reports a failed image even though the frame list is healthy", () => {
    expect(
      radarStatusLine({
        enabled: true,
        status: "ready",
        error: null,
        frames: frames(),
        imageStatus: "error",
        imageError: "Radar image could not be loaded for this frame.",
        clock,
      }),
    ).toBe(
      "Radar image could not be loaded for this frame. · 12 analysis + 6 nowcast frames · as of 14:35",
    );
  });
});

describe("warnings status", () => {
  const summary = "843 warnings · as of 14:35";

  it("is silent when off", () => {
    expect(
      warningsStatusLine({
        enabled: false,
        status: "ready",
        error: null,
        payload,
        summary,
      }),
    ).toBeNull();
  });

  it("shows the summary", () => {
    expect(
      warningsStatusLine({ enabled: true, status: "ready", error: null, payload, summary }),
    ).toBe(summary);
  });

  it("keeps the summary when a refresh fails", () => {
    expect(
      warningsStatusLine({
        enabled: true,
        status: "error",
        error: "The source did not answer in time.",
        payload,
        summary,
      }),
    ).toBe(`${summary} · refresh failed`);
  });

  it("shows the error when nothing was ever loaded", () => {
    expect(
      warningsStatusLine({
        enabled: true,
        status: "error",
        error: "Warnings are unavailable right now.",
        payload: null,
        summary: null,
      }),
    ).toBe("Warnings are unavailable right now.");
    expect(
      warningsStatusLine({
        enabled: true,
        status: "loading",
        error: null,
        payload: null,
        summary: null,
      }),
    ).toBe("Loading warnings…");
  });
});
