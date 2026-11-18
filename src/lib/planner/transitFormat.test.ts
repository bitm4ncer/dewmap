import { describe, expect, it } from "vitest";
import { ProviderError, type RoutePlan, type TransitLeg } from "../routing";
import {
  bestJourneyId,
  buildIcs,
  buildShareUrl,
  describeTransitError,
  filterJourneys,
  isLiveJourney,
  journeyDelayMinutes,
  journeyTimeZone,
  legDelayMinutes,
  legDirection,
  legDurationMin,
  lineColor,
  lineTextColor,
  modeLabel,
  parseShareParams,
  sortJourneys,
  stopClock,
  stopDayOffset,
  transferWarnings,
  walkTotals,
} from "./transitFormat";

function leg(overrides: Partial<TransitLeg> = {}): TransitLeg {
  return {
    mode: "transit",
    rawMode: "REGIONAL_RAIL",
    from: {
      name: "Heidelberg Hbf",
      lat: 49.403,
      lon: 8.675,
      city: "Heidelberg",
      platform: "2",
      tz: "Europe/Berlin",
    },
    to: {
      name: "Mannheim Hbf",
      lat: 49.479,
      lon: 8.469,
      city: "Mannheim",
      platform: "3",
      tz: "Europe/Berlin",
    },
    departure: "2026-11-18T09:10:00+01:00",
    arrival: "2026-11-18T09:25:00+01:00",
    scheduledDeparture: "2026-11-18T09:10:00+01:00",
    scheduledArrival: "2026-11-18T09:25:00+01:00",
    realTime: true,
    cancelled: false,
    line: "RE 10a",
    agency: "DB Regio",
    headsign: "Mannheim Hbf",
    coordinates: [
      [8.675, 49.403],
      [8.469, 49.479],
    ],
    ...overrides,
  };
}

function plan(overrides: Partial<RoutePlan> = {}, legs = [leg()]): RoutePlan {
  const transit = {
    departure: legs[0]?.departure ?? "2026-11-18T09:10:00+01:00",
    arrival: legs[legs.length - 1]?.arrival ?? "2026-11-18T09:25:00+01:00",
    durationMin: 15,
    transfers: Math.max(0, legs.filter((l) => l.mode === "transit").length - 1),
    timeZone: "Europe/Berlin",
    legs,
  };
  return {
    id: overrides.id ?? "j1",
    mode: "transit",
    provider: "motis",
    distanceKm: 20,
    durationMin: transit.durationMin,
    coordinates: [
      [8.675, 49.403],
      [8.469, 49.479],
    ],
    maneuvers: [],
    transit,
    ...overrides,
  };
}

describe("delay helpers", () => {
  it("reads departure and arrival delays separately", () => {
    const late = leg({
      departure: "2026-11-18T09:14:00+01:00",
      arrival: "2026-11-18T09:31:00+01:00",
    });
    expect(legDelayMinutes(late)).toBe(4);
    expect(legDelayMinutes(late, "arrival")).toBe(6);
    expect(journeyDelayMinutes(plan({}, [late]))).toBe(6);
  });

  it("ignores walks and invalid timestamps", () => {
    const walk = leg({ mode: "walk", departure: "", arrival: "" });
    expect(legDelayMinutes(walk)).toBe(0);
    expect(journeyDelayMinutes(plan({}, [walk]))).toBe(0);
  });
});

describe("live and walk totals", () => {
  it("does not call a walk-only journey live", () => {
    const walk = leg({ mode: "walk", realTime: true });
    expect(isLiveJourney(plan({}, [walk]))).toBe(false);
    expect(isLiveJourney(plan({}, [leg()]))).toBe(true);
  });

  it("sums walking distance and time", () => {
    const walk = leg({
      mode: "walk",
      distanceKm: 0.9,
      departure: "2026-11-18T09:10:00+01:00",
      arrival: "2026-11-18T09:22:00+01:00",
    });
    const totals = walkTotals(plan({}, [walk, leg()]));
    expect(totals.distanceKm).toBeCloseTo(0.9);
    expect(totals.minutes).toBe(12);
  });
});

