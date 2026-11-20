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
 * ourselves, decode them together with the z14 `place` layer (which
 * contains OSM Stadtteile/Ortsteile) and hand a GeoJSON FeatureCollection
 * to the clustered GeoJSON source.
 *
 * The district marker is a real named place point, not an arbitrary
 * grid cell. Only places without a nearby district point fall back to a
 * fixed grid, so rural areas still show something.
 */

export const POI_CLUSTER_TILE_ZOOM = 14;
/** Hard ceiling for one build. Wide z10 screens cannot be covered fully
 *  with z14 tiles; the proper fix is a precomputed low-zoom archive. */
export const MAX_CLUSTER_TILES = 800;

/**
 * Viewport-shaped budgets. z11/z12 are the city/region overview band;
 * the values cover a 1920 px-wide screen at z11 (≈684 tiles) and a 4K
 * screen at z12 (≈480 tiles). z10 is a phone/tablet band (≈528 tiles
 * on a 390×844 phone); a 1440 px z10 screen is still capped and will be
 * incomplete until a precomputed low-zoom source exists.
 */
export function clusterTileBudget(zoom: number): number {
  if (zoom >= 13) return 400;
  if (zoom >= 12) return 600;
  if (zoom >= 11) return 700;
  return MAX_CLUSTER_TILES;
}

const TILE_CACHE_TTL_MS = 10 * 60_000;
const TILE_CACHE_MAX = 700;
/** Roughly 90 MB of decoded point objects; keeps a phone PWA bounded. */
const TILE_CACHE_POINTS_MAX = 600_000;

export interface ClusterPoint {
  lon: number;
  lat: number;
  name: string;
  class: string;
  subclass: string;
}

export type DistrictClass =
  | "suburb"
  | "quarter"
  | "neighbourhood"
  | "village"
  | "hamlet"
  | "town";

export interface DistrictPoint {
  lon: number;
  lat: number;
  name: string;
  class: DistrictClass;
}

export interface ClusterData {
  points: ClusterPoint[];
  districts: DistrictPoint[];
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

interface TileData {
  points: ClusterPoint[];
  districts: DistrictPoint[];
}

const tileCache = new Map<string, { at: number; data: TileData }>();
let cachedPoints = 0;

function cacheGet(key: string): TileData | null {
  const hit = tileCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TILE_CACHE_TTL_MS) {
    tileCache.delete(key);
    cachedPoints -= hit.data.points.length + hit.data.districts.length;
    return null;
  }
  return hit.data;
}

function cacheSet(key: string, data: TileData): void {
  const existing = tileCache.get(key);
  if (existing) {
    cachedPoints -= existing.data.points.length + existing.data.districts.length;
    tileCache.delete(key);
  }
  tileCache.set(key, { at: Date.now(), data });
  cachedPoints += data.points.length + data.districts.length;
  while (
    tileCache.size > TILE_CACHE_MAX ||
    cachedPoints > TILE_CACHE_POINTS_MAX
  ) {
    const oldest = tileCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const entry = tileCache.get(oldest);
    if (entry) {
      cachedPoints -= entry.data.points.length + entry.data.districts.length;
    }
    tileCache.delete(oldest);
  }
}

/** Free the decoded-tile memory when Places is switched off. */
export function clearPoiTileCache(): void {
  tileCache.clear();
  cachedPoints = 0;
}

const DISTRICT_CLASSES = new Set<DistrictClass>([
  "suburb",
  "quarter",
  "neighbourhood",
  "village",
  "hamlet",
  "town",
]);

