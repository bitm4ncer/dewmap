import { afterEach, describe, expect, it, vi } from "vitest";
import {
  alertStopCandidates,
  fetchLiveVehicles,
  filterLiveVehicles,
  liveModeGroup,
  mergeVehiclePositions,
  normalizeLiveVehicles,
  type LiveVehicleQuery,
} from "./liveVehicles";

function encodeValue(value: number): string {
  let v = value < 0 ? -value * 2 - 1 : value * 2;
  let out = "";
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v = Math.floor(v / 32);
  }
  return out + String.fromCharCode(v + 63);
}

/** Test-only encoder: precision-5 polyline from `[lat, lon]` pairs. */
function encodePolyline(points: [number, number][], precision = 5): string {
  const factor = 10 ** precision;
  let lastLat = 0;
  let lastLon = 0;
  return points
    .map(([lat, lon]) => {
      const nextLat = Math.round(lat * factor);
      const nextLon = Math.round(lon * factor);
      const encoded =
        encodeValue(nextLat - lastLat) + encodeValue(nextLon - lastLon);
      lastLat = nextLat;
      lastLon = nextLon;
      return encoded;
    })
    .join("");
}

const SEGMENT = {
  trips: [{ tripId: "trip-1", displayName: "S1" }],
  mode: "SUBURBAN",
  distance: 14_000,
  from: {
    name: "Heidelberg Hbf",
    lat: 49,
    lon: 8,
    tz: "Europe/Berlin",
  },
  to: {
    name: "Mannheim Hbf",
    lat: 49.1,
    lon: 8.1,
    tz: "Europe/Berlin",
  },
  departure: "2026-11-18T10:06:00Z",
  arrival: "2026-11-18T10:16:00Z",
  scheduledDeparture: "2026-11-18T10:00:00Z",
  scheduledArrival: "2026-11-18T10:10:00Z",
  realTime: true,
  polyline: encodePolyline([
    [49, 8],
    [49.1, 8.1],
  ]),
  routeColor: "00aa00",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeLiveVehicles", () => {
  it("interpolates a position from real-time departure and arrival", () => {
    const vehicles = normalizeLiveVehicles(
      [SEGMENT],
      Date.parse("2026-11-18T10:11:00Z"),
    );
    expect(vehicles).toHaveLength(1);
    const vehicle = vehicles[0];
    expect(vehicle.tripId).toBe("trip-1");
    expect(vehicle.line).toBe("S1");
    expect(vehicle.modeLabel).toBe("S-Bahn");
    expect(vehicle.color).toBe("#00aa00");
    expect(vehicle.lat).toBeCloseTo(49.05, 3);
    expect(vehicle.lon).toBeCloseTo(8.05, 3);
    expect(vehicle.delayMin).toBe(6);
    expect(vehicle.realTime).toBe(true);
    expect(vehicle.fromTz).toBe("Europe/Berlin");
    expect(vehicle.bearing).toBeGreaterThanOrEqual(0);
    expect(vehicle.bearing).toBeLessThan(360);
  });

  it("drops vehicles outside their active segment window", () => {
    expect(
      normalizeLiveVehicles([SEGMENT], Date.parse("2026-11-18T10:30:00Z")),
    ).toEqual([]);
  });

  it("deduplicates segments from the same trip", () => {
    const later = {
      ...SEGMENT,
      departure: "2026-11-18T10:16:00Z",
      arrival: "2026-11-18T10:26:00Z",
      scheduledDeparture: "2026-11-18T10:10:00Z",
      scheduledArrival: "2026-11-18T10:20:00Z",
    };
    const vehicles = normalizeLiveVehicles(
      [SEGMENT, later],
      Date.parse("2026-11-18T10:17:00Z"),
    );
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].departure).toBe("2026-11-18T10:16:00Z");
  });

  it("ignores malformed segments", () => {
    expect(
      normalizeLiveVehicles(
        [null, {}, { ...SEGMENT, polyline: "" }],
        Date.parse("2026-11-18T10:11:00Z"),
      ),
    ).toEqual([]);
  });
});

describe("fetchLiveVehicles", () => {
  it("requests the current map window and normalizes the response", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([SEGMENT]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const query: LiveVehicleQuery = {
      south: 48.9,
      west: 7.9,
      north: 49.2,
      east: 8.2,
      zoom: 12,
      now: new Date("2026-11-18T10:11:00Z"),
    };
    const vehicles = await fetchLiveVehicles(query);
    expect(vehicles).toHaveLength(1);

    const call = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit?,
    ];
    const url = new URL(String(call[0]));
    expect(url.pathname).toBe("/api/v6/map/trips");
    expect(url.searchParams.get("min")).toBe("48.9,7.9");
    expect(url.searchParams.get("max")).toBe("49.2,8.2");
    expect(url.searchParams.get("zoom")).toBe("12");
    expect(url.searchParams.get("precision")).toBe("5");
    expect(url.searchParams.get("startTime")).toBe(
      "2026-11-18T10:09:00.000Z",
    );
    expect(url.searchParams.get("endTime")).toBe(
      "2026-11-18T10:21:00.000Z",
    );
  });
});

