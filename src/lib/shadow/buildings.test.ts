import { describe, expect, it, vi } from "vitest";
import Pbf from "pbf";
import {
  buildingTilesForBbox,
  decodeBuildingTile,
  isAbortError,
  loadBuildingsForBbox,
  ShadowDataError,
  tilePointToLngLat,
  withTimeout,
  type BuildingTileSource,
} from "./buildings";
import type { TileCoord } from "./tiles";
import type { Bbox } from "./types";

/**
 * Minimal MVT writer, only for the tests.
 *
 * The app only ever reads MVT; encoding the fixture here keeps the loader
 * tested against the real binary format instead of a mock that could drift.
 */
interface TestFeature {
  id?: string;
  height?: number;
  /** lon/lat ring, closed or open. */
  ring: [number, number][];
}

function lonLatToPoint(tile: TileCoord, lon: number, lat: number, extent: number) {
  const n = 2 ** tile.z;
  const x = ((lon + 180) / 360) * n - tile.x;
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n - tile.y;
  return {
    x: Math.round(x * extent),
    y: Math.round(y * extent),
  };
}

function zigzag(value: number): number {
  return (value << 1) ^ (value >> 31);
}

function encodePolygon(points: { x: number; y: number }[]): number[] {
  const out: number[] = [];
  if (points.length === 0) return out;
  // MoveTo, one point.
  out.push((1 & 0x7) | (1 << 3));
  let px = points[0].x;
  let py = points[0].y;
  out.push(zigzag(px), zigzag(py));
  // LineTo, the rest.
  out.push((2 & 0x7) | ((points.length - 1) << 3));
  for (let i = 1; i < points.length; i++) {
    out.push(zigzag(points[i].x - px), zigzag(points[i].y - py));
    px = points[i].x;
    py = points[i].y;
  }
  out.push((7 & 0x7) | (1 << 3)); // ClosePath
  return out;
}

