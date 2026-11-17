import { afterEach, describe, expect, it, vi } from "vitest";
import { planRoutes, planRoutesStreaming } from "./engine";
import { ProviderError, type RouteRequest } from "./types";

const BROUTER_GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [8.68, 49.41],
          [8.69, 49.42],
        ],
      },
      properties: {
        "track-length": "1400",
        "total-time": "600",
      },
    },
  ],
};

const MOTIS_ITINERARY = {
  duration: 600,
  startTime: "2026-11-17T10:00:00Z",
  endTime: "2026-11-17T10:10:00Z",
  transfers: 0,
  legs: [
    {
      mode: "WALK",
      from: {
        name: "START",
        lat: 49.41,
        lon: 8.68,
        departure: "2026-11-17T10:00:00Z",
        scheduledDeparture: "2026-11-17T10:00:00Z",
      },
      to: {
        name: "END",
        lat: 49.42,
        lon: 8.69,
        arrival: "2026-11-17T10:10:00Z",
        scheduledArrival: "2026-11-17T10:10:00Z",
      },
      duration: 600,
      startTime: "2026-11-17T10:00:00Z",
      endTime: "2026-11-17T10:10:00Z",
      scheduledStartTime: "2026-11-17T10:00:00Z",
      scheduledEndTime: "2026-11-17T10:10:00Z",
      realTime: false,
      cancelled: false,
      distance: 1300,
      legGeometry: { points: "" },
    },
  ],
};

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    mode: "walk",
    waypoints: [
      { lat: 49.41, lon: 8.68 },
      { lat: 49.42, lon: 8.69 },
    ],
    alternatives: 1,
    ...overrides,
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function captureError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error("Expected the promise to reject.");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("planRoutes", () => {
  it("dispatches walk requests to BRouter", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse(BROUTER_GEOJSON),
    );
    vi.stubGlobal("fetch", fetchMock);

    const plans = await planRoutes(request({ mode: "walk" }));
    expect(plans).toHaveLength(1);
    expect(plans[0].provider).toBe("brouter");
    const call = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit?,
    ];
    expect(String(call[0])).toContain("brouter.de/brouter");
  });

  it("dispatches transit requests to MOTIS", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse({ itineraries: [MOTIS_ITINERARY] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const plans = await planRoutes(request({ mode: "transit" }));
    expect(plans).toHaveLength(1);
    expect(plans[0].provider).toBe("motis");
    expect(plans[0].mode).toBe("transit");
    const call = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit?,
    ];
    expect(String(call[0])).toContain("api.transitous.org/api/v1/plan");
  });

  it("falls back from Valhalla to BRouter car-eco", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("valhalla")) {
          return new Response("overloaded", { status: 503 });
        }
        return okResponse(BROUTER_GEOJSON);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const plans = await planRoutes(request({ mode: "car" }));
    expect(plans).toHaveLength(1);
    expect(plans[0].provider).toBe("brouter");
    expect(plans[0].profile).toBe("car-eco");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fall back when the caller aborts", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse(BROUTER_GEOJSON),
    );
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    controller.abort();
    const err = await captureError(
      planRoutes(request({ mode: "car", signal: controller.signal })),
    );
    expect(err.kind).toBe("aborted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid requests without calling fetch", async () => {
    const fetchMock = vi.fn(async () => okResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    const err = await captureError(
      planRoutes(request({ waypoints: [{ lat: 1, lon: 2 }] })),
    );
    expect(err.kind).toBe("bad-response");

    const invalidCoordinates = await captureError(
      planRoutes(
        request({
          waypoints: [
            { lat: Number.NaN, lon: 2 },
            { lat: 3, lon: 4 },
          ],
        }),
      ),
    );
    expect(invalidCoordinates.kind).toBe("bad-response");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("planRoutesStreaming", () => {
  it("streams BRouter alternatives", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          okResponse(BROUTER_GEOJSON),
      ),
    );

    const streamed: string[] = [];
    const plans = await planRoutesStreaming(request({ alternatives: 2 }), {
      onPlan: (plan) => streamed.push(plan.id),
    });
    expect(plans).toHaveLength(2);
    expect(streamed).toHaveLength(2);
  });
});
