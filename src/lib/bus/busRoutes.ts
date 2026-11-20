import type { Map as MLMap } from "maplibre-gl";
import type { PoiSelection } from "../poi/types";
import { THEME } from "../theme";
import { overpassQuery, type OverpassElement, type OverpassRelation } from "../overpass";
import {
  deleteBusCacheEntries,
  readBusCache,
  saveBusCacheEntry,
  writeBusCache,
  type StoredBusNetwork,
} from "./busCacheStore";

/**
 * Bus overlay: dedicated bus routes (OSM `route=bus` relations) as thin
 * amber lines plus their stops, next to the blue rail network.
 *
 * Data is viewport-bound via Overpass (routes + stops in one request)
 * and cached by the fetched viewport's coverage, so a pan that stays
 * inside a known area resolves from memory. Rendering is defensive:
 * `ensureBusLayers` can be called repeatedly and restores everything
 * from the current FeatureCollection, which is what the map effect uses
 * to survive style swaps, dropped layers and failed refetches.
 */

export const BUS_SOURCE_ID = "bus-lines-src";
export const BUS_LAYER_ID = "bus-lines";
export const BUS_CASING_LAYER_ID = "bus-lines-casing";
export const BUS_STOP_SOURCE_ID = "bus-stops-src";
export const BUS_STOP_LAYER_ID = "bus-stops";
export const BUS_STOP_HIT_LAYER_ID = "bus-stops-hit";

/** Slightly warmer than the rail blue (THEME.info) — same family, distinct. */
export const BUS_LINE_COLOR = THEME.warn;
export const BUS_MIN_ZOOM = 12;

const CACHE_TTL_MS = 30 * 60_000;
/** An empty response is often a mirror hiccup — retry it soon. */
const EMPTY_CACHE_TTL_MS = 45_000;
const CACHE_MAX = 64;
/** ~5.5 km grid: one fetched cell covers several pans at city zoom. */
const GRID_STEP = 0.05;
/** Rough transfer size of one cell in the prefetch budget. */
const BUS_ROUTE_BYTES = 520;
const BUS_STOP_BYTES = 120;
/** Legacy localStorage key, migrated into IndexedDB on first load. */
const LEGACY_PERSIST_KEY = "kugelmaps.bus-cache.v1";
const PERSIST_MAX_ENTRIES = 6;

export interface BusRouteFeature extends GeoJSON.Feature<GeoJSON.LineString> {
  properties: {
    /** Present for ways taken from a relation (kept for old payloads). */
    routeId?: number;
    /** The OSM way id; used to deduplicate shared streets. */
    wayId: number;
    ref?: string;
    route?: string;
    colour?: string;
  };
}

export interface BusStopFeature extends GeoJSON.Feature<GeoJSON.Point> {
  properties: {
    id: number;
    name?: string;
  };
}

export interface BusNetwork {
  routes: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  stops: GeoJSON.FeatureCollection<GeoJSON.Point>;
}

/**
 * Place-card selection for a tapped bus stop. Bus stops use the same
 * detail card as other OSM places; the node id resolves the exact stop
 * in Nominatim instead of falling back to a reverse-geocoded street.
 */
export function busStopPoiSelection(
  coordinates: readonly [number, number],
  properties: { id?: unknown; name?: unknown } | null | undefined,
): PoiSelection {
  const id = Number(properties?.id);
  const name =
    typeof properties?.name === "string" ? properties.name.trim() : "";
  return {
    lon: coordinates[0],
    lat: coordinates[1],
    ...(Number.isFinite(id) && id > 0
      ? { osmType: "N" as const, osmId: id }
      : {}),
    name: name || "Bus stop",
    category: "Bus stop",
  };
}

const cache = new Map<
  string,
  {
    at: number;
    bbox: [number, number, number, number];
    data: BusNetwork;
    /** Estimated transfer size, used by the moving prefetch buffer. */
    size: number;
  }
>();

export type Bbox = [number, number, number, number];

/**
 * Snap a bbox outward to a coarse grid. The cache is keyed by coverage,
 * but fetching whole cells means one request survives several pans
 * instead of refetching for every small viewport change.
 */
export function snapBboxToGrid(bbox: Bbox, step = GRID_STEP): Bbox {
  return [
    Math.floor(bbox[0] / step) * step,
    Math.floor(bbox[1] / step) * step,
    Math.ceil(bbox[2] / step) * step,
    Math.ceil(bbox[3] / step) * step,
  ];
}