describe("live vehicle model", () => {
  const now = Date.parse("2026-11-18T10:11:00Z");

  it("records the source, phase, mode group and stop ids", () => {
    const [vehicle] = normalizeLiveVehicles(
      [
        {
          ...SEGMENT,
          from: { ...SEGMENT.from, stopId: "child-1", parentId: "parent-1" },
        },
      ],
      now,
    );
    expect(vehicle.source).toBe("interpolated");
    expect(vehicle.phase).toBe("moving");
    expect(vehicle.modeGroup).toBe("RAIL");
    expect(vehicle.stops.from.id).toBe("parent-1");
    expect(vehicle.stops.from.name).toBe("Heidelberg Hbf");
    expect(vehicle.stops.to.id).toBeUndefined();
  });

  it("dwells at the origin inside the grace window before departure", () => {
    const [vehicle] = normalizeLiveVehicles(
      [SEGMENT],
      Date.parse("2026-11-18T10:05:00Z"),
    );
    expect(vehicle.phase).toBe("dwell");
    expect(vehicle.lat).toBeCloseTo(49, 5);
    expect(vehicle.lon).toBeCloseTo(8, 5);
  });

  it("dwells at the destination after arrival", () => {
    const [vehicle] = normalizeLiveVehicles(
      [SEGMENT],
      Date.parse("2026-11-18T10:17:00Z"),
    );
    expect(vehicle.phase).toBe("dwell");
    expect(vehicle.lat).toBeCloseTo(49.1, 5);
  });
});

describe("live mode helpers", () => {
  it("groups provider modes into filter buckets", () => {
    expect(liveModeGroup("HIGHSPEED_RAIL")).toBe("RAIL");
    expect(liveModeGroup("NIGHT_RAIL")).toBe("RAIL");
    expect(liveModeGroup("COACH")).toBe("BUS");
    expect(liveModeGroup("LIGHT_RAIL")).toBe("TRAM");
    expect(liveModeGroup("METRO")).toBe("SUBWAY");
    expect(liveModeGroup("FERRY")).toBe("FERRY");
    expect(liveModeGroup(undefined)).toBe("OTHER");
  });

  it("filters by group and keeps everything when no group is selected", () => {
    const [rail] = normalizeLiveVehicles(
      [SEGMENT],
      Date.parse("2026-11-18T10:11:00Z"),
    );
    const [ferry] = normalizeLiveVehicles(
      [{ ...SEGMENT, mode: "FERRY", trips: [{ tripId: "ferry-1", displayName: "62" }] }],
      Date.parse("2026-11-18T10:11:00Z"),
    );
    expect(filterLiveVehicles([rail, ferry], [])).toHaveLength(2);
    expect(filterLiveVehicles([rail, ferry], ["FERRY"])).toEqual([ferry]);
  });

  it("prefers a GPS position for the same trip", () => {
    const [interpolated] = normalizeLiveVehicles(
      [SEGMENT],
      Date.parse("2026-11-18T10:11:00Z"),
    );
    const gps = {
      ...interpolated,
      source: "gps" as const,
      lat: 49.06,
      lon: 8.06,
    };
    const extra = { ...interpolated, id: "other", tripId: "trip-2" };
    const merged = mergeVehiclePositions([interpolated, extra], [gps]);
    expect(merged).toHaveLength(2);
    expect(merged.find((vehicle) => vehicle.tripId === "trip-1")?.source).toBe("gps");
    expect(merged.find((vehicle) => vehicle.tripId === "trip-1")?.lat).toBe(49.06);
    expect(merged.find((vehicle) => vehicle.tripId === "trip-2")?.source).toBe(
      "interpolated",
    );
  });
});

describe("alert stop candidates", () => {
  const bounds = { south: 50, west: 8, north: 50.2, east: 8.8 };

  function vehicleWithStops(
    base: ReturnType<typeof normalizeLiveVehicles>[number],
    id: string,
    group: "RAIL" | "BUS",
    from: { id: string; name: string; lat: number; lon: number },
    to: { id: string; name: string; lat: number; lon: number },
  ) {
    return {
      ...base,
      id,
      tripId: id,
      modeGroup: group,
      stops: { from, to },
    };
  }

  it("keeps only stops inside the view and prefers rail", () => {
    const [base] = normalizeLiveVehicles(
      [SEGMENT],
      Date.parse("2026-11-18T10:11:00Z"),
    );
    const rail = vehicleWithStops(
      base,
      "rail",
      "RAIL",
      { id: "hbf", name: "Hbf", lat: 50.1, lon: 8.6 },
      { id: "far", name: "Far", lat: 49, lon: 9 },
    );
    const bus = vehicleWithStops(
      base,
      "bus",
      "BUS",
      { id: "busstop", name: "Busstop", lat: 50.11, lon: 8.61 },
      { id: "busstop2", name: "Busstop 2", lat: 50.12, lon: 8.62 },
    );
    const candidates = alertStopCandidates([bus, rail], bounds, 3);
    expect(candidates.map((entry) => entry.stopId)).toEqual([
      "hbf",
      "busstop",
      "busstop2",
    ]);
    expect(candidates.some((entry) => entry.stopId === "far")).toBe(false);
  });

  it("caps the candidates and deduplicates parent stops", () => {
    const [base] = normalizeLiveVehicles(
      [SEGMENT],
      Date.parse("2026-11-18T10:11:00Z"),
    );
    const one = vehicleWithStops(
      base,
      "one",
      "RAIL",
      { id: "hbf", name: "Hbf", lat: 50.1, lon: 8.6 },
      { id: "hbf", name: "Hbf", lat: 50.1, lon: 8.6 },
    );
    const two = vehicleWithStops(
      base,
      "two",
      "RAIL",
      { id: "sued", name: "Süd", lat: 50.09, lon: 8.62 },
      { id: "west", name: "West", lat: 50.1, lon: 8.63 },
    );
    const candidates = alertStopCandidates([one, two], bounds, 2);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].stopId).toBe("hbf");
  });
});
