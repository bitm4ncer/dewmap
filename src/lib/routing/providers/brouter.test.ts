import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveBrouterManeuvers, planBrouter } from "./brouter";
import { ProviderError, type Maneuver, type RouteRequest } from "../types";

const TURN_COORDINATES: [number, number][] = [
  [0, 0],
  [0, 0.009],
  [0.0127, 0.009],
];

const BEAR_COORDINATES: [number, number][] = [
  [0, 0],
  [0, 0.009],
  [0.0045, 0.0168],
];

const GEOJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: TURN_COORDINATES },
      properties: {
        "track-length": "2413",
        "total-time": "600",
        "filtered ascend": "12",
        "filtered descend": "4",
        "plain-ascend": "14",
      },
    },
  ],
};

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    mode: "bike",
    profile: "trekking",
    waypoints: [
      { lat: 0, lon: 0 },
      { lat: 0.009, lon: 0.0127 },
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

function instructionOf(maneuvers: Maneuver[], type: Maneuver["type"]): string {
  return maneuvers.find((maneuver) => maneuver.type === type)?.instruction ?? "";
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("deriveBrouterManeuvers", () => {
  it("emits depart / turn / arrive for a 90 degree turn", () => {
    const maneuvers = deriveBrouterManeuvers(TURN_COORDINATES, 600);
    expect(maneuvers.map((m) => m.type)).toEqual([
      "depart",
      "turn",
      "arrive",
    ]);

    expect(maneuvers[0].instruction).toMatch(/^Head /);
    expect(maneuvers[0].startIndex).toBe(0);
    expect(maneuvers[0].endIndex).toBe(1);
    expect(maneuvers[0].distanceM).toBeCloseTo(1001, -1);

    const turn = maneuvers[1];
    expect(turn.instruction).toBe("Turn right");
    expect(turn.modifier).toBe("right");
    expect(turn.startIndex).toBe(1);
    expect(turn.endIndex).toBe(2);
    expect(turn.distanceM).toBeGreaterThan(1_000);

    expect(maneuvers[2].distanceM).toBe(0);
    expect(maneuvers[2].startIndex).toBe(2);
    expect(maneuvers[2].endIndex).toBe(2);
  });

  it("uses 'Bear right' for a 30 degree bend", () => {
    const maneuvers = deriveBrouterManeuvers(BEAR_COORDINATES, 600);
    expect(instructionOf(maneuvers, "turn")).toBe("Bear right");
    expect(maneuvers.find((m) => m.type === "turn")?.modifier).toBe(
      "slight-right",
    );
  });

  it("emits 'Turn left' for a left turn", () => {
    const maneuvers = deriveBrouterManeuvers(
      [
        [0, 0],
        [0, 0.009],
        [-0.0127, 0.009],
      ],
      600,
    );
    expect(instructionOf(maneuvers, "turn")).toBe("Turn left");
  });

  it("produces only depart / arrive for a straight line", () => {
    const maneuvers = deriveBrouterManeuvers(
      [
        [0, 0],
        [0, 0.002],
      ],
      120,
    );
    expect(maneuvers.map((m) => m.type)).toEqual(["depart", "arrive"]);
  });

  it("inserts continue hints on long instruction-free stretches", () => {
    const longLine: [number, number][] = Array.from(
      { length: 31 },
      (_, index) => [0, index * 0.01],
    );
    const maneuvers = deriveBrouterManeuvers(longLine, 3_600);
    expect(maneuvers.filter((m) => m.type === "continue").length).toBeGreaterThan(
      0,
    );
    expect(maneuvers[maneuvers.length - 1].type).toBe("arrive");
  });

  it("handles empty and single-point geometries", () => {
    expect(deriveBrouterManeuvers([])).toEqual([]);
    expect(deriveBrouterManeuvers([[8, 49]]).map((m) => m.type)).toEqual([
      "depart",
      "arrive",
    ]);
  });
});

describe("planBrouter", () => {
  it("parses GeoJSON and derived maneuvers", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse(GEOJSON),
    );
    vi.stubGlobal("fetch", fetchMock);

    const plans = await planBrouter(request({ alternatives: 1 }));
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan.provider).toBe("brouter");
    expect(plan.mode).toBe("bike");
    expect(plan.profile).toBe("trekking");
    expect(plan.distanceKm).toBeCloseTo(2.413, 5);
    expect(plan.durationMin).toBeCloseTo(10, 5);
    expect(plan.ascentM).toBe(12);
    expect(plan.descentM).toBe(4);
    expect(plan.coordinates).toHaveLength(3);
    expect(plan.maneuvers.map((m) => m.type)).toEqual([
      "depart",
      "turn",
      "arrive",
    ]);
    expect(instructionOf(plan.maneuvers, "turn")).toBe("Turn right");

    const url = new URL(
      String(
        (fetchMock.mock.calls[0] as unknown as [RequestInfo | URL])[0],
      ),
    );
    expect(url.origin + url.pathname).toBe("https://brouter.de/brouter");
    expect(url.searchParams.get("lonlats")).toBe(
      "0.000000,0.000000|0.012700,0.009000",
    );
    expect(url.searchParams.get("profile")).toBe("trekking");
    expect(url.searchParams.get("alternativeidx")).toBe("0");
    expect(url.searchParams.get("format")).toBe("geojson");
  });

  it("streams each alternative through onPlan", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          okResponse(GEOJSON),
      ),
    );

    const streamed: string[] = [];
    const plans = await planBrouter(request({ alternatives: 2 }), {
      onPlan: (plan) => streamed.push(plan.id),
    });

    expect(plans).toHaveLength(2);
    expect(streamed).toHaveLength(2);
    expect(new Set(plans.map((plan) => plan.id)).size).toBe(2);
  });

  it("uses the mode default profile when none is supplied", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse(GEOJSON),
    );
    vi.stubGlobal("fetch", fetchMock);

    await planBrouter(request({ mode: "walk", profile: undefined }));
    const call = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const url = new URL(String(call[0]));
    expect(url.searchParams.get("profile")).toBe("hiking-beta");
  });

  it("maps 5xx errors to network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 503 })),
    );
    const err = await captureError(
      planBrouter(request({ alternatives: 1 })),
    );
    expect(err.kind).toBe("network");
    expect(err.provider).toBe("brouter");
  });

  it("maps an empty feature collection to no-route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          okResponse({ type: "FeatureCollection", features: [] }),
      ),
    );
    const err = await captureError(
      planBrouter(request({ alternatives: 1 })),
    );
    expect(err.kind).toBe("no-route");
  });
});
