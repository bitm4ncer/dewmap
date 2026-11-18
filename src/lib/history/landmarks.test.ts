import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLandmarkVisibleAtYear, tilesForBounds } from "./landmarks";
import type { LandmarkCollection, LandmarkProperties } from "./landmarks";

const BOUNDS = { west: 6.75, south: 51.21, east: 6.81, north: 51.25 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wikidataPayload() {
  return {
    results: {
      bindings: [
        {
          item: {
            type: "uri",
            value: "http://www.wikidata.org/entity/Q4711",
          },
          itemLabel: { type: "literal", "xml:lang": "en", value: "Test Castle" },
          coord: { type: "literal", value: "Point(6.78 51.23)" },
          inception: {
            type: "literal",
            value: "1900-01-01T00:00:00Z",
          },
          kind: {
            type: "uri",
            value: "http://www.wikidata.org/entity/Q23413",
          },
          kindLabel: { type: "literal", "xml:lang": "en", value: "castle" },
        },
      ],
    },
  };
}

function overpassPayload() {
  return {
    elements: [
      {
        type: "node",
        id: 123,
        lat: 51.22,
        lon: 6.77,
        tags: {
          name: "Old Tower",
          historic: "tower",
          start_date: "1850",
          wikimedia_commons: "File:Old Tower.jpg",
        },
      },
      {
        type: "node",
        id: 124,
        lat: 51.24,
        lon: 6.79,
        tags: {
          name: "Commons Page",
          historic: "memorial",
          image: "https://commons.wikimedia.org/wiki/File:Page_Image.jpg",
        },
      },
    ],
  };
}

/** A fetch that never resolves until its signal aborts (a stalled server). */
function hangingFetch(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener(
      "abort",
      () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      },
      { once: true },
    );
  });
}

function isOverpass(url: string): boolean {
  return url.includes("overpass");
}

function isWikidata(url: string): boolean {
  return url.includes("wikidata.org/sparql");
}

async function loadModule() {
  vi.resetModules();
  return await import("./landmarks");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isLandmarkVisibleAtYear", () => {
  const base = (overrides: Partial<LandmarkProperties>): LandmarkProperties => ({
    id: "x",
    name: "X",
    kind: "site",
    source: "osm",
    ...overrides,
  });

  it("hides undated sites before 2000 and shows them after", () => {
    const props = base({});
    expect(isLandmarkVisibleAtYear(props, 1999)).toBe(false);
    expect(isLandmarkVisibleAtYear(props, 2000)).toBe(true);
  });

  it("respects inception and dissolution years", () => {
    const props = base({ inception: 1900, dissolved: 1950 });
    expect(isLandmarkVisibleAtYear(props, 1899)).toBe(false);
    expect(isLandmarkVisibleAtYear(props, 1900)).toBe(true);
    expect(isLandmarkVisibleAtYear(props, 1950)).toBe(true);
    expect(isLandmarkVisibleAtYear(props, 1951)).toBe(false);
  });

  it("treats an extant dated site as visible from its inception on", () => {
    const props = base({ inception: 1850 });
    expect(isLandmarkVisibleAtYear(props, 1849)).toBe(false);
    expect(isLandmarkVisibleAtYear(props, 2026)).toBe(true);
  });
});

describe("tilesForBounds", () => {
  it("wraps tiles across the antimeridian", () => {
    const tiles = tilesForBounds(
      { west: 170, south: -10, east: 190, north: 10 },
      9,
    );
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.x >= 0 && t.x < 512)).toBe(true);
    expect(tiles.some((t) => t.x === 511)).toBe(true);
    expect(tiles.some((t) => t.x === 0)).toBe(true);
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(tiles.length);
  });

  it("does not duplicate tiles for a world-spanning bbox", () => {
    const tiles = tilesForBounds(
      { west: -180, south: -85, east: 180, north: 85 },
      9,
    );
    expect(new Set(tiles.map((t) => `${t.x}/${t.y}`)).size).toBe(tiles.length);
    expect(tiles.every((t) => t.x >= 0 && t.x < 512)).toBe(true);
    expect(tiles.every((t) => t.y >= 0 && t.y < 512)).toBe(true);
  });
});