function encodeTile(features: TestFeature[], tile: TileCoord, extent = 4096): ArrayBuffer {
  const pbf = new Pbf();
  pbf.writeMessage(
    3,
    (_layer: unknown, out: Pbf) => {
      out.writeVarintField(15, 2);
      out.writeStringField(1, "buildings");
      out.writeVarintField(5, extent);
      out.writeStringField(3, "id");
      out.writeStringField(3, "height");
      for (const feature of features) {
        out.writeMessage(4, (value: string, o: Pbf) => o.writeStringField(1, value), feature.id ?? "");
        out.writeMessage(
          4,
          (value: number, o: Pbf) => o.writeDoubleField(3, value),
          feature.height ?? 0,
        );
      }
      features.forEach((feature, index) => {
        const geometry = encodePolygon(
          feature.ring.map(([lon, lat]) => lonLatToPoint(tile, lon, lat, extent)),
        );
        out.writeMessage(
          2,
          (_f: unknown, o: Pbf) => {
            o.writePackedVarint(2, [0, index * 2, 1, index * 2 + 1]);
            o.writeVarintField(3, 3);
            o.writePackedVarint(4, geometry);
          },
          {},
        );
      });
    },
    {},
  );
  const bytes = pbf.finish();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const TILE: TileCoord = { z: 15, x: 17001, y: 10936 };
const SQUARE: [number, number][] = [
  [6.78, 51.229],
  [6.7803, 51.229],
  [6.7803, 51.2293],
  [6.78, 51.2293],
];

function fakeSource(tiles: Record<string, ArrayBuffer | undefined>): BuildingTileSource & {
  calls: number;
} {
  const source = {
    url: "pmtiles://test",
    calls: 0,
    async getTile(tile: TileCoord) {
      source.calls += 1;
      return tiles[`${tile.z}/${tile.x}/${tile.y}`] === undefined
        ? undefined
        : { data: tiles[`${tile.z}/${tile.x}/${tile.y}`] as ArrayBuffer };
    },
  };
  return source;
}

describe("building tile decoding", () => {
  it("reads height and id and converts geometry to lng/lat", () => {
    const tile = encodeTile([{ id: "DENW1", height: 42, ring: SQUARE }], TILE);
    const [building] = decodeBuildingTile(tile, TILE);
    expect(building.id).toBe("DENW1");
    expect(building.heightM).toBe(42);
    expect(building.ring.length).toBe(4);
    const [lon, lat] = building.ring[0];
    expect(lon).toBeCloseTo(SQUARE[0][0], 4);
    expect(lat).toBeCloseTo(SQUARE[0][1], 4);
  });

  it("round-trips tile coordinates through the Mercator inverse", () => {
    const [lon, lat] = tilePointToLngLat(TILE, 2048, 2048, 4096);
    const point = lonLatToPoint(TILE, lon, lat, 4096);
    expect(point.x).toBe(2048);
    expect(point.y).toBe(2048);
  });

  it("drops features without a usable height", () => {
    const tile = encodeTile(
      [
        { id: "ok", height: 10, ring: SQUARE },
        { id: "zero", height: 0, ring: SQUARE },
        { id: "missing", ring: SQUARE },
      ],
      TILE,
    );
    const buildings = decodeBuildingTile(tile, TILE);
    expect(buildings.map((b) => b.id)).toEqual(["ok"]);
  });

  it("raises a decode error for a broken tile", () => {
    const broken = new Uint8Array([0xff, 0xff, 0xff]).buffer;
    expect(() => decodeBuildingTile(broken, TILE)).toThrow(ShadowDataError);
  });
});

describe("loadBuildingsForBbox", () => {
  const bbox: Bbox = [6.78, 51.229, 6.781, 51.2296];
  const wideBbox: Bbox = [6.77, 51.225, 6.79, 51.235];

  it("dedupes buildings that appear in two tiles", async () => {
    const tile = { z: 16, x: 34002, y: 21873 };
    const data = encodeTile([{ id: "same", height: 20, ring: SQUARE }], tile);
    const source = {
      url: "pmtiles://test",
      calls: 0,
      async getTile() {
        source.calls += 1;
        return { data };
      },
    };
    const result = await loadBuildingsForBbox(wideBbox, {
      source,
      zoom: 16,
      maxTiles: 64,
    });
    expect(result.buildings.length).toBe(1);
    expect(result.duplicates).toBeGreaterThan(0);
    expect(result.missingTiles).toBe(0);
  });

  it("counts missing tiles instead of failing", async () => {
    const result = await loadBuildingsForBbox(bbox, {
      source: fakeSource({}),
      zoom: 15,
    });
    expect(result.buildings).toEqual([]);
    expect(result.missingTiles).toBeGreaterThan(0);
  });

  it("caches decoded tiles between runs", async () => {
    const tile = { z: 15, x: 17001, y: 10936 };
    const data = encodeTile([{ id: "a", height: 12, ring: SQUARE }], tile);
    const source = fakeSource({
      [`15/${tile.x}/${tile.y}`]: data,
      [`15/${tile.x + 1}/${tile.y}`]: data,
      [`15/${tile.x}/${tile.y + 1}`]: data,
      [`15/${tile.x + 1}/${tile.y + 1}`]: data,
    });
    const cache = new Map();
    const first = await loadBuildingsForBbox(bbox, { source, zoom: 15, cache });
    const callsAfterFirst = source.calls;
    const second = await loadBuildingsForBbox(bbox, { source, zoom: 15, cache });
    expect(source.calls).toBe(callsAfterFirst);
    expect(second.cacheHits).toBeGreaterThanOrEqual(first.tiles.filter(() => true).length - second.missingTiles);
    expect(second.buildings.length).toBeGreaterThan(0);
  });

  it("times out a source that never answers", async () => {
    const source: BuildingTileSource = {
      url: "pmtiles://slow",
      getTile: () => new Promise(() => {}),
    };
    await expect(
      loadBuildingsForBbox(bbox, { source, zoom: 15, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("reports aborts as aborts, not as timeouts", async () => {
    const controller = new AbortController();
    const source: BuildingTileSource = {
      url: "pmtiles://slow",
      getTile: (_tile, signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    };
    const promise = loadBuildingsForBbox(bbox, {
      source,
      zoom: 15,
      signal: controller.signal,
    });
    controller.abort();
    const error = await promise.catch((reason) => reason);
    expect(error).toMatchObject({ code: "aborted" });
    expect(isAbortError(error)).toBe(true);
  });
});

describe("buildingTilesForBbox", () => {
  it("caps the tile count by stepping the zoom down", () => {
    const wide: Bbox = [6.68, 51.14, 6.92, 51.34];
    const { zoom, tiles } = buildingTilesForBbox(wide, 16, 36);
    expect(zoom).toBeLessThan(16);
    expect(tiles.length).toBeLessThanOrEqual(36);
  });

  it("keeps the requested zoom for a small viewport", () => {
    const { zoom } = buildingTilesForBbox([6.78, 51.229, 6.781, 51.2296], 16, 36);
    expect(zoom).toBe(16);
  });
});

describe("withTimeout", () => {
  it("rejects with a timeout error and calls no one twice", async () => {
    vi.useFakeTimers();
    const promise = withTimeout(() => new Promise(() => {}), 50);
    const assertion = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    vi.useRealTimers();
  });
});
