import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearStopCache,
  decodeLegGeometry,
  geocodeStops,
  normalizeMotisItinerary,
  planMotis,
} from "./motis";
import { ProviderError, type RouteRequest } from "../types";

// Encoded at precision 7, matching MOTIS today.
const WALK1 = "_anlm\\_gzpdDnwH_af@nh\\_ry@";
const TRAM = "__gkm\\_|{sdD_t`B_af@_etBojcA";
const WALK2 = "_z}qm\\oigwdDowHnh\\owH_pR";

const ITINERARY = {
  id: "itinerary-1",
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
        name: "Heidelberg, Campus Bergheim",
        lat: 49.408,
        lon: 8.685,
        arrival: "2026-11-17T10:03:00Z",
        scheduledArrival: "2026-11-17T10:03:00Z",
        stopId: "stop-1",
        track: "1",
        tz: "Europe/Berlin",
        modes: ["TRAM"],
      },
      duration: 180,
      startTime: "2026-11-17T10:00:00Z",
      endTime: "2026-11-17T10:03:00Z",
      scheduledStartTime: "2026-11-17T10:00:00Z",
      scheduledEndTime: "2026-11-17T10:03:00Z",
      realTime: true,
      cancelled: false,
      distance: 300,
      legGeometry: { points: WALK1, length: 5 },
      steps: [],
    },
    {
      mode: "TRAM",
      from: {
        name: "Heidelberg, Campus Bergheim",
        lat: 49.408,
        lon: 8.685,
        departure: "2026-11-17T10:04:00Z",
        scheduledDeparture: "2026-11-17T10:04:00Z",
        stopId: "stop-1",
        track: "2",
        scheduledTrack: "1",
        tz: "Europe/Berlin",
        modes: ["TRAM"],
      },
      to: {
        name: "Neuenheim, Kußmaulstraße",
        lat: 49.419,
        lon: 8.6905,
        arrival: "2026-11-17T10:07:00Z",
        scheduledArrival: "2026-11-17T10:07:00Z",
        stopId: "stop-2",
        track: "3",
        tz: "Europe/Berlin",
      },
      duration: 180,
      startTime: "2026-11-17T10:04:00Z",
      endTime: "2026-11-17T10:07:00Z",
      scheduledStartTime: "2026-11-17T10:04:00Z",
      scheduledEndTime: "2026-11-17T10:07:00Z",
      realTime: true,
      cancelled: true,
      legGeometry: { points: TRAM, length: 5 },
      routeShortName: "RNV 26",
      routeLongName: "RNV 26 Handschuhsheim",
      displayName: "RNV 26 Handschuhsheim",
      agencyName: "RNV Heidelberg (Strab)",
      agencyUrl: "https://example.test/rnv",
      headsign: "Handschuh., Heiligenbergschule",
      routeType: "TRAM",
      routeColor: "00aa00",
      routeTextColor: "ffffff",
      tripShortName: "26",
      wheelchairAccessible: "YES",
      bikesAllowed: true,
      reservation: "REQUIRED",
      intermediateStops: [
        {
          name: "Bunsengymnasium",
          lat: 49.4105,
          lon: 8.686,
          stopId: "stop-3",
        },
      ],
    },
    {
      mode: "WALK",
      from: {
        name: "Neuenheim, Kußmaulstraße",
        lat: 49.419,
        lon: 8.6905,
        departure: "2026-11-17T10:07:00Z",
        scheduledDeparture: "2026-11-17T10:07:00Z",
        stopId: "stop-2",
      },
      to: {
        name: "END",
        lat: 49.42,
        lon: 8.69,
        arrival: "2026-11-17T10:10:00Z",
        scheduledArrival: "2026-11-17T10:10:00Z",
      },
      duration: 240,
      startTime: "2026-11-17T10:07:00Z",
      endTime: "2026-11-17T10:10:00Z",
      scheduledStartTime: "2026-11-17T10:07:00Z",
      scheduledEndTime: "2026-11-17T10:10:00Z",
      realTime: false,
      cancelled: false,
      distance: 120,
      legGeometry: { points: WALK2, length: 5 },
      steps: [],
    },
  ],
};

