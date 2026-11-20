import type { LineLayerSpecification, Map as MLMap } from "maplibre-gl";
import {
  overpassQuery,
  type OverpassElement,
  type OverpassRelation,
} from "../overpass";
import {
  RAIL_KIND_COLORS,
  type RailKind,
} from "../routing/modeColors";

/**
 * Heavy-rail route overlay. The vector tiles only carry infrastructure
 * classes (`rail`, `transit`), so S-Bahn vs. regional vs. long-distance
 * can only come from OSM route relations. This overlay colours those
 * relations on top of the tile-based rail line, which stays visible as a
 * neutral fallback when Overpass is slow or unavailable.
 */
export const RAIL_ROUTE_SOURCE_ID = "rail-route-lines-src";
export const RAIL_ROUTE_LONG_LAYER_ID = "rail-route-long-distance";
export const RAIL_ROUTE_REGIONAL_LAYER_ID = "rail-route-regional";
export const RAIL_ROUTE_SBAHN_LAYER_ID = "rail-route-sbahn";
export const RAIL_ROUTE_MIN_ZOOM = 9;
export const RAIL_ROUTE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · Overpass';

const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 16;
const GRID_STEP = 0.1;

type Bbox = [number, number, number, number];

export interface RailRouteNetwork {
  routes: GeoJSON.FeatureCollection<GeoJSON.LineString>;
}

/** Classify an OSM route relation into the shared rail palette. */
export function classifyRailRoute(
  tags: Record<string, string> | undefined,
): RailKind | null {
  if (!tags) return null;
  const route = (tags.route ?? "").toLowerCase();
  if (route === "subway") return "subway";
  if (route === "tram" || route === "light_rail") return "tram";
  if (route !== "train") return null;

  const ref = (tags.ref ?? "").trim();
  const network = tags.network ?? "";
  const train = (tags.train ?? "").toLowerCase();

  if (
    /s[- ]?bahn/i.test(network) ||
    /^S\s*\d/i.test(ref) ||
    train === "commuter" ||
    train === "suburban"
  ) {
    return "sbahn";
  }
  if (
    train === "national" ||
    train === "international" ||
    train === "highspeed" ||
    /^(IC|ICE|EC|TGV|RJ|NJ|EN|THA|ECE)\b/i.test(ref)
  ) {
    return "longDistance";
  }
  if (
    train === "regional" ||
    train === "regional_express" ||
    /^(RE|RB|IRE|MRB|NWB|VIA|EB)\b/i.test(ref)
  ) {
    return "regional";
  }
  // Unclassified heavy rail keeps the regional colour; it is still a
  // usable railway, just without a confident service class.
  return "regional";
}

const KIND_PRIORITY: Record<RailKind, number> = {
  sbahn: 5,
  regional: 4,
  longDistance: 3,
  subway: 2,
  tram: 1,
  rail: 0,
};

/**
 * Turn `out geom` relations into deduplicated LineStrings. A way shared
 * by several services is drawn once, with the most local/high-priority
 * service (S-Bahn first) so dense corridors stay readable.
 */
export function parseRailRoutes(
  elements: readonly OverpassElement[],
): RailRouteNetwork {
  const best = new Map<
    number,
    { kind: RailKind; coords: [number, number][]; ref?: string }
  >();
  for (const el of elements) {
    if (el.type !== "relation") continue;
    const relation = el as OverpassRelation;
    const kind = classifyRailRoute(relation.tags);
    if (!kind) continue;
    const ref = relation.tags?.ref;
    for (const member of relation.members ?? []) {
      if (member.type !== "way" || !member.geometry || member.geometry.length < 2) {
        continue;
      }
      const coords = member.geometry
        .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon))
        .map((g) => [g.lon, g.lat] as [number, number]);
      if (coords.length < 2) continue;
      const existing = best.get(member.ref);
      if (existing && KIND_PRIORITY[existing.kind] >= KIND_PRIORITY[kind]) {
        continue;
      }
      best.set(member.ref, { kind, coords, ...(ref ? { ref } : {}) });
    }
  }

  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const [wayRef, entry] of best) {
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: entry.coords },
      properties: {
        wayRef,
        kind: entry.kind,
        ...(entry.ref ? { ref: entry.ref } : {}),
      },
    });
  }
  return {
    routes: { type: "FeatureCollection", features },
  };
}

