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

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 24;

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

const cache = new Map<string, { at: number; data: BusNetwork }>();

function cacheKey(bbox: [number, number, number, number]): string {
  // ~1 km grid so small pans reuse the previous response.
  return bbox.map((n) => (Math.round(n * 100) / 100).toFixed(2)).join(",");
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

/** Fetch routes + stops for bbox = [south, west, north, east], TTL-cached. */
export async function fetchBusNetwork(
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<BusNetwork> {
  const key = cacheKey(bbox);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const [s, w, n, e] = bbox;
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
  cache.set(key, { at: Date.now(), data: network });
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
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
