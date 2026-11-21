import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  alertPlainText,
  clearAlertCache,
  fetchAreaAlerts,
  mergeAlerts,
  normalizeMotisAlert,
} from "./alerts";

const ALERT = {
  communicationPeriod: [
    { start: "2026-11-21T03:00:00Z", end: "2026-11-22T03:00:00Z" },
  ],
  impactPeriod: [{ start: "2026-11-21T04:00:00Z", end: "2026-11-22T04:00:00Z" }],
  cause: "CONSTRUCTION",
  effect: "DETOUR",
  severityLevel: "WARNING",
  headerText: "Frankfurt: Bus 75 - Haltestelle entfällt",
  descriptionText:
    '<b>Haltestelle:</b><br><ul><li>"West" &amp; Ost</li></ul>',
  url: "https://example.org/alert",
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  clearAlertCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("alertPlainText", () => {
  it("flattens provider HTML into readable plain text", () => {
    expect(alertPlainText(ALERT.descriptionText)).toBe(
      'Haltestelle:\n- "West" & Ost',
    );
  });

  it("decodes numeric entities and keeps paragraph breaks", () => {
    expect(alertPlainText("<p>Zeile&nbsp;1</p><p>Zeile&#32;2</p>")).toBe(
      "Zeile 1\nZeile 2",
    );
  });

  it("returns an empty string for missing input", () => {
    expect(alertPlainText(undefined)).toBe("");
  });
});

describe("normalizeMotisAlert", () => {
  it("normalizes severity, period, text and context", () => {
    const alert = normalizeMotisAlert(ALERT, {
      source: "route",
      lines: ["75"],
      stops: [{ name: "West", lat: 50.1, lon: 8.6 }],
    });
    expect(alert).not.toBeNull();
    expect(alert?.header).toBe("Frankfurt: Bus 75 - Haltestelle entfällt");
    expect(alert?.description).toBe('Haltestelle:\n- "West" & Ost');
    expect(alert?.severity).toBe("WARNING");
    expect(alert?.cause).toBe("CONSTRUCTION");
    expect(alert?.effect).toBe("DETOUR");
    expect(alert?.startsAt).toBe("2026-11-21T04:00:00Z");
    expect(alert?.endsAt).toBe("2026-11-22T04:00:00Z");
    expect(alert?.lines).toEqual(["75"]);
    expect(alert?.stops).toHaveLength(1);
    expect(alert?.source).toBe("route");
    expect(alert?.url).toBe("https://example.org/alert");
  });

  it("falls back to an unknown severity instead of guessing", () => {
    const alert = normalizeMotisAlert(
      { headerText: "Bauarbeiten", severityLevel: "CRITICAL" },
      { source: "area" },
    );
    expect(alert?.severity).toBe("UNKNOWN_SEVERITY");
    expect(alert?.lines).toEqual([]);
    expect(alert?.stops).toEqual([]);
  });

  it("ignores alerts without any text", () => {
    expect(normalizeMotisAlert({}, { source: "area" })).toBeNull();
    expect(normalizeMotisAlert(null, { source: "area" })).toBeNull();
  });

  it("produces a stable id for the same header and period", () => {
    const first = normalizeMotisAlert(ALERT, { source: "route" });
    const second = normalizeMotisAlert(ALERT, { source: "area" });
    expect(first?.id).toBe(second?.id);
  });
});

describe("mergeAlerts", () => {
  it("dedupes and keeps every line and stop", () => {
    const one = normalizeMotisAlert(ALERT, {
      source: "area",
      stops: [{ name: "West", lat: 50.1, lon: 8.6 }],
    })!;
    const two = normalizeMotisAlert(ALERT, {
      source: "area",
      lines: [],
      stops: [{ name: "Ost", lat: 50.2, lon: 8.7 }],
    })!;
    const merged = mergeAlerts([one, two]);
    expect(merged).toHaveLength(1);
    expect(merged[0].stops.map((stop) => stop.name)).toEqual(["West", "Ost"]);
  });

  it("upgrades an unknown severity when another source knows it", () => {
    const unknown = normalizeMotisAlert(
      { headerText: "Same", severityLevel: "UNKNOWN_SEVERITY" },
      { source: "area" },
    )!;
    const severe = normalizeMotisAlert(
      { headerText: "Same", severityLevel: "SEVERE" },
      { source: "route" },
    )!;
    expect(mergeAlerts([unknown, severe])[0].severity).toBe("SEVERE");
  });
});

describe("fetchAreaAlerts", () => {
  const stops = [
    { stopId: "rail-1", name: "Hbf", lat: 50.1, lon: 8.6, priority: 9 },
    { stopId: "bus-1", name: "Busplatz", lat: 50.11, lon: 8.61, priority: 1 },
    { stopId: "rail-2", name: "Süd", lat: 50.09, lon: 8.62, priority: 7 },
  ];

  it("queries the highest-priority stops and attaches them to alerts", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        stopTimes: [{ place: { name: "Hbf", alerts: [ALERT] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const alerts = await fetchAreaAlerts({ stops, maxStops: 2, now: 1_000 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(first.pathname).toBe("/api/v6/stoptimes");
    expect(first.searchParams.get("stopId")).toBe("rail-1");
    expect(first.searchParams.get("withAlerts")).toBe("true");
    expect(first.searchParams.get("n")).toBe("10");
    expect(first.searchParams.get("window")).toBe("3600");

    expect(alerts).toHaveLength(1);
    expect(alerts[0].source).toBe("area");
    expect(alerts[0].stops.map((stop) => stop.name)).toContain("Hbf");
  });

  it("reuses the cache for the same stop", async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({ stopTimes: [{ place: { alerts: [ALERT] } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchAreaAlerts({ stops: [stops[0]], now: 1_000 });
    await fetchAreaAlerts({ stops: [stops[0]], now: 2_000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores a single failing stop when another succeeds", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("bus-1")) throw new Error("offline");
      return okResponse({ stopTimes: [{ place: { alerts: [ALERT] } }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const alerts = await fetchAreaAlerts({ stops, maxStops: 3, now: 1_000 });
    expect(alerts).toHaveLength(1);
  });

  it("reports a total failure instead of pretending there are no alerts", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchAreaAlerts({ stops: [stops[0]], now: 1_000 }),
    ).rejects.toThrow(/offline/);
  });

  it("returns early without stops", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAreaAlerts({ stops: [] })).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
