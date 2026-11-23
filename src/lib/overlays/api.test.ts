import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OverlayApiError,
  fetchRadarFrames,
  fetchWarnings,
  isAbortError,
  overlayErrorMessage,
} from "./api";

const framesPayload = {
  ok: true,
  generated: "2026-11-21T05:12:00.000Z",
  now: "2026-11-21T05:12:00.000Z",
  anchor: "2026-11-21T04:50:00.000Z",
  intervalMinutes: 5,
  forecastIntervalMinutes: 15,
  image: { width: 1000, height: 974, bounds: [1.4, 45.6, 18.7, 56.2] },
  source: "DWD GeoServer · Radar_rv_product_1x1km_ger",
  attribution: { label: "Deutscher Wetterdienst (DWD)" },
  frames: [
    {
      slot: "20261121T0450",
      time: "2026-11-21T04:50:00.000Z",
      kind: "analysis",
      url: "/api/weather/radar/frames/20261121T0450.png",
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("radar frames", () => {
  it("returns a validated payload", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(framesPayload));
    const payload = await fetchRadarFrames();
    expect(payload.frames).toHaveLength(1);
    expect(payload.anchor).toBe("2026-11-21T04:50:00.000Z");
  });

  it("rejects a payload without frames", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true, frames: [] }));
    await expect(fetchRadarFrames()).rejects.toMatchObject({
      code: "bad_response",
    });
  });

  it("rejects frames with an unknown kind", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        ...framesPayload,
        frames: [{ ...framesPayload.frames[0], kind: "guess" }],
      }),
    );
    await expect(fetchRadarFrames()).rejects.toMatchObject({
      code: "bad_response",
    });
  });

  it("maps a 5xx to an upstream error and a 4xx to bad_response", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({}, 502));
    await expect(fetchRadarFrames()).rejects.toMatchObject({
      code: "upstream",
      status: 502,
    });
    globalThis.fetch = vi.fn(async () => jsonResponse({}, 400));
    await expect(fetchRadarFrames()).rejects.toMatchObject({
      code: "bad_response",
      status: 400,
    });
  });

  it("turns invalid JSON into bad_response", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token");
      },
    })) as unknown as typeof fetch;
    await expect(fetchRadarFrames()).rejects.toMatchObject({
      code: "bad_response",
    });
  });
});

describe("warnings", () => {
  it("accepts a normalised payload", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        ok: true,
        warnings: [],
        areas: { type: "FeatureCollection", features: [] },
      }),
    );
    const payload = await fetchWarnings();
    expect(payload.areas.features).toEqual([]);
  });

  it("rejects a payload whose areas are not a FeatureCollection", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ ok: true, warnings: [], areas: { type: "Polygon" } }),
    );
    await expect(fetchWarnings()).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("timeouts", () => {
  it("aborts after the configured timeout", async () => {
    globalThis.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    ) as unknown as typeof fetch;

    await expect(fetchRadarFrames({ timeoutMs: 10 })).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("propagates an external abort as aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    globalThis.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
            return;
          }
          reject(new Error("should not run"));
        }),
    ) as unknown as typeof fetch;

    await expect(
      fetchRadarFrames({ signal: controller.signal }),
    ).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("error helpers", () => {
  it("detects abort errors of both shapes", () => {
    expect(isAbortError(new OverlayApiError("aborted", "x"))).toBe(true);
    const domLike = Object.assign(new Error("x"), { name: "AbortError" });
    expect(isAbortError(domLike)).toBe(true);
    expect(isAbortError(new Error("x"))).toBe(false);
  });

  it("maps codes to readable English copy", () => {
    expect(overlayErrorMessage(new OverlayApiError("timeout", ""))).toMatch(
      /did not answer in time/,
    );
    expect(overlayErrorMessage(new OverlayApiError("bad_response", ""))).toMatch(
      /unexpected data/,
    );
    expect(overlayErrorMessage(new Error("boom"))).toMatch(/unavailable/);
  });
});
