import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLiveVehicles,
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