describe("fetchLandmarksForBounds", () => {
  it("publishes Wikidata results before a stalled Overpass request finishes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (isWikidata(url)) {
          return Promise.resolve(jsonResponse(wikidataPayload()));
        }
        if (isOverpass(url)) return hangingFetch(init);
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }),
    );

    const { fetchLandmarksForBounds } = await loadModule();
    const partials: LandmarkCollection[] = [];
    const pending = fetchLandmarksForBounds(BOUNDS, undefined, (collection) => {
      partials.push(collection);
    });

    // The Wikidata response settles immediately; Overpass stays stalled.
    await vi.advanceTimersByTimeAsync(0);
    expect(partials.length).toBeGreaterThan(0);
    expect(partials.at(-1)?.features.map((f) => f.properties.id)).toContain(
      "wd/Q4711",
    );

    // Let the Overpass attempt timeout elapse so the promise can finish.
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    const ids = result.features.map((f) => f.properties.id);
    expect(ids).toContain("wd/Q4711");
    expect(partials.at(-1)?.features.length).toBe(result.features.length);
  });

  it("falls back to the next Overpass endpoint when the first one stalls", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        seen.push(url);
        if (isWikidata(url)) {
          return Promise.resolve(jsonResponse(wikidataPayload()));
        }
        if (url.includes("overpass-api.de")) return hangingFetch(init);
        if (isOverpass(url)) {
          return Promise.resolve(jsonResponse(overpassPayload()));
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }),
    );

    const { fetchLandmarksForBounds } = await loadModule();
    const pending = fetchLandmarksForBounds(BOUNDS);
    await vi.advanceTimersByTimeAsync(15_000);
    const result = await pending;

    expect(seen.some((u) => u.includes("overpass-api.de"))).toBe(true);
    expect(seen.some((u) => u.includes("kumi.systems"))).toBe(true);
    const ids = result.features.map((f) => f.properties.id);
    expect(ids).toContain("osm/node/123");
  });

  it("does not cache an empty tile when every source failed", async () => {
    const failing = vi.fn(async () =>
      jsonResponse({ error: "nope" }, 503),
    );
    vi.stubGlobal("fetch", failing);

    const { fetchLandmarksForBounds } = await loadModule();
    const first = await fetchLandmarksForBounds(BOUNDS);
    expect(first.features).toHaveLength(0);
    expect(failing).toHaveBeenCalled();

    const succeeding = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (isWikidata(url)) {
        return Promise.resolve(jsonResponse(wikidataPayload()));
      }
      return Promise.resolve(jsonResponse(overpassPayload()));
    });
    vi.stubGlobal("fetch", succeeding);

    const second = await fetchLandmarksForBounds(BOUNDS);
    expect(second.features.length).toBeGreaterThan(0);
  });

  it("serves a successfully loaded tile from cache", async () => {
    const working = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (isWikidata(url)) {
        return Promise.resolve(jsonResponse(wikidataPayload()));
      }
      return Promise.resolve(jsonResponse(overpassPayload()));
    });
    vi.stubGlobal("fetch", working);

    const { fetchLandmarksForBounds } = await loadModule();
    const first = await fetchLandmarksForBounds(BOUNDS);
    expect(first.features.length).toBeGreaterThan(0);

    const broken = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", broken);
    const second = await fetchLandmarksForBounds(BOUNDS);
    expect(second.features.length).toBe(first.features.length);
    expect(broken).not.toHaveBeenCalled();
  });

  it("does not reuse an aborted in-flight tile for the next request", async () => {
    let mode: "hang" | "work" = "hang";
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (mode === "hang") return hangingFetch(init);
        if (isWikidata(url)) {
          return Promise.resolve(jsonResponse(wikidataPayload()));
        }
        return Promise.resolve(jsonResponse(overpassPayload()));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchLandmarksForBounds } = await loadModule();
    const controller = new AbortController();
    const first = fetchLandmarksForBounds(BOUNDS, controller.signal).catch(
      (err: unknown) => err,
    );
    controller.abort();

    mode = "work";
    const second = await fetchLandmarksForBounds(BOUNDS);

    expect(second.features.length).toBeGreaterThan(0);
    await expect(first).resolves.toMatchObject({ name: "AbortError" });
  });

  it("exposes a Wikimedia Commons image from OSM tags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (isWikidata(url)) {
          return Promise.resolve(jsonResponse(wikidataPayload()));
        }
        return Promise.resolve(jsonResponse(overpassPayload()));
      }),
    );

    const { fetchLandmarksForBounds } = await loadModule();
    const result = await fetchLandmarksForBounds(BOUNDS);
    const wikidata = result.features.find(
      (f) => f.properties.source === "wikidata",
    );
    const osm = result.features.find((f) => f.properties.source === "osm");

    expect(wikidata?.properties.imageUrl).toBeUndefined();
    expect(osm?.properties.imageUrl).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Old%20Tower.jpg?width=320",
    );
    expect(wikidata?.properties.kind).toBe("castle");
    expect(osm?.properties.kind).toBe("tower");
    const page = result.features.find((f) => f.properties.id === "osm/node/124");
    expect(page?.properties.imageUrl).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Page_Image.jpg?width=320",
    );
  });
});