export function bboxContains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[2] <= outer[2] &&
    inner[3] <= outer[3]
  );
}

export function busBboxKey(bbox: Bbox): string {
  return bbox.map((n) => n.toFixed(4)).join(",");
}

export function isEmptyBusNetwork(network: BusNetwork): boolean {
  return network.routes.features.length === 0 && network.stops.features.length === 0;
}

/** Rough transfer size, used only for the prefetch budget. */
export function estimateBusNetworkBytes(network: BusNetwork): number {
  return (
    network.routes.features.length * BUS_ROUTE_BYTES +
    network.stops.features.length * BUS_STOP_BYTES
  );
}

function bboxCenter(bbox: Bbox): [number, number] {
  return [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2];
}

/** Squared distance between cell centres, lon scaled by latitude. */
function cellDistanceSq(a: Bbox, b: Bbox): number {
  const [aLon, aLat] = bboxCenter(a);
  const [bLon, bLat] = bboxCenter(b);
  const scale = Math.cos(((aLat + bLat) / 2) * (Math.PI / 180)) || 1;
  const dx = (aLon - bLon) * scale;
  const dy = aLat - bLat;
  return dx * dx + dy * dy;
}

/**
 * Cells that ring a fetched cell, nearest ring first. Neighbours are the
 * same size as the current cell, so they tile the map without gaps.
 */
export function busPrefetchCells(cell: Bbox, rings: number): Bbox[] {
  const [s, w, n, e] = cell;
  const height = n - s;
  const width = e - w;
  if (height <= 0 || width <= 0 || rings < 1) return [];
  const cells: Bbox[] = [];
  for (let ring = 1; ring <= rings; ring += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      for (let dx = -ring; dx <= ring; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        cells.push([
          s + dy * height,
          w + dx * width,
          n + dy * height,
          e + dx * width,
        ]);
      }
    }
  }
  return cells;
}

/**
 * Order prefetched cells so the direction of travel wins ties and can
 * pull one ring ahead; a stationary map keeps the plain ring order.
 */
export function orderBusPrefetchCells(
  cell: Bbox,
  cells: readonly Bbox[],
  direction: readonly [number, number],
): Bbox[] {
  const [dirLon, dirLat] = direction;
  if (
    !Number.isFinite(dirLon) ||
    !Number.isFinite(dirLat) ||
    (dirLon === 0 && dirLat === 0)
  ) {
    return [...cells];
  }
  const length = Math.hypot(dirLon, dirLat) || 1;
  const ux = dirLon / length;
  const uy = dirLat / length;
  const [originLon, originLat] = bboxCenter(cell);
  const scale = Math.cos((originLat * Math.PI) / 180) || 1;
  const score = (bbox: Bbox) => {
    const [lon, lat] = bboxCenter(bbox);
    const ox = (lon - originLon) * scale;
    const oy = lat - originLat;
    return Math.hypot(ox, oy) - 1.5 * (ox * ux + oy * uy);
  };
  return [...cells].sort((a, b) => score(a) - score(b));
}

/**
 * Keys to evict from a cache that exceeds `maxBytes`, farthest from the
 * current viewport first. The cell covering `keep` is never evicted.
 */
export function selectBusCacheEvictions(
  entries: readonly { key: string; bbox: Bbox; size: number }[],
  center: Bbox,
  maxBytes: number,
  keep?: Bbox,
): string[] {
  let remaining = entries.reduce((sum, entry) => sum + entry.size, 0);
  if (remaining <= maxBytes) return [];
  const candidates = entries
    .filter((entry) => !(keep && bboxContains(entry.bbox, keep)))
    .map((entry) => ({ ...entry, distance: cellDistanceSq(entry.bbox, center) }))
    .sort((a, b) => b.distance - a.distance);
  const evicted: string[] = [];
  for (const entry of candidates) {
    if (remaining <= maxBytes) break;
    evicted.push(entry.key);
    remaining -= entry.size;
  }
  return evicted;
}

function isUsableEntry(entry: unknown): entry is { at: number; bbox: Bbox; data: BusNetwork } {
  const e = entry as { at?: unknown; bbox?: unknown; data?: BusNetwork } | null;
  return (
    typeof e?.at === "number" &&
    Array.isArray(e.bbox) &&
    e.bbox.length === 4 &&
    Array.isArray(e.data?.routes?.features) &&
    Array.isArray(e.data?.stops?.features)
  );
}

