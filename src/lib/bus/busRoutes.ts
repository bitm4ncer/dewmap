import type { Map as MLMap } from "maplibre-gl";
import { THEME } from "../theme";
import { overpassQuery, type OverpassElement, type OverpassRelation } from "../overpass";

/**
 * Bus-line overlay: dedicated bus routes (OSM `route=bus` relations) as
 * thin amber lines next to the blue rail network. Data is viewport-bound
 * via Overpass and cached per coarse bbox so panning does not refetch.
 */

export const BUS_SOURCE_ID = "bus-lines-src";
export const BUS_LAYER_ID = "bus-lines";
export const BUS_CASING_LAYER_ID = "bus-lines-casing";

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

const cache = new Map<string, { at: number; data: GeoJSON.FeatureCollection<GeoJSON.LineString> }>();

function cacheKey(bbox: [number, number, number, number]): string {
  // ~1 km grid so small pans reuse the previous response.
  return bbox.map((n) => (Math.round(n * 100) / 100).toFixed(2)).join(",");
}

/**
 * Turn an Overpass `out geom` response into deduplicated LineStrings.
 * The same way often belongs to several bus relations (shared streets);
 * drawing each copy again only adds overdraw, so ways are deduplicated by
 * their member ref while keeping the first relation's line label.
 */
export function parseBusRoutes(
  elements: readonly OverpassElement[],
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const seenWays = new Set<number>();
  const features: BusRouteFeature[] = [];
  for (const el of elements) {
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
      features.push({
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
  return { type: "FeatureCollection", features };
}

/** Fetch bus routes for bbox = [south, west, north, east], with a TTL cache. */
export async function fetchBusRoutes(
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<GeoJSON.FeatureCollection<GeoJSON.LineString>> {
  const key = cacheKey(bbox);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const [s, w, n, e] = bbox;
  const query = `
    [out:json][timeout:25];
    relation[route=bus](${s},${w},${n},${e});
    out geom;
  `;
  const data = await overpassQuery(query, signal);
  const collection = parseBusRoutes(data.elements);
  cache.set(key, { at: Date.now(), data: collection });
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return collection;
}

function firstSymbolLayerId(map: MLMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "symbol") return layer.id;
  }
  return undefined;
}

/** Create/update the bus line layers, kept just under the label layers. */
export function ensureBusLayers(
  map: MLMap,
  data: GeoJSON.FeatureCollection<GeoJSON.LineString>,
): void {
  const source = map.getSource(BUS_SOURCE_ID) as
    | { setData?: (next: GeoJSON.FeatureCollection) => void }
    | undefined;
  if (source?.setData) {
    source.setData(data);
  } else {
    map.addSource(BUS_SOURCE_ID, { type: "geojson", data });
  }

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
}

export function removeBusLayers(map: MLMap): void {
  for (const id of [BUS_LAYER_ID, BUS_CASING_LAYER_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(BUS_SOURCE_ID)) map.removeSource(BUS_SOURCE_ID);
}
