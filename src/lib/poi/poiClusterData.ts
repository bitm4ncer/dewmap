import Pbf from "pbf";
import { VectorTile } from "@mapbox/vector-tile";
import {
  featureMatchesKinds,
  POI_TILEJSON_URL,
  type PoiKindFilter,
} from "./poiLayer";

/**
 * City-overview POI aggregation.
 *
 * MapLibre only loads tiles at the source's own zoom range and *skips*
 * tile zooms below a source's minzoom, so a pinned z14 vector source
 * cannot feed a z12 map. Instead we fetch the dense z14 POI tiles
 * ourselves, decode them and hand a GeoJSON FeatureCollection to the
 * clustered GeoJSON source.
 */

export const POI_CLUSTER_TILE_ZOOM = 14;
/** Guard rail: never fan out into more tiles than this. */
export const MAX_CLUSTER_TILES = 240;
const TILE_CACHE_TTL_MS = 10 * 60_000;
const TILE_CACHE_MAX = 320;

export interface ClusterPoint {
  lon: number;
  lat: number;
  name: string;
  class: string;
  subclass: string;
}

// ── Pure tile math (unit-tested) ──────────────────────────────────────

export interface TileRange {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  count: number;
}

export function lonLatToTile(
  lon: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  );
  return {
    x: Math.min(n - 1, Math.max(0, x)),
    y: Math.min(n - 1, Math.max(0, y)),
  };
}

/** Inclusive tile range for bbox = [south, west, north, east]. */
export function tileRangeForBbox(
  bbox: [number, number, number, number],
  z: number,
): TileRange {
  const [s, w, n, e] = bbox;
  const nw = lonLatToTile(w, n, z);
  const se = lonLatToTile(e, s, z);
  // Antimeridian crossings are not supported; clamp to one world.
  const x0 = Math.min(nw.x, se.x);
  const x1 = Math.max(nw.x, se.x);
  const y0 = Math.min(nw.y, se.y);
  const y1 = Math.max(nw.y, se.y);
  return { x0, y0, x1, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

// ── Tile access ───────────────────────────────────────────────────────

let templatePromise: Promise<string> | null = null;

/** The dated tile URL template from the TileJSON, fetched once. */
function tileTemplate(): Promise<string> {
  if (!templatePromise) {
    templatePromise = fetch(POI_TILEJSON_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`POI TileJSON → ${res.status}`);
        return res.json() as Promise<{ tiles?: string[] }>;
      })
      .then((json) => {
        const template = json.tiles?.[0];
        if (!template) throw new Error("POI TileJSON has no tile template");
        return template;
      })
      .catch((error) => {
        templatePromise = null;
        throw error;
      });
  }
  return templatePromise;
}

const tileCache = new Map<
  string,
  { at: number; points: ClusterPoint[] }
>();

function cacheGet(key: string): ClusterPoint[] | null {
  const hit = tileCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TILE_CACHE_TTL_MS) {
    tileCache.delete(key);
    return null;
  }
  return hit.points;
}

function cacheSet(key: string, points: ClusterPoint[]): void {
  tileCache.set(key, { at: Date.now(), points });
  if (tileCache.size > TILE_CACHE_MAX) {
    const oldest = [...tileCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) tileCache.delete(oldest[0]);
  }
}

async function loadTile(
  template: string,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<ClusterPoint[]> {
  const key = `${z}/${x}/${y}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url = template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`POI tile ${z}/${x}/${y} → ${res.status}`);
  const buffer = new Uint8Array(await res.arrayBuffer());
  const tile = new VectorTile(new Pbf(buffer));
  const layer = tile.layers.poi;
  const points: ClusterPoint[] = [];
  if (layer) {
    for (let i = 0; i < layer.length; i += 1) {
      const feature = layer.feature(i);
      if (feature.type !== 1) continue; // point geometries only
      const geo = feature.toGeoJSON(x, y, z);
      if (geo.geometry?.type !== "Point") continue;
      const [lon, lat] = geo.geometry.coordinates as [number, number];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const props = (geo.properties ?? {}) as Record<string, unknown>;
      points.push({
        lon,
        lat,
        name: typeof props.name === "string" ? props.name : "",
        class: typeof props.class === "string" ? props.class : "",
        subclass: typeof props.subclass === "string" ? props.subclass : "",
      });
    }
  }
  cacheSet(key, points);
  return points;
}

/**
 * Fetch and aggregate POI points for the bbox at the dense z14 tile
 * zoom, deduplicated across tile borders and filtered by the kind chips.
 */
export async function fetchPoiClusterPoints(
  bbox: [number, number, number, number],
  kinds: readonly PoiKindFilter[],
  signal?: AbortSignal,
  /** Tile URL template already known to the map source; avoids a
   *  second TileJSON round-trip and keeps map-level URL overrides. */
  templateOverride?: string,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Point>> {
  const range = tileRangeForBbox(bbox, POI_CLUSTER_TILE_ZOOM);
  if (range.count === 0) {
    return { type: "FeatureCollection", features: [] };
  }
  const template = templateOverride ?? (await tileTemplate());

  const coords: [number, number][] = [];
  for (let x = range.x0; x <= range.x1; x += 1) {
    for (let y = range.y0; y <= range.y1; y += 1) {
      coords.push([x, y]);
    }
  }

  // Never come back empty when the viewport is a little over budget:
  // keep the tiles closest to the viewport centre (these carry the
  // clusters the user actually looks at) and drop the rest.
  if (coords.length > MAX_CLUSTER_TILES) {
    const [s, w, n, e] = bbox;
    const cx = (w + e) / 2;
    const cy = (s + n) / 2;
    const centre = tileRangeForBbox([cy, cx, cy, cx], POI_CLUSTER_TILE_ZOOM);
    coords.sort(
      (a, b) =>
        Math.hypot(a[0] - centre.x0, a[1] - centre.y0)
        - Math.hypot(b[0] - centre.x0, b[1] - centre.y0),
    );
    coords.length = MAX_CLUSTER_TILES;
    console.warn(
      `[poi] cluster tile budget: keeping ${MAX_CLUSTER_TILES} of ${range.count} tiles`,
    );
  }

  // Fetch in small batches so a city view does not fire 30 requests at
  // once (mobile data / server friendliness).
  const tiles: ClusterPoint[][] = [];
  const BATCH = 8;
  for (let i = 0; i < coords.length; i += BATCH) {
    const batch = coords.slice(i, i + BATCH);
    const loaded = await Promise.all(
      batch.map(([x, y]) =>
        loadTile(template, POI_CLUSTER_TILE_ZOOM, x, y, signal),
      ),
    );
    tiles.push(...loaded);
    // Hand the main thread back between batches so panning stays fluid.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const seen = new Set<string>();
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const points of tiles) {
    for (const point of points) {
      if (!featureMatchesKinds(
        { class: point.class, subclass: point.subclass, name: point.name },
        kinds,
      )) continue;
      const key = `${point.lon.toFixed(5)}:${point.lat.toFixed(5)}:${point.name}:${point.class}:${point.subclass}`;
      if (seen.has(key)) continue;
      seen.add(key);
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
        properties: {
          name: point.name,
          class: point.class,
          subclass: point.subclass,
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}