/** Fold one persisted entry into the in-memory cache. */
function acceptPersisted(entry: {
  at: number;
  bbox: Bbox;
  data: BusNetwork;
}): void {
  if (!isUsableEntry(entry)) return;
  const key = busBboxKey(entry.bbox);
  const existing = cache.get(key);
  if (!existing || existing.at < entry.at) {
    cache.set(key, {
      at: entry.at,
      bbox: entry.bbox,
      data: entry.data,
      size: estimateBusNetworkBytes(entry.data),
    });
  }
}

function readLegacyCache(): StoredBusNetwork[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_PERSIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      v?: number;
      entries?: { at: number; bbox: Bbox; data: BusNetwork }[];
    };
    if (parsed?.v !== 1 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(isUsableEntry).map((entry) => ({
      key: busBboxKey(entry.bbox),
      at: entry.at,
      bbox: entry.bbox,
      data: entry.data,
    }));
  } catch {
    return [];
  }
}

let persistedLoad: Promise<void> | null = null;

/**
 * Load the persisted cells once per session. The first fetch awaits this
 * so a warm start can answer without the network; later calls reuse the
 * settled promise.
 */
function loadPersistedCache(): Promise<void> {
  if (persistedLoad) return persistedLoad;
  persistedLoad = (async () => {
    try {
      for (const entry of await readBusCache()) acceptPersisted(entry);

      // One-way migration from the old localStorage format.
      const legacy = readLegacyCache();
      if (legacy.length > 0) {
        for (const entry of legacy) acceptPersisted(entry);
        await writeBusCache(snapshotEntries());
        try {
          window.localStorage.removeItem(LEGACY_PERSIST_KEY);
        } catch {
          // Storage disabled: the IndexedDB copy is already written.
        }
      }
    } catch {
      // Storage disabled or blocked: the session cache still works.
    }
  })();
  return persistedLoad;
}

function snapshotEntries(): StoredBusNetwork[] {
  return [...cache.values()]
    .filter((entry) => !isEmptyBusNetwork(entry.data))
    .sort((a, b) => b.at - a.at)
    .slice(0, PERSIST_MAX_ENTRIES)
    .map((entry) => ({
      key: busBboxKey(entry.bbox),
      at: entry.at,
      bbox: entry.bbox,
      data: entry.data,
    }));
}

/** Persist one freshly fetched cell without rewriting the whole cache. */
function persistEntry(bbox: Bbox, at: number, network: BusNetwork): void {
  void saveBusCacheEntry({
    key: busBboxKey(bbox),
    at,
    bbox,
    data: network,
  });
}

/** Estimated bytes currently held by the in-memory cache. */
export function busCacheBytes(): number {
  let total = 0;
  for (const entry of cache.values()) total += entry.size;
  return total;
}

/** True when the cache already covers this viewport (including TTL). */
export function hasBusCacheCoverage(bbox: Bbox): boolean {
  return findCached(bbox, Date.now()) !== null;
}

/**
 * Drop the cells farthest from the current viewport until the budget is
 * met. Runs after each background prefetch, so the buffer moves with the
 * user instead of growing without bound.
 */
export function pruneBusCache(center: Bbox, maxBytes: number, keep?: Bbox): void {
  // Expired cells do not count against the budget; drop them first.
  const now = Date.now();
  for (const [key, entry] of cache) {
    const ttl = isEmptyBusNetwork(entry.data) ? EMPTY_CACHE_TTL_MS : CACHE_TTL_MS;
    if (now - entry.at > ttl) {
      cache.delete(key);
      void deleteBusCacheEntries([key]);
    }
  }
  const entries = [...cache.entries()].map(([key, entry]) => ({
    key,
    bbox: entry.bbox,
    size: entry.size,
  }));
  const evicted = selectBusCacheEvictions(entries, center, maxBytes, keep);
  if (evicted.length === 0) return;
  for (const key of evicted) cache.delete(key);
  void deleteBusCacheEntries(evicted);
}