describe("labels and colours", () => {
  it("dedupes a headsign that is just the alighting stop", () => {
    expect(legDirection(leg())).toBe("Mannheim Hbf");
    expect(legDirection(leg({ headsign: "Berlin Hbf" }))).toContain("Berlin Hbf");
  });

  it("prefers provider colours and picks readable text", () => {
    expect(
      lineColor(leg({ line: "X9", agency: "Unknown", rawMode: "BUS", routeColor: "ff0000" })),
    ).toBe("#ff0000");
    expect(
      lineTextColor(leg({ line: "X9", agency: "Unknown", rawMode: "BUS", routeColor: "#ffffff" })),
    ).toBe("#10120b");
    expect(
      lineTextColor(leg({ line: "X9", agency: "Unknown", rawMode: "BUS", routeColor: "#000000" })),
    ).toBe("#ffffff");
  });

  it("codes rail and tram types so transfers read at a glance", () => {
    expect(lineColor(leg({ line: "S3", agency: "S-Bahn RheinNeckar" }))).toBe("#1E8A4C");
    expect(lineColor(leg({ line: "ICE 576", agency: "DB Fernverkehr" }))).toBe("#F2F5F7");
    expect(lineColor(leg({ line: "RE 10a", agency: "DB Regio" }))).toBe("#C7362F");
    expect(lineColor(leg({ line: "26", rawMode: "TRAM", agency: "RNV" }))).toBe("#E8C547");
    expect(lineColor(leg({ line: "FlixTrain 20", agency: "FlixTrain" }))).toBe("#A6F53C");
    expect(lineColor(leg({ line: "FlixBus 091", agency: "FlixBus" }))).toBe("#A6F53C");
    expect(lineTextColor(leg({ line: "S3" }))).toBe("#ffffff");
    expect(lineTextColor(leg({ line: "ICE 576" }))).toBe("#10120b");
    expect(lineTextColor(leg({ line: "RE 10a" }))).toBe("#ffffff");
    expect(lineTextColor(leg({ line: "26", rawMode: "TRAM" }))).toBe("#10120b");
  });

  it("renders each stop in its own zone", () => {
    const berlin = { name: "Berlin", lat: 52.5, lon: 13.4, tz: "Europe/Berlin" };
    const london = { name: "London", lat: 51.5, lon: -0.1, tz: "Europe/London" };
    expect(stopClock("2026-11-18T10:00:00Z", berlin)).toBe("11:00");
    expect(stopClock("2026-11-18T10:00:00Z", london)).toBe("10:00");
    expect(
      stopDayOffset(
        "2026-11-18T23:30:00Z",
        "2026-11-18T22:00:00Z",
        berlin,
      ),
    ).toBe("+1");
  });

  it("labels on-demand and rail modes", () => {
    expect(modeLabel(leg({ rawMode: "ODM" }))).toBe("On demand");
    expect(modeLabel(leg())).toBe("Train");
    expect(modeLabel(leg({ mode: "walk" }))).toBe("Walk");
  });

  it("derives walk duration from distance when times are missing", () => {
    const walk = leg({ mode: "walk", departure: "", arrival: "", distanceKm: 1.35 });
    expect(legDurationMin(walk)).toBeCloseTo(16.666, 2);
  });
});

describe("ranking and filtering", () => {
  it("picks the earliest arrival and breaks ties by duration", () => {
    const slow = plan({ id: "slow", durationMin: 40 }, [
      leg({ arrival: "2026-11-18T09:25:00+01:00" }),
    ]);
    const fast = plan({ id: "fast", durationMin: 20 }, [
      leg({ arrival: "2026-11-18T09:20:00+01:00" }),
    ]);
    expect(bestJourneyId([slow, fast])).toBe("fast");
    expect(sortJourneys([slow, fast], "duration")[0].id).toBe("fast");
  });

  it("filters by city, mode, walk time and accessibility", () => {
    const walk = leg({
      mode: "walk",
      distanceKm: 0.8,
      departure: "2026-11-18T09:00:00+01:00",
      arrival: "2026-11-18T09:10:00+01:00",
    });
    const accessible = leg({ wheelchairAccessible: "YES", bikesAllowed: true });
    const journey = plan({}, [walk, accessible]);
    expect(filterJourneys([journey], { city: "mannheim" })).toHaveLength(1);
    expect(filterJourneys([journey], { city: "berlin" })).toHaveLength(0);
    expect(filterJourneys([journey], { modes: ["RAIL"] })).toHaveLength(1);
    expect(filterJourneys([journey], { modes: ["BUS"] })).toHaveLength(0);
    expect(filterJourneys([journey], { maxWalkMin: 5 })).toHaveLength(0);
    expect(filterJourneys([journey], { accessible: true, bike: true })).toHaveLength(1);
    expect(
      filterJourneys([plan({}, [leg({ wheelchairAccessible: "NOT_ACCESSIBLE" })])], {
        accessible: true,
      }),
    ).toHaveLength(0);
  });

  it("computes zone from the first transit stop", () => {
    expect(journeyTimeZone(plan())).toBe("Europe/Berlin");
  });
});