function placeName(props: Record<string, unknown>): string {
  for (const key of ["name:latin", "name_en", "name"]) {
    const value = props[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function districtKey(district: DistrictPoint): string {
  return `${district.class}|${district.name}|${district.lon.toFixed(4)}|${district.lat.toFixed(4)}`;
}

async function loadTile(
  template: string,
  z: number,
  x: number,
  y: number,
  signal?: AbortSignal,
): Promise<TileData> {
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

  const points: ClusterPoint[] = [];
  const poiLayer = tile.layers.poi;
  if (poiLayer) {
    for (let i = 0; i < poiLayer.length; i += 1) {
      const feature = poiLayer.feature(i);
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

  const districts: DistrictPoint[] = [];
  const placeLayer = tile.layers.place;
  if (placeLayer) {
    for (let i = 0; i < placeLayer.length; i += 1) {
      const feature = placeLayer.feature(i);
      if (feature.type !== 1) continue;
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      const cls = typeof props.class === "string" ? props.class : "";
      if (!DISTRICT_CLASSES.has(cls as DistrictClass)) continue;
      const name = placeName(props);
      if (!name) continue;
      const geo = feature.toGeoJSON(x, y, z);
      if (geo.geometry?.type !== "Point") continue;
      const [lon, lat] = geo.geometry.coordinates as [number, number];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      districts.push({ lon, lat, name, class: cls as DistrictClass });
    }
  }

  const data: TileData = { points, districts };
  cacheSet(key, data);
  return data;
}

/**
 * Fetch and aggregate POI points for the bbox at the dense z14 tile
 * zoom. Tiles are deduplicated across tile borders, filtered by the kind
 * chips, and failed tiles are skipped instead of aborting the build.
 */
export async function fetchPoiClusterData(
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
): Promise<ClusterData> {
  const budget = options?.budget ?? MAX_CLUSTER_TILES;
  const range = tileRangeForBbox(bbox, POI_CLUSTER_TILE_ZOOM);
  if (range.count === 0) {
    return { points: [], districts: [] };
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
  // districts the user actually looks at) and drop the rest.
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
  // requests at once (mobile data / server friendliness). The caller
  // updates the source once the whole view has been collected, so the
  // counts never flicker while tiles stream in.
  const seen = new Set<string>();
  const points: ClusterPoint[] = [];
  const districts = new Map<string, DistrictPoint>();
  const BATCH = 8;
  const failed: [number, number][] = [];
  let firstError: unknown;

  const consume = (data: TileData) => {
    for (const point of data.points) {
      if (!featureMatchesKinds(
        { class: point.class, subclass: point.subclass, name: point.name },
        kinds,
      )) continue;
      const key = `${point.lon.toFixed(5)}:${point.lat.toFixed(5)}:${point.name}:${point.class}:${point.subclass}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(point);
    }
    for (const district of data.districts) {
      const key = districtKey(district);
      if (!districts.has(key)) districts.set(key, district);
    }
  };

  const runBatch = async (batch: [number, number][]) => {
    const settled = await Promise.allSettled(
      batch.map(([x, y]) =>
        loadTile(template, POI_CLUSTER_TILE_ZOOM, x, y, signal),
      ),
    );
    settled.forEach((result, index) => {
      if (result.status === "rejected") {
        failed.push(batch[index]);
        if (firstError === undefined) firstError = result.reason;
        return;
      }
      consume(result.value);
    });
  };

  const abortError = () => {
    const error = new Error("Aborted");
    error.name = "AbortError";
    return error;
  };

  for (let i = 0; i < coords.length; i += BATCH) {
    await runBatch(coords.slice(i, i + BATCH));
    if (signal?.aborted) throw abortError();
    // Hand the main thread back between batches so panning stays fluid.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  // Retry failed tiles once. A transient 429/5xx in a 500-tile fan-out
  // must not silently undercount a district.
  if (failed.length > 0) {
    const retry = failed.splice(0, failed.length);
    await new Promise((resolve) => setTimeout(resolve, 300));
    for (let i = 0; i < retry.length; i += BATCH) {
      await runBatch(retry.slice(i, i + BATCH));
      if (signal?.aborted) throw abortError();
    }
  }

  if (signal?.aborted) throw abortError();
  if (coords.length > 0 && failed.length === coords.length) {
    throw firstError ?? new Error("all POI tiles failed");
  }
  if (failed.length > 0) {
    console.warn(
      `[poi] ${failed.length}/${coords.length} tiles failed after retry; using partial data`,
      firstError,
    );
  }

  return { points, districts: [...districts.values()] };
}

// ── Single-level district aggregation ────────────────────────────────
/**
 * Fallback grid for places that have no OSM district point nearby.
 * Unlike the old primary grid, this is only used in sparse/rural areas.
 * One fixed grid for the whole cluster band keeps markers stable.
 */
export const DISTRICT_CELL_DEG = 0.02;

const SUBURB_MAX_KM = 15;
const QUARTER_MAX_KM = 8;
const RURAL_MAX_KM = 20;

interface DistrictGroup {
  key: string;
  lon: number;
  lat: number;
  name?: string;
  districtClass?: DistrictClass;
  count: number;
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

const QUARTER_CLASSES = new Set<DistrictClass>(["quarter", "neighbourhood"]);
const RURAL_CLASSES = new Set<DistrictClass>(["village", "hamlet", "town"]);

function nearestDistrict(
  districts: readonly DistrictPoint[],
  lon: number,
  lat: number,
  maxKm: number,
): { district: DistrictPoint; km: number } | null {
  if (districts.length === 0) return null;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let best: DistrictPoint | null = null;
  let bestKm = maxKm;
  for (const district of districts) {
    const dx = (district.lon - lon) * 111.32 * cosLat;
    const dy = (district.lat - lat) * 111.32;
    const km = Math.hypot(dx, dy);
    if (km < bestKm) {
      bestKm = km;
      best = district;
    }
  }
  return best ? { district: best, km: bestKm } : null;
}

/**
 * Group POIs by their nearest OSM Stadtteil/Ortsteil (suburb), then
 * quarter/neighbourhood, then village/town. Places with no district point
 * nearby fall back to a fixed 0.02° grid. Every marker carries the number
 * of places in it, including districts with a single place.
 */
export function aggregatePoiDistricts(
  data: ClusterData,
  cellDeg: number,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const unique = new Map<string, DistrictPoint>();
  for (const district of data.districts) {
    const key = districtKey(district);
    if (!unique.has(key)) unique.set(key, district);
  }
  const suburbs: DistrictPoint[] = [];
  const quarters: DistrictPoint[] = [];
  const rural: DistrictPoint[] = [];
  for (const district of unique.values()) {
    if (district.class === "suburb") suburbs.push(district);
    else if (QUARTER_CLASSES.has(district.class)) quarters.push(district);
    else if (RURAL_CLASSES.has(district.class)) rural.push(district);
  }

  const groups = new Map<string, DistrictGroup>();
  const add = (
    key: string,
    lon: number,
    lat: number,
    point: ClusterPoint,
    name?: string,
    districtClass?: DistrictClass,
  ) => {
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.minLon = Math.min(existing.minLon, point.lon);
      existing.minLat = Math.min(existing.minLat, point.lat);
      existing.maxLon = Math.max(existing.maxLon, point.lon);
      existing.maxLat = Math.max(existing.maxLat, point.lat);
      return;
    }
    groups.set(key, {
      key,
      lon,
      lat,
      name,
      districtClass,
      count: 1,
      minLon: point.lon,
      minLat: point.lat,
      maxLon: point.lon,
      maxLat: point.lat,
    });
  };

  for (const point of data.points) {
    if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) continue;
    const fine = nearestDistrict(suburbs, point.lon, point.lat, SUBURB_MAX_KM);
    const quarter = nearestDistrict(quarters, point.lon, point.lat, QUARTER_MAX_KM);
    const coarse = nearestDistrict(rural, point.lon, point.lat, RURAL_MAX_KM);

    // Prefer the Stadtteil, but do not drag a rural place to a suburb
    // that happens to be much farther away than a nearby village.
    let chosen: DistrictPoint | null = null;
    if (fine && (!quarter || fine.km <= quarter.km * 2.5 + 1)
      && (!coarse || fine.km <= coarse.km * 2.5 + 1)) {
      chosen = fine.district;
    } else if (quarter && (!coarse || quarter.km <= coarse.km * 2.5 + 1)) {
      chosen = quarter.district;
    } else if (coarse) {
      chosen = coarse.district;
    }

    if (chosen) {
      add(
        districtKey(chosen),
        chosen.lon,
        chosen.lat,
        point,
        chosen.name,
        chosen.class,
      );
    } else {
      const gx = Math.floor(point.lon / cellDeg);
      const gy = Math.floor(point.lat / cellDeg);
      add(
        `cell:${gx}:${gy}`,
        (gx + 0.5) * cellDeg,
        (gy + 0.5) * cellDeg,
        point,
      );
    }
  }

  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const group of groups.values()) {
    const properties: Record<string, unknown> = {
      key: group.key,
      point_count: group.count,
      // Bounding box of the assigned places, used by the tap handler to
      // fit the actual places instead of guessing from a cell size.
      bounds: [group.minLon, group.minLat, group.maxLon, group.maxLat],
    };
    if (group.name) {
      properties.district_name = group.name;
      properties.district_class = group.districtClass;
    } else {
      properties.cell_deg = cellDeg;
    }
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [group.lon, group.lat],
      },
      properties,
    });
  }
  return { type: "FeatureCollection", features };
}

// ── Warm start ────────────────────────────────────────────────────────
// The whole-city view needs hundreds of tiles; on a fresh app start the
// map would be empty for seconds. Persist the last aggregated district
// markers per view so the same picture appears instantly, then refresh.
const VIEW_KEY = "kugelmaps.poi-view.v2";
const VIEW_VERSION = 2;
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

function sameBbox(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return a.every((value, index) => Math.abs(value - b[index]) < 1e-6);
}

function readViews(): PersistedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { v?: number; views?: PersistedView[] };
    if (parsed?.v !== VIEW_VERSION || !Array.isArray(parsed.views)) return [];
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
      (view) =>
        Math.abs(view.cellDeg - cellDeg) < 1e-9 &&
        !sameBbox(view.bbox, bbox),
    );
    views.unshift({ at: Date.now(), bbox, cellDeg, features: data.features });
    let payload = JSON.stringify({
      v: VIEW_VERSION,
      views: views.slice(0, VIEW_MAX_ENTRIES),
    });
    while (payload.length > VIEW_MAX_BYTES && views.length > 1) {
      views.pop();
      payload = JSON.stringify({
        v: VIEW_VERSION,
        views: views.slice(0, VIEW_MAX_ENTRIES),
      });
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
