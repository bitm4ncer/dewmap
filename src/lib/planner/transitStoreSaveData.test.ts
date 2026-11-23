import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const ORIGINAL_NAVIGATOR = globalThis.navigator;

function setSaveData(saveData: boolean | undefined) {
  vi.stubGlobal(
    "navigator",
    saveData === undefined ? {} : { connection: { saveData } },
  );
}

async function loadStore() {
  vi.resetModules();
  return import("./transitStore");
}

beforeEach(() => {
  memory.clear();
});

afterAll(() => {
  vi.stubGlobal("navigator", ORIGINAL_NAVIGATOR);
});

describe("transitStore and Save-Data", () => {
  it("starts with live vehicles off when Save-Data is on", async () => {
    setSaveData(true);
    const store = await loadStore();
    const state = store.useTransit.getState();
    expect(state.liveVehicles).toBe(false);
    expect(state.liveDataSaver).toBe(true);
    expect(state.liveVehiclesOptOut).toBe(false);
    // The manual switch is not blocked; it is an informed choice.
    state.setLiveVehicles(true);
    expect(store.useTransit.getState().liveVehicles).toBe(true);
  });

  it("keeps live vehicles on for a normal connection", async () => {
    setSaveData(false);
    const store = await loadStore();
    expect(store.useTransit.getState().liveVehicles).toBe(true);
    expect(store.useTransit.getState().liveDataSaver).toBe(false);
  });

  it("keeps Save-Data off across a persisted non-opt-out state", async () => {
    setSaveData(true);
    const store = await loadStore();
    memory.set(
      "dewmap:transit",
      JSON.stringify({ state: { liveVehiclesOptOut: false }, version: 3 }),
    );
    await store.useTransit.persist.rehydrate();
    expect(store.useTransit.getState().liveVehicles).toBe(false);
    expect(store.useTransit.getState().liveDataSaver).toBe(true);
  });

  it("rehydrates the default on without Save-Data", async () => {
    setSaveData(false);
    const store = await loadStore();
    memory.set(
      "dewmap:transit",
      JSON.stringify({ state: { liveVehiclesOptOut: false }, version: 3 }),
    );
    await store.useTransit.persist.rehydrate();
    expect(store.useTransit.getState().liveVehicles).toBe(true);
  });

  it("still respects a persisted opt-out without Save-Data", async () => {
    setSaveData(false);
    const store = await loadStore();
    memory.set(
      "dewmap:transit",
      JSON.stringify({ state: { liveVehiclesOptOut: true }, version: 3 }),
    );
    await store.useTransit.persist.rehydrate();
    expect(store.useTransit.getState().liveVehicles).toBe(false);
  });
});
