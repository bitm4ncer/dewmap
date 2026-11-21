import { afterEach, describe, expect, it, vi } from "vitest";

type FakeStorage = {
  readonly length: number;
  key: (index: number) => string | null;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function makeStorage(initial: Record<string, string>): FakeStorage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}

let storage: FakeStorage;

async function migrate() {
  vi.resetModules();
  vi.stubGlobal("window", { localStorage: storage });
  const legacy = await import("./legacyStorage");
  legacy.migrateLegacyStorage();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("migrateLegacyStorage", () => {
  it("copies KugelMaps keys to dewmap without deleting the source", async () => {
    storage = makeStorage({ "kugelmaps:settings": '{"a":1}' });
    await migrate();
    expect(storage.getItem("dewmap:settings")).toBe('{"a":1}');
    expect(storage.getItem("kugelmaps:settings")).toBe('{"a":1}');
  });

  it("prefers the newer KugelMaps value over BiosphereOne", async () => {
    storage = makeStorage({
      "biosphere1:settings": "old",
      "kugelmaps:settings": "new",
    });
    await migrate();
    expect(storage.getItem("dewmap:settings")).toBe("new");
  });

  it("copies BiosphereOne keys when no KugelMaps value exists", async () => {
    storage = makeStorage({ "biosphere1:settings": "old" });
    await migrate();
    expect(storage.getItem("dewmap:settings")).toBe("old");
  });

  it("never overwrites an existing dewmap value", async () => {
    storage = makeStorage({
      "kugelmaps:settings": "old",
      "dewmap:settings": "current",
    });
    await migrate();
    expect(storage.getItem("dewmap:settings")).toBe("current");
  });

  it("copies per-place POI caches and saved places", async () => {
    storage = makeStorage({
      "kugelmaps.poi.v2.N123": "poi",
      "kugelmaps.poi-view.v2": "view",
      "kugelmaps.saved-places": "places",
    });
    await migrate();
    expect(storage.getItem("dewmap.poi.v2.N123")).toBe("poi");
    expect(storage.getItem("dewmap.poi-view.v2")).toBe("view");
    expect(storage.getItem("dewmap.saved-places")).toBe("places");
  });
});
