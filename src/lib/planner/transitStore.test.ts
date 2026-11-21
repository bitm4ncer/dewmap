import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutePlan } from "../routing";

const memory = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
});

type StoreModule = typeof import("./transitStore");
let store: StoreModule;

beforeAll(async () => {
  store = await import("./transitStore");
});

function plan(id: string): RoutePlan {
  return {
    id,
    mode: "transit",
    provider: "motis",
    distanceKm: 10,
    durationMin: 20,
    coordinates: [
      [8.6, 49.4],
      [8.7, 49.5],
    ],
    maneuvers: [],
    transit: {
      departure: "2026-11-18T10:00:00+01:00",
      arrival: "2026-11-18T10:20:00+01:00",
      durationMin: 20,
      transfers: 0,
      legs: [],
    },
  };
}

beforeEach(() => {
  store.useTransit.setState({
    ...store.useTransit.getState(),
    from: null,
    to: null,
    when: "",
    journeys: [],
    selectedId: null,
    notice: null,
    stale: false,
    nextCursor: null,
    previousCursor: null,
    favorites: [],
    recents: [],
    via: [],
    liveVehicles: true,
    liveVehiclesOptOut: false,
    liveVehicleGroups: [],
    liveVehicleCount: 0,
    liveVehiclesUpdatedAt: null,
    liveVehiclesError: null,
    liveVehiclesZoomLow: false,
    liveVehicleData: [],
    liveAlerts: [],
    liveAlertsUpdatedAt: null,
    liveAlertsError: null,
    liveAlertLines: [],
  });
});