describe("transfers", () => {
  it("flags tight and platform-changing transfers", () => {
    const first = leg({
      arrival: "2026-11-18T09:20:00+01:00",
      to: { name: "Mannheim Hbf", lat: 49.479, lon: 8.469, platform: "2" },
    });
    const second = leg({
      from: { name: "Mannheim Hbf", lat: 49.479, lon: 8.469, platform: "5" },
      departure: "2026-11-18T09:23:00+01:00",
      arrival: "2026-11-18T09:40:00+01:00",
    });
    const [warning] = transferWarnings([first, second]);
    expect(warning.minutes).toBe(3);
    expect(warning.tight).toBe(true);
    expect(warning.platformChange).toBe(true);
    expect(warning.at).toBe("Mannheim Hbf");
  });

  it("does not warn across a single transit leg", () => {
    expect(transferWarnings([leg()])).toEqual([]);
  });
});

describe("errors", () => {
  it("turns rate limits into a retry message", () => {
    expect(
      describeTransitError(
        new ProviderError("rate-limit", "HTTP 429", { retryAfterS: 120 }),
      ),
    ).toBe("Too many transit requests. Try again in 2 min.");
  });

  it("does not leak raw HTTP bodies", () => {
    expect(
      describeTransitError(new ProviderError("bad-response", "HTTP 500: secret")),
    ).toBe("The transit service returned an unexpected response.");
    expect(describeTransitError(new Error("boom"))).toBe("boom");
  });
});

describe("share links", () => {
  it("round-trips both places and settings", () => {
    const url = buildShareUrl("https://example.test/?x=1", {
      from: {
        name: "Heidelberg Hbf",
        lat: 49.403,
        lon: 8.675,
        id: "stop-1",
        city: "Heidelberg",
        kind: "stop",
      },
      to: { name: "Mannheim Hbf", lat: 49.479, lon: 8.469, kind: "address" },
      via: [
        {
          name: "Weinheim Hbf",
          lat: 49.55,
          lon: 8.66,
          id: "stop-via",
          kind: "stop",
        },
      ],
      when: "2026-11-18T09:00",
      arriveBy: true,
      maxTransfers: 2,
      wheelchair: true,
    });
    const parsed = parseShareParams(new URL(url).search);
    expect(parsed?.from?.name).toBe("Heidelberg Hbf");
    expect(parsed?.from?.id).toBe("stop-1");
    expect(parsed?.to?.kind).toBe("address");
    expect(parsed?.via).toHaveLength(1);
    expect(parsed?.via[0]?.name).toBe("Weinheim Hbf");
    expect(parsed?.via[0]?.id).toBe("stop-via");
    expect(parsed?.when).toBe("2026-11-18T09:00");
    expect(parsed?.arriveBy).toBe(true);
    expect(parsed?.maxTransfers).toBe(2);
    expect(parsed?.wheelchair).toBe(true);
    expect(new URL(url).searchParams.get("x")).toBe("1");
  });

  it("rejects malformed coordinates", () => {
    expect(parseShareParams("trFrom=abc")).toBeNull();
  });

  it("drops stale transit parameters from the base URL", () => {
    const url = buildShareUrl(
      "https://example.test/?trVia0=1,2&trFromName=Old&keep=1",
      { from: null, to: null, via: [] },
    );
    const params = new URL(url).searchParams;
    expect(params.get("trVia0")).toBeNull();
    expect(params.get("trFromName")).toBeNull();
    expect(params.get("keep")).toBe("1");
  });
});

describe("calendar export", () => {
  it("writes a UTC VEVENT with escaped text and folded lines", () => {
    const ics = buildIcs(plan());
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("DTSTART:20261118T081000Z");
    expect(ics).toContain("DTEND:20261118T082500Z");
    expect(ics).toContain("SUMMARY:Heidelberg Hbf → Mannheim Hbf");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics.split("\r\n").every((line) => line.length <= 75)).toBe(true);
  });

  it("returns an empty string without transit data", () => {
    expect(buildIcs(plan({ transit: undefined }))).toBe("");
  });
});
