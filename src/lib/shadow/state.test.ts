import { describe, expect, it } from "vitest";

// The settings store persists to localStorage; a no-op keeps the tests in the
// node environment (vitest is configured with `environment: "node"`).
const memory = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  },
});

const { MAX_OFFSET_MINUTES, OFFSET_STEP_MINUTES, shadowTimeFor, useShadowRuntime, useShadowSettings } =
  await import("./state");

describe("shadow settings", () => {
  it("clamps the slider to ±12 h and snaps to 5 minutes", () => {
    const state = useShadowSettings.getState();
    state.setOffsetMinutes(2000);
    expect(useShadowSettings.getState().offsetMinutes).toBe(MAX_OFFSET_MINUTES);
    state.setOffsetMinutes(-2000);
    expect(useShadowSettings.getState().offsetMinutes).toBe(-MAX_OFFSET_MINUTES);
    state.setOffsetMinutes(67);
    expect(useShadowSettings.getState().offsetMinutes % OFFSET_STEP_MINUTES).toBe(0);
    state.setOffsetMinutes(Number.NaN);
    expect(useShadowSettings.getState().offsetMinutes).toBe(0);
  });

  it("computes the instant from now plus the offset", () => {
    const now = new Date("2026-06-21T10:00:00Z");
    expect(shadowTimeFor(0, now).toISOString()).toBe(now.toISOString());
    expect(shadowTimeFor(90, now).toISOString()).toBe("2026-06-21T11:30:00.000Z");
    expect(shadowTimeFor(-90, now).toISOString()).toBe("2026-06-21T08:30:00.000Z");
  });

  it("resets to now", () => {
    useShadowSettings.getState().setOffsetMinutes(300);
    useShadowSettings.getState().resetToNow();
    expect(useShadowSettings.getState().offsetMinutes).toBe(0);
  });
});

describe("shadow runtime", () => {
  it("walks through the phases and bumps the run id", () => {
    const runtime = useShadowRuntime.getState();
    const before = runtime.runId;
    runtime.begin("Rendering shadows…");
    expect(useShadowRuntime.getState().phase).toBe("loading");
    runtime.zoomedOut("Zoom in to 14");
    expect(useShadowRuntime.getState().phase).toBe("zoomed-out");
    runtime.outside("outside");
    expect(useShadowRuntime.getState().phase).toBe("outside");
    runtime.fail("boom");
    expect(useShadowRuntime.getState().phase).toBe("error");
    runtime.off();
    expect(useShadowRuntime.getState().phase).toBe("off");
    expect(useShadowRuntime.getState().runId).toBeGreaterThan(before + 4);
  });

  it("keeps the last stats only while a render is ready", () => {
    const runtime = useShadowRuntime.getState();
    runtime.ready({
      sun: {
        azimuthDeg: 180,
        elevationDeg: 20,
        elevationGeometricDeg: 20,
        declinationDeg: 0,
        hourAngleDeg: 0,
        equationOfTimeMin: 0,
      },
      stats: {
        buildings: 10,
        shadowFraction: 0.2,
        computeMs: 40,
        encodeMs: 5,
        resolutionM: 4,
        width: 100,
        height: 100,
        tiles: 2,
        tileBytes: 1000,
        cacheHits: 0,
        partial: false,
      },
    });
    expect(useShadowRuntime.getState().phase).toBe("ready");
    expect(useShadowRuntime.getState().stats?.buildings).toBe(10);
    runtime.empty("night", "night", null);
    expect(useShadowRuntime.getState().stats).toBeNull();
  });
});
