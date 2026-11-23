/**
 * Building footprints for the shadow layer, read straight out of PMTiles.
 *
 * PMTiles is a single file with a 16 kB header and byte-range reads, so a
 * viewport costs a handful of small HTTP requests and nothing on the server.
 * Tiles are decoded to `BuildingFootprint[]` once and cached per tile.
 *
 * The loader is deliberately dependency-injected: `loadBuildingsForBbox`
 * takes a tile source, so tests run against a fake one and the browser uses
 * `createPmtilesBuildingSource`.
 */
import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import { PMTiles, FetchSource } from "pmtiles";
import { BUILDINGS_LAYER } from "./pilot";
import { tilesForBbox, type TileCoord } from "./tiles";
import type { Bbox, BuildingFootprint, LngLat } from "./types";

export type ShadowDataErrorCode =
  | "timeout"
  | "network"
  | "http"
  | "decode"
  | "aborted"
  | "empty";

export class ShadowDataError extends Error {
  readonly code: ShadowDataErrorCode;
  readonly status: number;

  constructor(code: ShadowDataErrorCode, message: string, status = 0) {
    super(message);
    this.name = "ShadowDataError";
    this.code = code;
    this.status = status;
  }
}

/**
 * A real abort (unmount, new viewport, newer slider value). A `timeout` is
 * deliberately **not** an abort: it is a failure the panel has to report, not
 * a reason to stay silent in "resolving shadows…".
 */
export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof ShadowDataError && error.code === "aborted") ||
    (error as { name?: string } | null)?.name === "AbortError"
  );
}

/** One decoded tile worth of data, plus the archive's own bytes. */
export interface BuildingTile {
  data: ArrayBuffer;
}

export interface BuildingTileSource {
  readonly url: string;
  /** `undefined` when the archive has no tile at that position. */
  getTile(tile: TileCoord, signal?: AbortSignal): Promise<BuildingTile | undefined>;
}

const archives = new Map<string, PMTiles>();

function archiveFor(url: string): PMTiles {
  const existing = archives.get(url);
  if (existing) return existing;
  const archive = new PMTiles(new FetchSource(url));
  archives.set(url, archive);
  return archive;
}

