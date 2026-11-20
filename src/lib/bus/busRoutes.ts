import type { Map as MLMap } from "maplibre-gl";
import { THEME } from "../theme";
import { overpassQuery, type OverpassElement, type OverpassRelation } from "../overpass";

/**
 * Bus overlay: dedicated bus routes (OSM `route=bus` relations) as thin
 * amber lines plus their stops, next to the blue rail network.
 *
 * Data is viewport-bound via Overpass (routes + stops in one request)
 * and cached per coarse bbox. Rendering is defensive: `ensureBusLayers`
 * can be called repeatedly and restores everything from the current
 * FeatureCollection, which is what the map effect uses to survive style
 * swaps, dropped layers and failed refetches.
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
const CACHE_MAX = 32;
/** ~5.5 km grid: the same cell survives typical pans and pinch zooms. */
const GRID_STEP = 0.05;
const PERSIST_KEY = "kugelmaps.bus-cache.v1";
const PERSIST_MAX_ENTRIES = 4;
const PERSIST_MAX_BYTES = 1_800_000;

export interface BusRouteFeature extends GeoJSON.Feature<GeoJSON.LineString> {
  properties: {
    routeId: number;
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

const cache = new Map<
  string,
  { at: number; bbox: [number, number, number, number]; data: BusNetwork }
>();

export type Bbox = [number, number, number, number];

/**
 * Snap a bbox outward to a coarse grid. Without this every pan produces
 * a new key and refetches the (expensive) Overpass query.
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

function bboxKey(bbox: Bbox): string {
  return bbox.map((n) => n.toFixed(4)).join(",");
}

function isEmptyNetwork(network: BusNetwork): boolean {
  return network.routes.features.length === 0 && network.stops.features.length === 0;
}

let persistedLoaded = false;

function loadPersistedCache(): void {
  if (persistedLoaded) return;
  persistedLoaded = true;
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      v?: number;
      entries?: { at: number; bbox: Bbox; data: BusNetwork }[];
    };
    if (parsed?.v !== 1 || !Array.isArray(parsed.entries)) return;
    for (const entry of parsed.entries) {
      if (!entry?.bbox || !entry.data?.routes || !entry.data?.stops) continue;
      cache.set(bboxKey(entry.bbox), entry);
    }
  } catch {
    // Storage disabled or malformed — the in-memory cache still works.
  }
}

function persistCache(): void {
  if (typeof window === "undefined") return;
  try {
    const entries = [...cache.values()]
      .sort((a, b) => b.at - a.at)
      .slice(0, PERSIST_MAX_ENTRIES);
    let payload = JSON.stringify({ v: 1, entries });
    while (payload.length > PERSIST_MAX_BYTES && entries.length > 1) {
      entries.pop();
      payload = JSON.stringify({ v: 1, entries });
    }
    if (payload.length > PERSIST_MAX_BYTES) return;
    window.localStorage.setItem(PERSIST_KEY, payload);
  } catch {
    // Quota or privacy mode: silently keep the session cache.
  }
}

/** Newest cached network whose coverage contains the requested bbox. */
function findCached(bbox: Bbox, now: number): BusNetwork | null {
  const wanted = snapBboxToGrid(bbox);
  let best: { at: number; data: BusNetwork } | null = null;
  for (const entry of cache.values()) {
    const ttl = isEmptyNetwork(entry.data) ? EMPTY_CACHE_TTL_MS : CACHE_TTL_MS;
    if (now - entry.at > ttl) continue;
    if (!bboxContains(entry.bbox, wanted)) continue;
    if (!best || entry.at > best.at) best = entry;
  }
  return best?.data ?? null;
}

/**
 * Turn an Overpass `out geom` response into deduplicated route
 * LineStrings plus stop points. The same way often belongs to several
 * bus relations (shared streets); drawing each copy again only adds
 * overdraw, so ways are deduplicated by their member ref.
 */
export function parseBusNetwork(
  elements: readonly OverpassElement[],
): BusNetwork {
  const seenWays = new Set<number>();
  const routeFeatures: BusRouteFeature[] = [];
  const stopFeatures: BusStopFeature[] = [];

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
    if (el.type !== "relation") continue;
    const relation = el as OverpassRelation;
    const ref = relation.tags?.ref;
    const route = relation.tags?.route;
    const colour = relation.tags?.colour;
    for (const member of relation.members ?? []) {
      if (member.type !== "way" || !member.geometry || member.geometry.length < 2) {
        continue;
      }
      if (seenWays.has(member.ref)) continue;
      seenWays.add(member.ref);
      routeFeatures.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: member.geometry.map((g) => [g.lon, g.lat]),
        },
        properties: {
          routeId: relation.id,
          ...(ref ? { ref } : {}),
          ...(route ? { route } : {}),
          ...(colour ? { colour } : {}),
        },
      });
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
  loadPersistedCache();
  const now = Date.now();
  if (!force) {
    const cached = findCached(bbox, now);
    if (cached) return cached;
  }

  const fetchBbox = snapBboxToGrid(bbox);
  const [s, w, n, e] = fetchBbox;
  // One request: route relations carry their geometry, stops are nodes.
  const query = `
    [out:json][timeout:25];
    (
      relation[route=bus](${s},${w},${n},${e});
      node[highway=bus_stop](${s},${w},${n},${e});
      node[public_transport=stop_position][bus=yes](${s},${w},${n},${e});
    );
    out geom;
  `;
  const data = await overpassQuery(query, signal);
  const network = parseBusNetwork(data.elements);
  const key = bboxKey(fetchBbox);
  cache.set(key, { at: Date.now(), bbox: fetchBbox, data: network });
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  persistCache();
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
            11, 2.4,
            14, 3,
            17, 3.6,
          ],
          "circle-color": BUS_LINE_COLOR,
          "circle-stroke-color": THEME.casing,
          "circle-stroke-width": 1.2,
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
          "circle-radius": 15,
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