describe("transitStore", () => {
  it("marks existing results stale when the query changes", () => {
    const state = store.useTransit.getState();
    state.setFrom({ name: "A", lat: 49.4, lon: 8.6 });
    state.setTo({ name: "B", lat: 49.5, lon: 8.7 });
    state.setJourneys([plan("j1")], {
      nextPageCursor: "next",
      previousPageCursor: "prev",
    });
    expect(store.useTransit.getState().journeys).toHaveLength(1);
    expect(store.useTransit.getState().nextCursor).toBe("next");

    state.setWhen("2026-11-18T11:00");
    const after = store.useTransit.getState();
    expect(after.stale).toBe(true);
    expect(after.nextCursor).toBeNull();
    expect(after.previousCursor).toBeNull();
  });

  it("clears results when the origin changes", () => {
    const state = store.useTransit.getState();
    state.setFrom({ name: "A", lat: 49.4, lon: 8.6 });
    state.setTo({ name: "B", lat: 49.5, lon: 8.7 });
    state.setJourneys([plan("j1")]);
    state.setFrom({ name: "C", lat: 49.41, lon: 8.61 });
    const after = store.useTransit.getState();
    expect(after.journeys).toEqual([]);
    expect(after.stale).toBe(false);
    expect(after.phase.kind).toBe("idle");
  });

  it("dedupes favorites and recents", () => {
    const state = store.useTransit.getState();
    const place = { name: "Home", lat: 49.4, lon: 8.6 };
    state.toggleFavorite(place);
    state.toggleFavorite(place);
    expect(store.useTransit.getState().favorites).toHaveLength(0);

    state.rememberPlace(place);
    state.rememberPlace(place);
    expect(store.useTransit.getState().recents).toHaveLength(1);
    state.toggleFavorite(place);
    expect(store.useTransit.getState().favorites).toHaveLength(1);
  });

  it("keeps a selected journey when a refresh still contains it", () => {
    const state = store.useTransit.getState();
    state.setJourneys([plan("j1"), plan("j2")]);
    store.useTransit.getState().selectJourney("j2");
    store.useTransit.getState().setJourneys([plan("j2"), plan("j3")]);
    expect(store.useTransit.getState().selectedId).toBe("j2");
  });

  it("auto-selects the best journey when a search returns results", () => {
    const later = plan("later");
    later.transit!.arrival = "2026-11-18T10:40:00+01:00";
    const earlier = plan("earlier");
    earlier.transit!.arrival = "2026-11-18T10:20:00+01:00";

    store.useTransit.getState().setJourneys([later, earlier]);

    expect(store.useTransit.getState().selectedId).toBe("earlier");
  });

  it("adds up to two via stops and clears previous results", () => {
    const state = store.useTransit.getState();
    state.setFrom({ name: "A", lat: 49.4, lon: 8.6 });
    state.setTo({ name: "B", lat: 49.5, lon: 8.7 });
    state.setJourneys([plan("j1")]);

    const viaA = { name: "Via A", lat: 49.45, lon: 8.65, id: "via-a" };
    const viaB = { name: "Via B", lat: 49.46, lon: 8.66, id: "via-b" };
    const viaC = { name: "Via C", lat: 49.47, lon: 8.67, id: "via-c" };
    store.useTransit.getState().addVia(viaA);
    store.useTransit.getState().addVia(viaB);
    store.useTransit.getState().addVia(viaC);

    expect(store.useTransit.getState().via).toEqual([viaA, viaB]);
    expect(store.useTransit.getState().journeys).toEqual([]);

    store.useTransit.getState().removeVia(0);
    expect(store.useTransit.getState().via).toEqual([viaB]);
  });

  it("toggles live vehicles independently of the search", () => {
    store.useTransit.getState().setLiveVehicles(true);
    expect(store.useTransit.getState().liveVehicles).toBe(true);
    expect(store.useTransit.getState().liveVehiclesOptOut).toBe(false);
    store.useTransit.getState().setLiveVehicleStatus(7, 1234);
    expect(store.useTransit.getState().liveVehicleCount).toBe(7);
    expect(store.useTransit.getState().liveVehiclesUpdatedAt).toBe(1234);
    store.useTransit.getState().setLiveVehiclesError("offline");
    expect(store.useTransit.getState().liveVehiclesError).toBe("offline");
  });

  it("records an explicit opt-out so a reload keeps vehicles off", () => {
    store.useTransit.getState().setLiveVehicles(false);
    expect(store.useTransit.getState().liveVehicles).toBe(false);
    expect(store.useTransit.getState().liveVehiclesOptOut).toBe(true);
    store.useTransit.getState().setLiveVehicles(true);
    expect(store.useTransit.getState().liveVehiclesOptOut).toBe(false);
  });

  it("keeps only known live mode groups", () => {
    store.useTransit.getState().setLiveVehicleGroups([
      "FERRY",
      "RAIL",
      "FERRY",
      "PLANE",
    ]);
    expect(store.useTransit.getState().liveVehicleGroups).toEqual([
      "FERRY",
      "RAIL",
    ]);
  });

  it("stores the latest vehicle data separately from the total count", () => {
    const vehicle = {
      id: "trip-1:2026-11-18T10:00:00Z",
      tripId: "trip-1",
      line: "S1",
      mode: "SUBURBAN",
      modeLabel: "S-Bahn",
      modeGroup: "RAIL" as const,
      color: "#7bd6a4",
      textColor: "#0e0f0c",
      lat: 49,
      lon: 8,
      bearing: 90,
      delayMin: 0,
      realTime: true,
      source: "interpolated" as const,
      phase: "moving" as const,
      stops: {
        from: { name: "A", lat: 49, lon: 8 },
        to: { name: "B", lat: 49.1, lon: 8.1 },
      },
      fromName: "A",
      toName: "B",
      departure: "2026-11-18T10:00:00Z",
      arrival: "2026-11-18T10:10:00Z",
      distanceM: 1000,
    };
    store.useTransit.getState().setLiveVehiclesData([vehicle]);
    expect(store.useTransit.getState().liveVehicleData).toHaveLength(1);
    // The count comes from setLiveVehicleStatus (total feed), not the capped
    // array, so "n of N" stays honest.
    expect(store.useTransit.getState().liveVehicleCount).toBe(0);
    store.useTransit.getState().setLiveVehicleStatus(1500, 999);
    expect(store.useTransit.getState().liveVehicleCount).toBe(1500);
  });

  it("stores area alerts and highlighted lines", () => {
    const alert = {
      id: "a1",
      header: "Bauarbeiten",
      severity: "WARNING" as const,
      lines: [],
      stops: [{ name: "Hbf", lat: 49, lon: 8 }],
      source: "area" as const,
    };
    store.useTransit.getState().setLiveAlerts([alert], 999);
    expect(store.useTransit.getState().liveAlerts).toEqual([alert]);
    expect(store.useTransit.getState().liveAlertsUpdatedAt).toBe(999);
    store.useTransit.getState().setLiveAlertLines(["S1", "S1", ""]);
    expect(store.useTransit.getState().liveAlertLines).toEqual(["S1"]);
  });

  it("migrates a stored v2 false to the new default on", async () => {
    memory.set(
      "dewmap:transit",
      JSON.stringify({ state: { liveVehicles: false }, version: 2 }),
    );
    await store.useTransit.persist.rehydrate();
    expect(store.useTransit.getState().liveVehicles).toBe(true);
    expect(store.useTransit.getState().liveVehiclesOptOut).toBe(false);
  });

  it("keeps an explicit opt-out after rehydration", async () => {
    memory.set(
      "dewmap:transit",
      JSON.stringify({ state: { liveVehiclesOptOut: true }, version: 3 }),
    );
    await store.useTransit.persist.rehydrate();
    expect(store.useTransit.getState().liveVehicles).toBe(false);
    expect(store.useTransit.getState().liveVehiclesOptOut).toBe(true);
  });

  it("drops unknown persisted groups during rehydration", async () => {
    memory.set(
      "dewmap:transit",
      JSON.stringify({
        state: { liveVehicleGroups: ["FERRY", "PLANE"] },
        version: 3,
      }),
    );
    await store.useTransit.persist.rehydrate();
    expect(store.useTransit.getState().liveVehicleGroups).toEqual(["FERRY"]);
  });

  it("starts a new local time at the current minute", () => {
    const input = store.nowLocalInput(new Date(2026, 10, 18, 10, 7, 42));
    expect(input).toBe("2026-11-18T10:07");
  });
});
