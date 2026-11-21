import { describe, expect, it } from "vitest";

// The store reads localStorage on import; give it a no-op so tests can run in
// a plain node environment (vitest is configured for `environment: "node"`).
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  },
});

const { latestAnalysisIndex, useOverlays } = await import("./store");
type RadarFramesPayload = import("./api").RadarFramesPayload;

function payload(count: number, anchorIndex: number, anchorIso: string): RadarFramesPayload {
  return {
    ok: true,
    generated: anchorIso,
    now: anchorIso,
    anchor: anchorIso,
    intervalMinutes: 5,
    forecastIntervalMinutes: 15,
    image: { width: 1000, height: 974, bounds: [1, 45, 19, 56] },
    source: "test",
    attribution: { label: "test" },
    frames: Array.from({ length: count }, (_, i) => ({
      slot: `20261121T0${String(i).padStart(2, "0")}`,
      time: new Date(Date.parse(anchorIso) + (i - anchorIndex) * 300_000).toISOString(),
      kind: i <= anchorIndex ? ("analysis" as const) : ("forecast" as const),
      url: `/f/${i}.png`,
    })),
  };
}

describe("overlay store", () => {
  it("toggles overlays and clamps opacity", () => {
    const state = useOverlays.getState();
    state.setEnabled("weather-radar", true);
    expect(useOverlays.getState().isEnabled("weather-radar")).toBe(true);
    state.toggle("weather-radar");
    expect(useOverlays.getState().isEnabled("weather-radar")).toBe(false);

    state.setOpacity("weather-radar", 1.4);
    expect(useOverlays.getState().opacityFor("weather-radar", 0.5)).toBe(1);
    state.setOpacity("weather-radar", Number.NaN);
    expect(useOverlays.getState().opacityFor("weather-radar", 0.5)).toBe(1);
    expect(useOverlays.getState().opacityFor("never-set", 0.5)).toBe(0.5);
  });

  it("finds the newest analysis frame", () => {
    expect(latestAnalysisIndex(payload(18, 11, "2026-11-21T04:50:00Z"))).toBe(11);
    expect(latestAnalysisIndex(null)).toBe(0);
  });

  it("follows the live edge when a new payload arrives", () => {
    const state = useOverlays.getState();
    state.setRadarFrames(payload(18, 11, "2026-11-21T04:50:00Z"));
    expect(useOverlays.getState().radarIndex).toBe(11);
    state.setRadarFrames(payload(18, 14, "2026-11-21T05:05:00Z"));
    expect(useOverlays.getState().radarIndex).toBe(14);
  });

  it("keeps a scrubbed position when the payload refreshes", () => {
    const state = useOverlays.getState();
    state.setRadarFrames(payload(18, 11, "2026-11-21T04:50:00Z"));
    state.setRadarIndex(3);
    state.setRadarFrames(payload(18, 14, "2026-11-21T05:05:00Z"));
    expect(useOverlays.getState().radarIndex).toBe(3);
  });

  it("clamps the frame index to the list", () => {
    const state = useOverlays.getState();
    state.setRadarFrames(payload(18, 11, "2026-11-21T04:50:00Z"));
    state.setRadarIndex(99);
    expect(useOverlays.getState().radarIndex).toBe(17);
    state.setRadarIndex(-5);
    expect(useOverlays.getState().radarIndex).toBe(0);
  });

  it("records status transitions and clears stale errors", () => {
    const state = useOverlays.getState();
    state.setRadarStatus("error", "boom");
    expect(useOverlays.getState().radarError).toBe("boom");
    state.setRadarStatus("ready");
    expect(useOverlays.getState().radarError).toBeNull();
    state.setWarningsStatus("error", "nope");
    expect(useOverlays.getState().warningsError).toBe("nope");
    state.setWarningsStatus("loading");
    expect(useOverlays.getState().warningsError).toBeNull();
  });

  it("keeps warning areas reachable for the map", async () => {
    const { warningAreasOf } = await import("./store");
    expect(warningAreasOf(null)).toBeNull();
    const areas = { type: "FeatureCollection" as const, features: [] };
    const collected = warningAreasOf({
      ok: true,
      generated: "2026-11-21T00:00:00Z",
      issuedAt: null,
      counts: {},
      total: 0,
      maxLevel: 0,
      validUntil: null,
      warnings: [],
      areas,
      areasComplete: true,
      source: { warnings: "", areas: "" },
      attribution: { label: "" },
    });
    expect(collected?.features).toEqual([]);
  });
});