/** PMTiles-backed source. One archive instance per URL, reused across calls. */
export function createPmtilesBuildingSource(url: string): BuildingTileSource {
  return {
    url,
    async getTile(tile, signal) {
      const archive = archiveFor(url);
      try {
        const response = await archive.getZxy(tile.z, tile.x, tile.y, signal);
        if (!response) return undefined;
        return { data: response.data };
      } catch (error) {
        if (signal?.aborted) throw new ShadowDataError("aborted", "aborted");
        throw new ShadowDataError(
          "network",
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}

/** Run `task`, rejecting with a `timeout` error after `ms`. */
export async function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  outer?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener("abort", forward, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The timeout has to reject on its own: a fetch that ignores its signal
  // (or a Promise that never settles) would otherwise hang the caller.
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ShadowDataError("timeout", `no response after ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([task(controller.signal), deadline]);
  } catch (error) {
    if (outer?.aborted) throw new ShadowDataError("aborted", "aborted");
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    outer?.removeEventListener("abort", forward);
  }
}

/** Split an MVT point into lng/lat. Exact Mercator inverse, no linearisation. */
export function tilePointToLngLat(
  tile: TileCoord,
  px: number,
  py: number,
  extent: number,
): LngLat {
  const n = 2 ** tile.z;
  const worldX = (tile.x + px / extent) / n;
  const worldY = (tile.y + py / extent) / n;
  const lon = worldX * 360 - 180;
  const lat =
    (Math.atan(Math.sinh(Math.PI * (1 - 2 * worldY))) * 180) / Math.PI;
  return [lon, lat];
}

/** Decode one MVT tile of the `buildings` layer. */
export function decodeBuildingTile(data: ArrayBuffer, tile: TileCoord): BuildingFootprint[] {
  let layer;
  try {
    const vectorTile = new VectorTile(new Pbf(new Uint8Array(data)));
    layer = vectorTile.layers[BUILDINGS_LAYER];
  } catch (error) {
    throw new ShadowDataError(
      "decode",
      `tile ${tile.z}/${tile.x}/${tile.y}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!layer) return [];
  const extent = layer.extent || 4096;
  const buildings: BuildingFootprint[] = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    const heightM = Number(feature.properties.height);
    if (!Number.isFinite(heightM) || heightM <= 0) continue;
    // Polygon (3) only; everything else in this archive is a data error.
    if (feature.type !== 3) continue;
    const rings = feature.loadGeometry();
    if (!rings.length) continue;
    // The pilot has no courtyards in LoD1 (block models), so ring 0 is the
    // footprint. Taking the largest ring keeps this correct if that changes.
    let ring = rings[0];
    if (rings.length > 1) {
      let bestArea = 0;
      for (const candidate of rings) {
        const area = Math.abs(ringArea(candidate));
        if (area > bestArea) {
          bestArea = area;
          ring = candidate;
        }
      }
    }
    if (ring.length < 3) continue;
    const coordinates: LngLat[] = ring.map((point) =>
      tilePointToLngLat(tile, point.x, point.y, extent),
    );
    // MVT closed rings repeat the first point; the engine accepts either, but
    // dropping it saves one coordinate per building on every worker message.
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (coordinates.length > 3 && first[0] === last[0] && first[1] === last[1]) {
      coordinates.pop();
    }
    const id = feature.properties.id;
    buildings.push({
      id: typeof id === "string" || typeof id === "number" ? id : undefined,
      heightM,
      ring: coordinates,
    });
  }
  return buildings;
}

function ringArea(ring: { x: number; y: number }[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export interface LoadBuildingsOptions {
  source: BuildingTileSource;
  /** Tile zoom to read, 14–16. */
  zoom: number;
  /** Per-tile timeout. */
  timeoutMs?: number;
  /** Max tiles before the zoom is reduced by the caller. */
  maxTiles?: number;
  signal?: AbortSignal;
  /** Decoded-tile cache, keyed by `z/x/y`. */
  cache?: Map<string, BuildingFootprint[]>;
  /** Max cached tiles; oldest keys are dropped. */
  cacheLimit?: number;
}

export interface LoadBuildingsResult {
  buildings: BuildingFootprint[];
  tiles: TileCoord[];
  missingTiles: number;
  cacheHits: number;
  bytes: number;
  /** Duplicate ids seen in more than one tile. */
  duplicates: number;
}

/** Tiles for a bbox at the requested tile zoom, capped so one pan cannot explode. */
export function buildingTilesForBbox(
  bbox: Bbox,
  tileZoom: number,
  maxTiles = 36,
): { zoom: number; tiles: TileCoord[] } {
  let z = Math.max(12, Math.min(16, Math.round(tileZoom)));
  for (;;) {
    const tiles = tilesForBbox(bbox, z);
    if (tiles.length <= maxTiles || z <= 12) return { zoom: z, tiles };
    z -= 1;
  }
}

/**
 * Mark a cache entry as most recently used.
 *
 * A `Map` keeps insertion order, so delete + set is the whole LRU: the first
 * key is then genuinely the least recently used one. Without this, the eviction
 * below would be FIFO, which throws away a hot tile just because it arrived
 * first.
 */
export function touchCache<K, V>(cache: Map<K, V>, key: K): V | undefined {
  const value = cache.get(key);
  if (value === undefined) return undefined;
  cache.delete(key);
  cache.set(key, value);
  return value;
}

/**
 * Load and dedupe the buildings covering `bbox`.
 *
 * Dedupe is by archive id: a building that touches a tile border is present
 * in both neighbours, and counting it twice would double its shadow edge.
 */
export async function loadBuildingsForBbox(
  bbox: Bbox,
  options: LoadBuildingsOptions,
): Promise<LoadBuildingsResult> {
  const cache = options.cache ?? new Map<string, BuildingFootprint[]>();
  const cacheLimit = options.cacheLimit ?? 64;
  const timeoutMs = options.timeoutMs ?? 8000;
  const { tiles, zoom } = buildingTilesForBbox(
    bbox,
    options.zoom,
    options.maxTiles ?? 36,
  );
  const buildings: BuildingFootprint[] = [];
  const seen = new Set<string | number>();
  let missingTiles = 0;
  let cacheHits = 0;
  let bytes = 0;
  let duplicates = 0;

  for (const tile of tiles) {
    if (options.signal?.aborted) throw new ShadowDataError("aborted", "aborted");
    const key = `${options.source.url}|${zoom}/${tile.x}/${tile.y}`;
    let decoded = touchCache(cache, key);
    if (decoded) {
      cacheHits += 1;
    } else {
      const tileData = await withTimeout(
        (signal) => options.source.getTile(tile, signal),
        timeoutMs,
        options.signal,
      );
      if (!tileData) {
        missingTiles += 1;
        continue;
      }
      bytes += tileData.data.byteLength;
      decoded = decodeBuildingTile(tileData.data, tile);
      cache.set(key, decoded);
      if (cache.size > cacheLimit) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
    }
    for (const building of decoded) {
      if (building.id !== undefined) {
        if (seen.has(building.id)) {
          duplicates += 1;
          continue;
        }
        seen.add(building.id);
      }
      buildings.push(building);
    }
  }

  return { buildings, tiles, missingTiles, cacheHits, bytes, duplicates };
}
