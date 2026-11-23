import { describe, expect, it, vi } from "vitest";
import { handleShadowRequest, type ShadowWorkerRequest } from "./workerTask";
import { serializeBuildings } from "./render";
import { MAX_REQUEST_CELLS } from "./pilot";
import type { BuildingFootprint } from "./types";

const BBOX = [6.779, 51.229, 6.781, 51.230] as [number, number, number, number];

function building(heightM = 30): BuildingFootprint {
  return {
    id: "b",
    heightM,
    ring: [
      [6.7798, 51.2294],
      [6.7802, 51.2294],
      [6.7802, 51.2296],
      [6.7798, 51.2296],
    ],
  };
}

function renderRequest(overrides: Partial<ShadowWorkerRequest> = {}): ShadowWorkerRequest {
  return {
    type: "render",
    id: 7,
    bbox: BBOX,
    timeMs: Date.parse("2026-06-21T10:00:00Z"),
    resolutionM: 2,
    buildings: serializeBuildings([building()]),
    ...overrides,
  } as ShadowWorkerRequest;
}

const encoder = vi.fn(async () => "data:image/png;base64,AAAA");

describe("handleShadowRequest", () => {
  it("answers with the request id and a PNG", async () => {
    const response = await handleShadowRequest(renderRequest(), encoder);
    expect(response).toMatchObject({
      type: "result",
      id: 7,
      pngUrl: "data:image/png;base64,AAAA",
    });
    if (response?.type !== "result") throw new Error("expected result");
    expect(response.width * response.height).toBeLessThanOrEqual(MAX_REQUEST_CELLS * 2);
    expect(response.sun.elevationDeg).toBeGreaterThan(0);
    expect(response.stats.buildingCount).toBe(1);
    expect(encoder).toHaveBeenCalledWith(
      expect.objectContaining({ width: expect.any(Number) }),
      { alpha: 255 },
    );
  });

  it("says no-buildings and skips the encoder", async () => {
    const local = vi.fn(async () => "x");
    const response = await handleShadowRequest(
      renderRequest({ buildings: serializeBuildings([]) }),
      local,
    );
    expect(response).toMatchObject({ type: "empty", id: 7, reason: "no-buildings" });
    expect(local).not.toHaveBeenCalled();
  });

  it("says night below the horizon", async () => {
    const response = await handleShadowRequest(
      renderRequest({ timeMs: Date.parse("2026-11-23T01:00:00Z") }),
      encoder,
    );
    expect(response).toMatchObject({ type: "empty", id: 7, reason: "night" });
    if (response?.type !== "empty") throw new Error("expected empty");
    expect(response.sun!.elevationDeg).toBeLessThan(0);
  });

  it("rejects malformed requests without throwing", async () => {
    const response = await handleShadowRequest(
      { type: "render", id: 3, bbox: [0, 0, 0] as never, timeMs: 0, resolutionM: 0, buildings: null as never },
      encoder,
    );
    expect(response).toMatchObject({ type: "error", id: 3, code: "invalid" });
  });

  it("ignores cancel messages", async () => {
    expect(await handleShadowRequest({ type: "cancel", id: 1 }, encoder)).toBeNull();
  });

  it("reports a missing encoder instead of a broken result", async () => {
    const response = await handleShadowRequest(renderRequest(), async () => null);
    expect(response).toMatchObject({ type: "error", code: "no-canvas" });
  });

  it("turns a throwing encoder into an error response", async () => {
    const response = await handleShadowRequest(renderRequest(), async () => {
      throw new Error("boom");
    });
    expect(response).toMatchObject({ type: "error", code: "compute", message: "boom" });
  });
});