function transitRequest(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return {
    mode: "transit",
    waypoints: [
      { lat: 49.41, lon: 8.68 },
      { lat: 49.42, lon: 8.69 },
    ],
    departAt: "2026-11-17T10:00:00Z",
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

describe("decodeLegGeometry", () => {
  const from = { lat: 49.41, lon: 8.68 };
  const to = { lat: 49.408, lon: 8.685 };

  it("picks precision 7 when the endpoints match", () => {
    const coordinates = decodeLegGeometry({ points: WALK1 }, from, to);
    expect(coordinates).toHaveLength(3);
    expect(coordinates[0][0]).toBeCloseTo(8.68, 4);
    expect(coordinates[0][1]).toBeCloseTo(49.41, 4);
    expect(coordinates[2][0]).toBeCloseTo(8.685, 4);
    expect(coordinates[2][1]).toBeCloseTo(49.408, 4);
  });

  it("ignores a wrong advertised precision and falls back to 7", () => {
    const coordinates = decodeLegGeometry(
      { points: WALK1, precision: 6 },
      from,
      to,
    );
    expect(coordinates[0][1]).toBeCloseTo(49.41, 4);
    expect(coordinates[0][1]).toBeLessThan(50);
  });

  it("returns an empty list for missing geometry", () => {
    expect(decodeLegGeometry(null, from, to)).toEqual([]);
    expect(decodeLegGeometry({}, from, to)).toEqual([]);
  });
});

describe("normalizeMotisItinerary", () => {
  it("normalizes the journey and every leg", () => {
    const plan = normalizeMotisItinerary(ITINERARY);
    expect(plan.provider).toBe("motis");
    expect(plan.mode).toBe("transit");
    expect(plan.id).toBe("motis:itinerary-1");
    expect(plan.durationMin).toBe(10);
    expect(plan.transit?.departure).toBe("2026-11-17T10:00:00Z");
    expect(plan.transit?.arrival).toBe("2026-11-17T10:10:00Z");
    expect(plan.transit?.transfers).toBe(0);
    expect(plan.transit?.timeZone).toBe("Europe/Berlin");
    expect(plan.transit?.legs).toHaveLength(3);
    expect(plan.maneuvers).toHaveLength(4);

    const [walk, tram] = plan.transit?.legs ?? [];
    expect(walk.mode).toBe("walk");
    expect(walk.rawMode).toBe("WALK");
    expect(walk.distanceKm).toBeCloseTo(0.3, 5);
    expect(walk.realTime).toBe(true);

    expect(tram.mode).toBe("transit");
    expect(tram.rawMode).toBe("TRAM");
    expect(tram.line).toBe("RNV 26");
    expect(tram.agency).toBe("RNV Heidelberg (Strab)");
    expect(tram.headsign).toBe("Handschuh., Heiligenbergschule");
    expect(tram.from.platform).toBe("2");
    expect(tram.from.scheduledPlatform).toBe("1");
    expect(tram.to.platform).toBe("3");
    expect(tram.from.stopId).toBe("stop-1");
    expect(tram.to.stopId).toBe("stop-2");
    expect(tram.from.tz).toBe("Europe/Berlin");
    expect(tram.from.modes).toEqual(["TRAM"]);
    expect(tram.routeType).toBe("TRAM");
    expect(tram.routeColor).toBe("#00aa00");
    expect(tram.routeTextColor).toBe("#ffffff");
    expect(tram.tripShortName).toBe("26");
    expect(tram.wheelchairAccessible).toBe("YES");
    expect(tram.bikesAllowed).toBe(true);
    expect(tram.reservation).toBe(true);
    expect(tram.agencyUrl).toBe("https://example.test/rnv");
    expect(tram.realTime).toBe(true);
    expect(tram.cancelled).toBe(true);
    expect(tram.distanceKm).toBeGreaterThan(1.2);
    expect(tram.distanceKm).toBeLessThan(1.4);
    expect(tram.coordinates).toHaveLength(3);
    expect(tram.coordinates[0][0]).toBeCloseTo(8.685, 4);
    expect(tram.coordinates[0][1]).toBeCloseTo(49.408, 4);
    expect(tram.coordinates[2][0]).toBeCloseTo(8.6905, 4);
    expect(tram.intermediateStops?.[0]?.name).toBe("Bunsengymnasium");

    const transitManeuver = plan.maneuvers.find((m) => m.type === "transit");
    expect(transitManeuver?.instruction).toMatch(/RNV 26/);
    expect(plan.maneuvers[plan.maneuvers.length - 1].type).toBe("arrive");
    expect(plan.transit?.legs[0].from.name).toBe("Start");
    expect(plan.transit?.legs[2].to.name).toBe("Destination");
  });

  it("treats on-demand service as transit, not walking", () => {
    const plan = normalizeMotisItinerary({
      id: "odm-1",
      legs: [
        {
          mode: "ODM",
          from: { name: "A", lat: 49, lon: 8, tz: "Europe/Berlin" },
          to: { name: "B", lat: 49.01, lon: 8.01, tz: "Europe/Berlin" },
          startTime: "2026-11-17T10:00:00Z",
          endTime: "2026-11-17T10:10:00Z",
          routeShortName: "AST 12",
        },
      ],
    });
    expect(plan.transit?.legs[0].mode).toBe("transit");
    expect(plan.transit?.legs[0].rawMode).toBe("ODM");
  });

  it("rejects itineraries without legs", () => {
    expect(() => normalizeMotisItinerary({ legs: [] })).toThrow(ProviderError);
  });
});

describe("planMotis", () => {
  it("sends normalized params and returns itineraries", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse({
          itineraries: [ITINERARY],
          nextPageCursor: "next-1",
          previousPageCursor: "prev-1",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const plans = await planMotis(
      transitRequest({
        alternatives: 2,
        maxTransfers: 2,
        wheelchair: true,
        fromPlace: "de-DELFI_stop-1",
        toPlace: "de-DELFI_stop-2",
        options: {
          searchWindowS: 1800,
          pageCursor: "page-1",
          transitModes: ["RAIL", "BUS"],
          maxPreTransitTimeS: 600,
          maxPostTransitTimeS: 900,
          requireWheelchairAccessible: true,
          requireBikesAllowed: true,
        },
      }),
    );

    expect(plans).toHaveLength(1);
    expect(plans[0].provider).toBe("motis");
    expect(plans[0].meta).toEqual({
      nextPageCursor: "next-1",
      previousPageCursor: "prev-1",
    });

    const call = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const url = new URL(String(call[0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api.transitous.org/api/v1/plan",
    );
    expect(url.searchParams.get("fromPlace")).toBe("de-DELFI_stop-1");
    expect(url.searchParams.get("toPlace")).toBe("de-DELFI_stop-2");
    expect(url.searchParams.get("time")).toBe("2026-11-17T10:00:00.000Z");
    expect(url.searchParams.get("arriveBy")).toBe("false");
    expect(url.searchParams.get("numItineraries")).toBe("2");
    expect(url.searchParams.get("maxTransfers")).toBe("2");
    expect(url.searchParams.get("wheelchair")).toBe("true");
    expect(url.searchParams.get("detailedTransfers")).toBe("false");
    expect(url.searchParams.get("searchWindow")).toBe("1800");
    expect(url.searchParams.get("pageCursor")).toBe("page-1");
    expect(url.searchParams.get("transitModes")).toBe("RAIL,BUS");
    expect(url.searchParams.get("maxPreTransitTime")).toBe("600");
    expect(url.searchParams.get("maxPostTransitTime")).toBe("900");
    expect(url.searchParams.get("requireWheelchairAccessible")).toBe("true");
    expect(url.searchParams.get("requireBikesAllowed")).toBe("true");
  });

  it("sends ordered via stops and a minimum stay", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse({
          itineraries: [ITINERARY],
          nextPageCursor: "next-1",
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await planMotis(
      transitRequest({
        via: ["de-DELFI_de:08226:4109", "de-DELFI_de:08221:1160"],
        options: { viaMinimumStay: [1, 2] },
      }),
    );

    const call = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const url = new URL(String(call[0]));
    expect(url.searchParams.get("via")).toBe(
      "de-DELFI_de:08226:4109,de-DELFI_de:08221:1160",
    );
    expect(url.searchParams.get("viaMinimumStay")).toBe("1,2");
  });

  it("limits via stops to two and defaults to a one-minute stay", async () => {
    const fetchMock = vi.fn(
      async () => okResponse({ itineraries: [ITINERARY] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await planMotis(
      transitRequest({
        via: ["a", "b", "c"],
        options: {},
      }),
    );

    const call = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const url = new URL(String(call[0]));
    expect(url.searchParams.get("via")).toBe("a,b");
    expect(url.searchParams.get("viaMinimumStay")).toBe("1,1");
  });

  it("maps an empty result to no-route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          okResponse({ itineraries: [], direct: [] }),
      ),
    );
    const err = await captureError(planMotis(transitRequest()));
    expect(err.kind).toBe("no-route");
  });

  it("rejects with bad-response for too few waypoints", async () => {
    const err = await captureError(
      planMotis(transitRequest({ waypoints: [{ lat: 1, lon: 2 }] })),
    );
    expect(err.kind).toBe("bad-response");
  });
});

describe("geocodeStops", () => {
  it("maps stops and filters non-stop results", async () => {
    const fetchMock = vi.fn(
      async () =>
        okResponse([
          {
            type: "STOP",
            id: "de-DELFI_de:08221:1160",
            name: "Heidelberg, Hauptbahnhof",
            lat: 49.40357,
            lon: 8.675442,
            country: "DE",
            modes: ["TRAM", "BUS", "REGIONAL_RAIL"],
            areas: [{ name: "Deutschland" }, { name: "Heidelberg" }],
          },
          {
            type: "PLACE",
            id: "way/1",
            name: "Some hotel",
            lat: 49.4,
            lon: 8.6,
          },
        ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const stops = await geocodeStops("Heidelberg Hbf");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({
      type: "STOP",
      id: "de-DELFI_de:08221:1160",
      name: "Heidelberg, Hauptbahnhof",
      country: "DE",
      modes: ["TRAM", "BUS", "REGIONAL_RAIL"],
      areas: ["Deutschland", "Heidelberg"],
    });

    const call = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const url = new URL(String(call[0]));
    expect(url.pathname).toBe("/api/v1/geocode");
    expect(url.searchParams.get("text")).toBe("Heidelberg Hbf");
    expect(url.searchParams.get("type")).toBe("STOP");
  });

  it("caches repeated stop searches for five minutes", async () => {
    clearStopCache();
    const fetchMock = vi.fn(async () =>
      okResponse([
        {
          type: "STOP",
          id: "cache-stop",
          name: "Cache City, Hbf",
          lat: 49.4,
          lon: 8.6,
        },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = await geocodeStops("Cache City Hbf");
    const second = await geocodeStops("Cache City Hbf");
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    clearStopCache();
  });

  it("does not call fetch for very short queries", async () => {
    const fetchMock = vi.fn(async () => okResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(geocodeStops("H")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