const cache = new Map<string, { at: number; bbox: Bbox; data: RailRouteNetwork }>();

function snapBbox(bbox: Bbox): Bbox {
  return [
    Math.floor(bbox[0] / GRID_STEP) * GRID_STEP,
    Math.floor(bbox[1] / GRID_STEP) * GRID_STEP,
    Math.ceil(bbox[2] / GRID_STEP) * GRID_STEP,
    Math.ceil(bbox[3] / GRID_STEP) * GRID_STEP,
  ];
}

function contains(outer: Bbox, inner: Bbox): boolean {
  return (
    inner[0] >= outer[0] &&
    inner[1] >= outer[1] &&
    inner[2] <= outer[2] &&
    inner[3] <= outer[3]
  );
}

function findCached(bbox: Bbox): RailRouteNetwork | null {
  const wanted = snapBbox(bbox);
  let best: { at: number; data: RailRouteNetwork } | null = null;
  for (const entry of cache.values()) {
    if (Date.now() - entry.at > CACHE_TTL_MS) continue;
    if (!contains(entry.bbox, wanted)) continue;
    if (!best || entry.at > best.at) best = entry;
  }
  return best?.data ?? null;
}

/** Fetch heavy-rail route relations for bbox, cached per coarse cell. */
export async function fetchRailRoutes(
  bbox: Bbox,
  signal?: AbortSignal,
  force = false,
): Promise<RailRouteNetwork> {
  if (!force) {
    const cached = findCached(bbox);
    if (cached) return cached;
  }
  const fetchBbox = snapBbox(bbox);
  const [s, w, n, e] = fetchBbox;
  const query = `
    [out:json][timeout:25];
    relation[route=train](${s},${w},${n},${e});
    out geom;
  `;
  const data = await overpassQuery(query, signal);
  const network = parseRailRoutes(data.elements);
  const key = fetchBbox.map((value) => value.toFixed(4)).join(",");
  cache.set(key, { at: Date.now(), bbox: fetchBbox, data: network });
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

function lineLayer(
  id: string,
  kind: RailKind,
  width: readonly [number, number, number],
): LineLayerSpecification {
  return {
    id,
    type: "line",
    source: RAIL_ROUTE_SOURCE_ID,
    minzoom: RAIL_ROUTE_MIN_ZOOM,
    filter: ["==", ["get", "kind"], kind],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": RAIL_KIND_COLORS[kind],
      "line-width": [
        "interpolate",
        ["linear"],
        ["zoom"],
        9, width[0],
        12, width[1],
        16, width[2],
      ],
      "line-opacity": 0.92,
    },
  };
}

/** Add/refresh the three service-class line layers. Idempotent. */
export function ensureRailRouteLayers(
  map: MLMap,
  network: RailRouteNetwork,
): void {
  const source = map.getSource(RAIL_ROUTE_SOURCE_ID) as
    | { setData?: (data: GeoJSON.FeatureCollection) => void }
    | undefined;
  if (source?.setData) source.setData(network.routes);
  else {
    map.addSource(RAIL_ROUTE_SOURCE_ID, {
      type: "geojson",
      data: network.routes,
      attribution: RAIL_ROUTE_ATTRIBUTION,
    });
  }

  const beforeId = firstSymbolLayerId(map);
  const layers: [string, RailKind, [number, number, number]][] = [
    [RAIL_ROUTE_LONG_LAYER_ID, "longDistance", [1.2, 2.4, 3.2]],
    [RAIL_ROUTE_REGIONAL_LAYER_ID, "regional", [1.4, 2.8, 3.6]],
    [RAIL_ROUTE_SBAHN_LAYER_ID, "sbahn", [1.6, 3.2, 4.0]],
  ];
  for (const [id, kind, width] of layers) {
    if (!map.getLayer(id)) {
      map.addLayer(lineLayer(id, kind, width), beforeId);
    }
  }
}

export function removeRailRouteLayers(map: MLMap): void {
  for (const id of [
    RAIL_ROUTE_SBAHN_LAYER_ID,
    RAIL_ROUTE_REGIONAL_LAYER_ID,
    RAIL_ROUTE_LONG_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(RAIL_ROUTE_SOURCE_ID)) {
    map.removeSource(RAIL_ROUTE_SOURCE_ID);
  }
}