/** Newest cached network whose coverage contains the requested bbox. */
function findCached(bbox: Bbox, now: number): BusNetwork | null {
  let best: { at: number; data: BusNetwork } | null = null;
  for (const entry of cache.values()) {
    const ttl = isEmptyBusNetwork(entry.data) ? EMPTY_CACHE_TTL_MS : CACHE_TTL_MS;
    if (now - entry.at > ttl) continue;
    if (!bboxContains(entry.bbox, bbox)) continue;
    if (!best || entry.at > best.at) best = entry;
  }
  return best?.data ?? null;
}

type GeometryPoint = { lat: number; lon: number };

/**
 * Convert Overpass geometry to GeoJSON coordinates.
 *
 * `out geom` inserts `null` for points it cannot resolve (deleted nodes,
 * incomplete member ways). Dropping those points keeps every usable
 * segment instead of aborting the whole response, and the bounds check
 * guards against corrupt payloads.
 */
function toLineCoordinates(
  geometry: readonly (GeometryPoint | null | undefined)[],
): [number, number][] {
  const coordinates: [number, number][] = [];
  for (const point of geometry) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
      continue;
    }
    if (point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) {
      continue;
    }
    const last = coordinates[coordinates.length - 1];
    if (last && last[0] === point.lon && last[1] === point.lat) continue;
    coordinates.push([point.lon, point.lat]);
  }
  return coordinates;
}

/**
 * Turn an Overpass response into deduplicated route LineStrings plus stop
 * points.
 *
 * The current query returns clipped ways from `way(r.busRoutes)(bbox)`
 * (one element per way) and stop nodes. Relation members are still
 * understood so payloads cached by older builds keep working. The same
 * street often belongs to several lines; drawing each copy again only
 * adds overdraw, so ways are deduplicated by their OSM way id.
 */
export function parseBusNetwork(
  elements: readonly OverpassElement[],
): BusNetwork {
  const seenWays = new Set<number>();
  const routeFeatures: BusRouteFeature[] = [];
  const stopFeatures: BusStopFeature[] = [];

  const pushWay = (
    wayId: number,
    geometry: readonly (GeometryPoint | null | undefined)[],
    properties: Omit<BusRouteFeature["properties"], "wayId">,
  ) => {
    if (seenWays.has(wayId)) return;
    const coordinates = toLineCoordinates(geometry);
    if (coordinates.length < 2) return;
    seenWays.add(wayId);
    routeFeatures.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates },
      properties: { wayId, ...properties },
    });
  };

  for (const el of elements) {
    if (el.type === "node") {
      if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
      stopFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [el.lon, el.lat] },
        properties: {
          id: el.id,
          ...(el.tags?.name ? { name: el.tags.name } : {}),
        },
      });
      continue;
    }
    if (el.type === "way") {
      if (el.geometry) pushWay(el.id, el.geometry, {});
      continue;
    }
    if (el.type !== "relation") continue;
    const relation = el as OverpassRelation;
    const ref = relation.tags?.ref;
    const route = relation.tags?.route;
    const colour = relation.tags?.colour;
    const properties = {
      routeId: relation.id,
      ...(ref ? { ref } : {}),
      ...(route ? { route } : {}),
      ...(colour ? { colour } : {}),
    };
    for (const member of relation.members ?? []) {
      if (member.type !== "way" || !member.geometry) continue;
      pushWay(member.ref, member.geometry, properties);
    }
  }

  return {
    routes: { type: "FeatureCollection", features: routeFeatures },
    stops: { type: "FeatureCollection", features: stopFeatures },
  };
}

