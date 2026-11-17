import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildValhallaBody,
  costingForMode,
  decodePolyline,
  mapValhallaManeuverType,
  mapValhallaModifier,
  planValhalla,
} from "./valhalla";
import { ProviderError, type RouteRequest } from "../types";

const VALHALLA_SHAPE = "atvf}AicxpOSwF}CqwA??";

const TRIP = {
  summary: {
    time: 13.064,
    length: 0.112,
    has_toll: false,
    has_highway: false,
    has_ferry: false,
  },
  legs: [
    {
      shape: VALHALLA_SHAPE,
      maneuvers: [
        {
          type: 1,
          instruction: "Drive east on Iqbal-Ufer/B 37.",
          verbal_pre_transition_instruction:
            "Drive east on Iqbal-Ufer, B 37. Then your destination will be on the left.",
          length: 0.112,
          time: 13.064,
          begin_shape_index: 0,
          end_shape_index: 3,
          street_names: ["Iqbal-Ufer", "B 37"],
        },
        {
          type: 6,
          instruction: "Your destination is on the left.",
          verbal_pre_transition_instruction:
            "Your destination is on the left.",
          length: 0,
          time: 0,
          begin_shape_index: 3,
          end_shape_index: 3,
          street_names: null,
        },
      ],
    },
  ],
};

function carRequest(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    mode: "car",
    waypoints: [
      { lat: 49.4099, lon: 8.68 },
      { lat: 49.4105, lon: 8.6815 },
    ],
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

describe("decodePolyline", () => {
  it("decodes Google's precision-5 reference polyline", () => {
    const points = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5);
    expect(points).toHaveLength(3);
    expect(points[0].lat).toBeCloseTo(38.5, 5);
    expect(points[0].lon).toBeCloseTo(-120.2, 5);
    expect(points[1].lat).toBeCloseTo(40.7, 5);
    expect(points[1].lon).toBeCloseTo(-120.95, 5);
    expect(points[2].lat).toBeCloseTo(43.252, 5);
    expect(points[2].lon).toBeCloseTo(-126.453, 5);
  });

  it("decodes Valhalla's precision-6 shape", () => {
    const points = decodePolyline(VALHALLA_SHAPE, 6);
    expect(points).toHaveLength(4);
    expect(points[0].lat).toBeCloseTo(49.409873, 6);
    expect(points[0].lon).toBeCloseTo(8.680005, 6);
    expect(points[3].lat).toBeCloseTo(49.409962, 6);
    expect(points[3].lon).toBeCloseTo(8.681546, 6);
  });

  it("returns no points for empty or malformed input", () => {
    expect(decodePolyline("", 6)).toEqual([]);
    expect(decodePolyline("~~~~~", 6).length).toBeGreaterThanOrEqual(0);
  });
});

describe("Valhalla maneuver mapping", () => {
  it("maps type codes to normalized maneuver types", () => {
    expect(mapValhallaManeuverType(1)).toBe("depart");
    expect(mapValhallaManeuverType(2)).toBe("depart");
    expect(mapValhallaManeuverType(4)).toBe("arrive");
    expect(mapValhallaManeuverType(6)).toBe("arrive");
    expect(mapValhallaManeuverType(7)).toBe("continue");
    expect(mapValhallaManeuverType(8)).toBe("continue");
    expect(mapValhallaManeuverType(9)).toBe("turn");
    expect(mapValhallaManeuverType(17)).toBe("ramp");
    expect(mapValhallaManeuverType(23)).toBe("fork");
    expect(mapValhallaManeuverType(25)).toBe("merge");
    expect(mapValhallaManeuverType(26)).toBe("roundabout");
    expect(mapValhallaManeuverType(28)).toBe("ferry");
    expect(mapValhallaManeuverType(30)).toBe("transit");
    expect(mapValhallaManeuverType(999)).toBe("continue");
  });

  it("maps modifiers for directional maneuvers", () => {
    expect(mapValhallaModifier(9)).toBe("slight-right");
    expect(mapValhallaModifier(10)).toBe("slight-left");
    expect(mapValhallaModifier(12)).toBe("sharp-left");
    expect(mapValhallaModifier(15)).toBe("right");
    expect(mapValhallaModifier(16)).toBe("left");
    expect(mapValhallaModifier(13)).toBe("uturn");
    expect(mapValhallaModifier(1)).toBeUndefined();
  });
});

