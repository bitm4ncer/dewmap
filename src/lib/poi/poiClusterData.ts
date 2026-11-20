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

/**
 * Low zooms cover a far larger area with the same z14 tiles, so the
 * tile budget grows as the map zooms out. Phones stay inside these
 * budgets for a city/region view; large screens fall back to the
 * centre-first subset.
 */
export function clusterTileBudget(zoom: number): number {
  if (zoom >= 13) return 240;
  if (zoom >= 12) return 260;
  if (zoom >= 11) return 320;
  return 400;
}
const TILE_CACHE_TTL_MS = 10 * 60_000;
const TILE_CACHE_MAX = 900;

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
  const res = await fetch(url, { signal, cache: "force-cache" });
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
  options?: {
    /** Tile fan-out cap for this call (see clusterTileBudget). */
    budget?: number;
  },
): Promise<GeoJSON.FeatureCollection<GeoJSON.Point>> {
  const budget = options?.budget ?? MAX_CLUSTER_TILES;
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
  if (coords.length > budget) {
    const [s, w, n, e] = bbox;
    const cx = (w + e) / 2;
    const cy = (s + n) / 2;
    const centre = tileRangeForBbox([cy, cx, cy, cx], POI_CLUSTER_TILE_ZOOM);
    coords.sort(
      (a, b) =>
        Math.hypot(a[0] - centre.x0, a[1] - centre.y0)
        - Math.hypot(b[0] - centre.x0, b[1] - centre.y0),
    );
    coords.length = budget;
    console.warn(
      `[poi] cluster tile budget: keeping ${budget} of ${range.count} tiles`,
    );
  }

  // Fetch in small batches so a city view does not fire hundreds of
  // requests at once (mobile data / server friendliness). The cluster
  // source is updated every few batches, so the overview fills in
  // progressively instead of appearing after the last tile.
  const seen = new Set<string>();
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  const BATCH = 8;
  for (let i = 0; i < coords.length; i += BATCH) {
    const batch = coords.slice(i, i + BATCH);
    const loaded = await Promise.all(
      batch.map(([x, y]) =>
        loadTile(template, POI_CLUSTER_TILE_ZOOM, x, y, signal),
      ),
    );
    for (const points of loaded) {
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
    // Hand the main thread back between batches so panning stays fluid.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { type: "FeatureCollection", features };
}

// ── Single-level district aggregation ────────────────────────────────
/**
 * Cell size for the one cluster level per zoom. Bigger cells when
 * zoomed far out, district-sized (~2.5 km) around z12. There is no
 * second hierarchy: every place belongs to exactly one cell and every
 * non-empty cell becomes exactly one marker.
 */
export function districtCellDeg(zoom: number): number {
  if (zoom < 11) return 0.06;
  if (zoom < 12) return 0.04;
  return 0.025;
}

/**
 * Group POIs into square geographic cells. Cells with two or more
 * places become one counted marker at the mean position; single places
 * pass through unchanged (and render as an individual dot).
 */
export function aggregatePoiDistricts(
  data: GeoJSON.FeatureCollection<GeoJSON.Point>,
  cellDeg: number,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const cells = new Map<
    string,
    {
      sumLon: number;
      sumLat: number;
      count: number;
      first: GeoJSON.Feature<GeoJSON.Point>;
    }
  >();

  for (const feature of data.features) {
    if (feature.geometry?.type !== "Point") continue;
    const [lon, lat] = feature.geometry.coordinates as [number, number];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const key = `${Math.floor(lon / cellDeg)}:${Math.floor(lat / cellDeg)}`;
    const cell = cells.get(key);
    if (cell) {
      cell.sumLon += lon;
      cell.sumLat += lat;
      cell.count += 1;
    } else {
      cells.set(key, { sumLon: lon, sumLat: lat, count: 1, first: feature });
    }
  }

  const out: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const cell of cells.values()) {
    if (cell.count === 1) {
      // Keep the original place so tapping it opens the right card.
      out.push(cell.first);
      continue;
    }
    // Anchor the marker on the cell centre, not on the running mean:
    // streaming tiles then only change the count, never the position.
    const gx = Math.floor(cell.sumLon / cell.count / cellDeg);
    const gy = Math.floor(cell.sumLat / cell.count / cellDeg);
    out.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [(gx + 0.5) * cellDeg, (gy + 0.5) * cellDeg],
      },
      properties: {
        point_count: cell.count,
        cell_deg: cellDeg,
      },
    });
  }
  return { type: "FeatureCollection", features: out };
}

// ── Warm start ────────────────────────────────────────────────────────
// The whole-city view needs hundreds of tiles; on a fresh app start the
// map would be empty for seconds. Persist the last aggregated district
// markers per view so the same picture appears instantly, then refresh.
const VIEW_KEY = "kugelmaps.poi-view.v1";
const VIEW_TTL_MS = 12 * 60 * 60_000;
const VIEW_MAX_ENTRIES = 3;
const VIEW_MAX_BYTES = 500_000;

interface PersistedView {
  at: number;
  bbox: [number, number, number, number];
  cellDeg: number;
  features: GeoJSON.Feature<GeoJSON.Point>[];
}

function containsBbox(
  outer: [number, number, number, number],
  inner: [number, number, number, number],
): boolean {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[2] <= outer[2] &&
    inner[3] <= outer[3]
  );
}

function readViews(): PersistedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { v?: number; views?: PersistedView[] };
    if (parsed?.v !== 1 || !Array.isArray(parsed.views)) return [];
    return parsed.views;
  } catch {
    return [];
  }
}

export function persistPoiView(
  bbox: [number, number, number, number],
  cellDeg: number,
  data: GeoJSON.FeatureCollection<GeoJSON.Point>,
): void {
  if (typeof window === "undefined" || data.features.length === 0) return;
  try {
    const views = readViews().filter(
      (view) => Math.abs(view.cellDeg - cellDeg) > 1e-9,
    );
    views.unshift({ at: Date.now(), bbox, cellDeg, features: data.features });
    let payload = JSON.stringify({
      v: 1,
      views: views.slice(0, VIEW_MAX_ENTRIES),
    });
    while (payload.length > VIEW_MAX_BYTES && views.length > 1) {
      views.pop();
      payload = JSON.stringify({ v: 1, views: views.slice(0, VIEW_MAX_ENTRIES) });
    }
    if (payload.length > VIEW_MAX_BYTES) return;
    window.localStorage.setItem(VIEW_KEY, payload);
  } catch {
    // Quota or privacy mode: skip the warm start.
  }
}

export function loadPoiView(
  bbox: [number, number, number, number],
  cellDeg: number,
): GeoJSON.FeatureCollection<GeoJSON.Point> | null {
  const now = Date.now();
  let best: PersistedView | null = null;
  for (const view of readViews()) {
    if (now - view.at > VIEW_TTL_MS) continue;
    if (Math.abs(view.cellDeg - cellDeg) > 1e-9) continue;
    if (!containsBbox(view.bbox, bbox)) continue;
    if (!best || view.at > best.at) best = view;
  }
  if (!best) return null;
  return { type: "FeatureCollection", features: best.features };
}