/** Fetch routes + stops for bbox = [south, west, north, east], cached. */
export async function fetchBusNetwork(
  bbox: Bbox,
  signal?: AbortSignal,
  force = false,
): Promise<BusNetwork> {
  await loadPersistedCache();
  const now = Date.now();
  if (!force) {
    const cached = findCached(bbox, now);
    if (cached) return cached;
  }

  // Fetch the snapped cell so nearby pans are covered by one request.
  // `findCached` tests the real viewport against the fetched coverage.
  const fetchBbox = snapBboxToGrid(bbox);
  const [s, w, n, e] = fetchBbox;
  // `way(r.busRoutes)(bbox) + out skel geom(bbox)` sends each member way
  // once, clipped to the viewport, with IDs + geometry but without tags
  // we do not render. That halves a city cell (9.1 MB → 4.6 MB for the
  // Düsseldorf test box) and makes the background buffer affordable.
  const query = `
    [out:json][timeout:25];
    relation[route=bus](${s},${w},${n},${e})->.busRoutes;
    way(r.busRoutes)(${s},${w},${n},${e});
    out skel geom(${s},${w},${n},${e});
    node[highway=bus_stop](${s},${w},${n},${e});
    node[public_transport=stop_position][bus=yes](${s},${w},${n},${e});
    out body;
  `;
  // Client timeout stays above the server's 25 s so a slow-but-valid
  // answer (a city cell is several MB) is not discarded mid-flight.
  const data = await overpassQuery(query, signal, {
    timeoutMs: 30_000,
    rejectEmpty: true,
  });
  const network = parseBusNetwork(data.elements);
  const key = busBboxKey(fetchBbox);
  const at = Date.now();
  cache.set(key, {
    at,
    bbox: fetchBbox,
    data: network,
    size: estimateBusNetworkBytes(network),
  });
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) {
      cache.delete(oldest[0]);
      void deleteBusCacheEntries([oldest[0]]);
    }
  }
  // Empty cells are retried soon; persisting them would only poison a
  // warm start with data that is about to expire.
  if (!isEmptyBusNetwork(network)) persistEntry(fetchBbox, at, network);
  return network;
}

function firstSymbolLayerId(map: MLMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "symbol") return layer.id;
  }
  return undefined;
}

function setOrAddSource(
  map: MLMap,
  id: string,
  data: GeoJSON.FeatureCollection,
): void {
  const source = map.getSource(id) as
    | { setData?: (next: GeoJSON.FeatureCollection) => void }
    | undefined;
  if (source?.setData) source.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

/**
 * Create/update every bus layer. Idempotent: missing layers are added,
 * existing layers get the new data. Safe to call on every re-render,
 * style swap or recovery tick.
 */
export function ensureBusLayers(map: MLMap, network: BusNetwork): void {
  setOrAddSource(map, BUS_SOURCE_ID, network.routes);
  setOrAddSource(map, BUS_STOP_SOURCE_ID, network.stops);

  const beforeId = firstSymbolLayerId(map);

  if (!map.getLayer(BUS_CASING_LAYER_ID)) {
    map.addLayer(
      {
        id: BUS_CASING_LAYER_ID,
        type: "line",
        source: BUS_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": THEME.casing,
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            10, 1.4,
            14, 2.6,
            17, 3.6,
          ],
          "line-opacity": 0.55,
        },
      },
      beforeId,
    );
  }
  if (!map.getLayer(BUS_LAYER_ID)) {
    map.addLayer(
      {
        id: BUS_LAYER_ID,
        type: "line",
        source: BUS_SOURCE_ID,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": BUS_LINE_COLOR,
          "line-width": [
            "interpolate", ["linear"], ["zoom"],
            10, 0.8,
            14, 1.6,
            17, 2.3,
          ],
          "line-opacity": 0.82,
          // Dashed on purpose: bus routes are not fixed track, and the
          // dash keeps them readable next to solid rail lines.
          "line-dasharray": [2, 1.4],
        },
      },
      beforeId,
    );
  }
  if (!map.getLayer(BUS_STOP_LAYER_ID)) {
    map.addLayer(
      {
        id: BUS_STOP_LAYER_ID,
        type: "circle",
        source: BUS_STOP_SOURCE_ID,
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            10, 4,
            12, 5,
            14, 6,
            17, 7,
          ],
          "circle-color": BUS_LINE_COLOR,
          "circle-stroke-color": THEME.casing,
          "circle-stroke-width": 1.7,
        },
      },
      beforeId,
    );
  }
  // Invisible, finger-sized tap target around each stop.
  if (!map.getLayer(BUS_STOP_HIT_LAYER_ID)) {
    map.addLayer(
      {
        id: BUS_STOP_HIT_LAYER_ID,
        type: "circle",
        source: BUS_STOP_SOURCE_ID,
        paint: {
          "circle-radius": 20,
          "circle-color": THEME.casing,
          "circle-opacity": 0,
          "circle-stroke-width": 0,
        },
      },
      beforeId,
    );
  }
}

export function removeBusLayers(map: MLMap): void {
  for (const id of [
    BUS_STOP_HIT_LAYER_ID,
    BUS_STOP_LAYER_ID,
    BUS_LAYER_ID,
    BUS_CASING_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [BUS_SOURCE_ID, BUS_STOP_SOURCE_ID]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}