describe("costingForMode", () => {
  it("maps travel modes and honors explicit costings", () => {
    expect(costingForMode("car")).toBe("auto");
    expect(costingForMode("bike")).toBe("bicycle");
    expect(costingForMode("walk")).toBe("pedestrian");
    expect(costingForMode("car", "taxi")).toBe("taxi");
    expect(costingForMode("car", "trekking")).toBe("auto");
  });
});

describe("buildValhallaBody", () => {
  it("uses kilometres and adds avoid factors", () => {
    const body = buildValhallaBody(
      carRequest({
        alternatives: 3,
        options: {
          avoidHighways: true,
          useTolls: 0.25,
          avoidFerries: true,
          servicePenalty: 120,
        },
      }),
      "auto",
    );
    expect(body.directions_options).toEqual({
      units: "kilometers",
      language: "en",
    });
    expect(body.alternates).toBe(2);
    expect(body.costing_options?.auto).toEqual({
      use_highways: 0,
      use_tolls: 0.25,
      use_ferry: 0,
      service_penalty: 120,
    });
  });

  it("omits costing_options when no preferences are set", () => {
    const body = buildValhallaBody(carRequest(), "auto");
    expect(body.costing_options).toBeUndefined();
    expect(body.alternates).toBeUndefined();
  });
});

describe("planValhalla", () => {
  it("posts a car route and parses summary, shape, and maneuvers", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse({ trip: TRIP }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const plans = await planValhalla(carRequest());
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan.provider).toBe("valhalla");
    expect(plan.mode).toBe("car");
    expect(plan.profile).toBe("auto");
    expect(plan.distanceKm).toBeCloseTo(0.112, 5);
    expect(plan.durationMin).toBeCloseTo(13.064 / 60, 5);
    expect(plan.hasToll).toBe(false);
    expect(plan.hasHighway).toBe(false);
    expect(plan.hasFerry).toBe(false);
    expect(plan.coordinates).toHaveLength(4);
    expect(plan.coordinates[0][0]).toBeCloseTo(8.680005, 6);
    expect(plan.coordinates[0][1]).toBeCloseTo(49.409873, 6);

    expect(plan.maneuvers).toHaveLength(2);
    expect(plan.maneuvers[0].type).toBe("depart");
    expect(plan.maneuvers[0].rawType).toBe(1);
    expect(plan.maneuvers[0].streetName).toBe("Iqbal-Ufer");
    expect(plan.maneuvers[0].distanceM).toBeCloseTo(112, 5);
    expect(plan.maneuvers[0].startIndex).toBe(0);
    expect(plan.maneuvers[0].endIndex).toBe(3);
    expect(plan.maneuvers[0].verbal).toMatch(/Iqbal-Ufer/);
    expect(plan.maneuvers[1].type).toBe("arrive");
    expect(plan.maneuvers[1].rawType).toBe(6);

    const call = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const body = JSON.parse(
      String(call[1]?.body),
    ) as Record<string, unknown>;
    expect(body.costing).toBe("auto");
    expect(body.locations).toEqual([
      { lat: 49.4099, lon: 8.68 },
      { lat: 49.4105, lon: 8.6815 },
    ]);
  });

  it("returns alternates after the primary trip", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse({ trip: TRIP, alternates: [{ trip: TRIP }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const plans = await planValhalla(carRequest({ alternatives: 2 }));
    expect(plans).toHaveLength(2);
    expect(plans[0].id).not.toBe(plans[1].id);
  });

  it("maps a 400 response to no-route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error_code: 171, error: "No suitable edges" }),
            { status: 400 },
          ),
      ),
    );
    const err = await captureError(planValhalla(carRequest()));
    expect(err.kind).toBe("no-route");
    expect(err.status).toBe(400);
  });

  it("rejects with bad-response for too few waypoints", async () => {
    const err = await captureError(
      planValhalla(carRequest({ waypoints: [{ lat: 1, lon: 2 }] })),
    );
    expect(err.kind).toBe("bad-response");
  });
});
