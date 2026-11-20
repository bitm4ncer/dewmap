import type { Map as MLMap } from "maplibre-gl";
import type {
  ExpressionSpecification,
  FilterSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { THEME } from "../theme";

/**
 * Google-Maps-style POI dots on top of any basemap. The data comes from
 * OpenFreeMap's OpenMapTiles `poi` layer, so it is viewport-tiled and
 * zoom-filtered instead of being fetched per area via Overpass.
 */
export const POI_SOURCE_ID = "poi-vector-src";
export const POI_ICON_LAYER_ID = "poi-icons";
export const POI_LABEL_LAYER_ID = "poi-labels";
export const POI_HIT_LAYER_ID = "poi-hit";
export const SELECTION_RING_SOURCE_ID = "selection-ring-src";
export const SELECTION_RING_HALO_LAYER_ID = "selection-ring-halo";
export const SELECTION_RING_LAYER_ID = "selection-ring";
export const POI_MIN_ZOOM = 14;
/** Dots carry every place between clusters and icons (no collision). */
export const POI_DOT_LAYER_ID = "poi-mini-dots";
export const POI_ICON_MIN_ZOOM = 16.5;
export const POI_LABEL_MIN_ZOOM = 15;
export const POI_TILEJSON_URL = "https://tiles.openfreemap.org/planet";
export const POI_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> · &copy; OpenStreetMap contributors';

const FOOD = [
  "restaurant",
  "fast_food",
  "cafe",
  "bar",
  "pub",
  "beer",
  "food",
  "ice_cream",
  "biergarten",
];
const SHOP = [
  "shop",
  "grocery",
  "convenience",
  "supermarket",
  "marketplace",
  "mall",
  "department_store",
  "bakery",
  "butcher",
  "florist",
  "clothes",
  "clothing_store",
  "fashion",
  "gift",
  "jewelry",
  "shoes",
  "books",
  "electronics",
  "hardware",
  "furniture",
  "sports",
];
const CULTURE = [
  "museum",
  "attraction",
  "art",
  "artwork",
  "art_gallery",
  "gallery",
  "monument",
  "viewpoint",
  "zoo",
  "theme_park",
  "cinema",
  "theatre",
  "music",
  "tourism",
];
const SPORT = [
  "sport",
  "stadium",
  "swimming_pool",
  "fitness_centre",
  "sports_centre",
  "pitch",
  "golf",
  "ski",
  "climbing",
];
const SPACE = [
  "park",
  "garden",
  "dog_park",
  // "playground" is deliberately excluded: almost every residential
  // courtyard has one, which littered normal apartment blocks with tree
  // icons and (with the generous tap tolerance) stole taps meant for
  // nearby places. They are not navigation destinations.
  "community",
  "library",
  "coworking",
  "town_hall",
];
type PoiKind = "food" | "shop" | "culture" | "sport" | "space" | "default";

const ICONS: Record<PoiKind, { id: string; color: string }> = {
  food: { id: "poi-food", color: THEME.danger },
  shop: { id: "poi-shop", color: THEME.warn },
  culture: { id: "poi-culture", color: THEME.info },
  sport: { id: "poi-sport", color: THEME.accent },
  space: { id: "poi-space", color: THEME.lightRail },
  default: { id: "poi-default", color: THEME.inkDim },
};

function drawIcon(kind: PoiKind): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = ICONS[kind].color;
  ctx.beginPath();
  ctx.arc(32, 32, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = THEME.casing;
  ctx.stroke();

  ctx.strokeStyle = THEME.white;
  ctx.fillStyle = THEME.white;
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (kind) {
    case "food":
      // Fork
      ctx.beginPath();
      ctx.moveTo(24, 22);
      ctx.lineTo(24, 42);
      ctx.moveTo(20, 22);
      ctx.lineTo(20, 31);
      ctx.quadraticCurveTo(24, 35, 28, 31);
      ctx.lineTo(28, 22);
      ctx.stroke();
      // Knife
      ctx.beginPath();
      ctx.moveTo(40, 22);
      ctx.quadraticCurveTo(46, 28, 40, 36);
      ctx.lineTo(40, 42);
      ctx.stroke();
      break;
    case "shop":
      // Bag
      ctx.beginPath();
      ctx.roundRect(20, 27, 24, 19, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(32, 27, 7, Math.PI, 0);
      ctx.stroke();
      break;
    case "culture":
      // Museum: roof, columns, base
      ctx.beginPath();
      ctx.moveTo(17, 27);
      ctx.lineTo(32, 18);
      ctx.lineTo(47, 27);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(22, 31);
      ctx.lineTo(22, 43);
      ctx.moveTo(32, 31);
      ctx.lineTo(32, 43);
      ctx.moveTo(42, 31);
      ctx.lineTo(42, 43);
      ctx.moveTo(18, 46);
      ctx.lineTo(46, 46);
      ctx.stroke();
      break;
    case "sport":
      // Ball
      ctx.beginPath();
      ctx.arc(32, 32, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(32, 21);
      ctx.quadraticCurveTo(38, 27, 32, 32);
      ctx.quadraticCurveTo(26, 37, 32, 43);
      ctx.stroke();
      break;
    case "space":
      // Tree
      ctx.beginPath();
      ctx.moveTo(32, 18);
      ctx.lineTo(22, 33);
      ctx.lineTo(27, 33);
      ctx.lineTo(19, 44);
      ctx.lineTo(45, 44);
      ctx.lineTo(37, 33);
      ctx.lineTo(42, 33);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(32, 44);
      ctx.lineTo(32, 49);
      ctx.stroke();
      break;
    default:
      ctx.beginPath();
      ctx.arc(32, 32, 7, 0, Math.PI * 2);
      ctx.fill();
  }

  return ctx.getImageData(0, 0, 64, 64);
}

function ensureIcons(map: MLMap) {
  for (const kind of Object.keys(ICONS) as PoiKind[]) {
    const spec = ICONS[kind];
    if (map.hasImage(spec.id)) continue;
    const image = drawIcon(kind);
    if (image) map.addImage(spec.id, image, { pixelRatio: 2 });
  }
}

/**
 * Unnamed green space (courtyard gardens, mini parks, unnamed woods) is
 * already conveyed by the basemap's green polygons; dots for it turned
 * every residential block into confetti. Named green places stay, and
 * building-like space POIs (library, town hall, community centre) show
 * regardless of name.
 */
const NAMED_ONLY = ["park", "garden", "dog_park"];
const SPACE_FREE = SPACE.filter((c) => !NAMED_ONLY.includes(c));

const categoryFilter = [
  "any",
  ["in", ["get", "class"], ["literal", [...FOOD, ...SHOP, ...CULTURE, ...SPORT]]],
  ["in", ["get", "subclass"], ["literal", [...FOOD, ...SHOP, ...CULTURE, ...SPORT]]],
  ["in", ["get", "class"], ["literal", SPACE_FREE]],
  ["in", ["get", "subclass"], ["literal", SPACE_FREE]],
  [
    "all",
    ["in", ["get", "class"], ["literal", NAMED_ONLY]],
    ["has", "name"],
    ["!=", ["get", "name"], ""],
  ],
  [
    "all",
    ["in", ["get", "subclass"], ["literal", NAMED_ONLY]],
    ["has", "name"],
    ["!=", ["get", "name"], ""],
  ],
] as FilterSpecification;

const iconExpression = [
  "case",
  [
    "any",
    ["in", ["get", "class"], ["literal", FOOD]],
    ["in", ["get", "subclass"], ["literal", FOOD]],
  ],
  ICONS.food.id,
  [
    "any",
    ["in", ["get", "class"], ["literal", SHOP]],
    ["in", ["get", "subclass"], ["literal", SHOP]],
  ],
  ICONS.shop.id,
  [
    "any",
    ["in", ["get", "class"], ["literal", CULTURE]],
    ["in", ["get", "subclass"], ["literal", CULTURE]],
  ],
  ICONS.culture.id,
  [
    "any",
    ["in", ["get", "class"], ["literal", SPORT]],
    ["in", ["get", "subclass"], ["literal", SPORT]],
  ],
  ICONS.sport.id,
  [
    "any",
    ["in", ["get", "class"], ["literal", SPACE]],
    ["in", ["get", "subclass"], ["literal", SPACE]],
  ],
  ICONS.space.id,
  ICONS.default.id,
] as ExpressionSpecification;

export function ensurePoiLayers(map: MLMap) {
  if (!map.getSource(POI_SOURCE_ID)) {
    map.addSource(POI_SOURCE_ID, {
      type: "vector",
      url: POI_TILEJSON_URL,
      maxzoom: 14,
      attribution: POI_ATTRIBUTION,
    });
  }

  ensureIcons(map);

  // Dots exist at every zoom from 14 on: they are the stable base
  // marker (and keep places visible when an icon is culled). Icons sit
  // on top from 16.5, labels join early at 15 so names grow with the
  // zoom instead of appearing suddenly.
  if (!map.getLayer(POI_DOT_LAYER_ID)) {
    map.addLayer(
      {
        id: POI_DOT_LAYER_ID,
        type: "circle",
        source: POI_SOURCE_ID,
        "source-layer": "poi",
        minzoom: POI_MIN_ZOOM,
        filter: categoryFilter,
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            15, 3.2,
            16.5, 4.6,
          ],
          "circle-color": [
            "case",
            ["any", ["in", ["get", "class"], ["literal", FOOD]], ["in", ["get", "subclass"], ["literal", FOOD]]], THEME.danger,
            ["any", ["in", ["get", "class"], ["literal", SHOP]], ["in", ["get", "subclass"], ["literal", SHOP]]], THEME.warn,
            ["any", ["in", ["get", "class"], ["literal", CULTURE]], ["in", ["get", "subclass"], ["literal", CULTURE]]], THEME.info,
            ["any", ["in", ["get", "class"], ["literal", SPORT]], ["in", ["get", "subclass"], ["literal", SPORT]]], THEME.accent,
            THEME.lightRail,
          ],
          "circle-stroke-color": THEME.casing,
          "circle-stroke-width": 1,
        },
      },
    );
  }

  if (!map.getLayer(POI_ICON_LAYER_ID)) {
    map.addLayer(
      {
        id: POI_ICON_LAYER_ID,
        type: "symbol",
        source: POI_SOURCE_ID,
        "source-layer": "poi",
        minzoom: POI_ICON_MIN_ZOOM,
        filter: categoryFilter,
        layout: {
          "icon-image": iconExpression,
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            15,
            0.52,
            17,
            0.64,
            19,
            0.76,
          ],
          "icon-allow-overlap": false,
          "icon-ignore-placement": false,
          "icon-padding": 2,
          "symbol-sort-key": ["coalesce", ["get", "rank"], 0],
        },
      },
    );
  }

  if (!map.getLayer(POI_LABEL_LAYER_ID)) {
    map.addLayer(
      {
        id: POI_LABEL_LAYER_ID,
        type: "symbol",
        source: POI_SOURCE_ID,
        "source-layer": "poi",
        minzoom: POI_LABEL_MIN_ZOOM,
        filter: categoryFilter,
        layout: {
          "text-field": [
            "coalesce",
            ["get", "name:latin"],
            ["get", "name_en"],
            ["get", "name"],
            "",
          ],
          "text-font": poiTextFont(map),
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            15,
            9.5,
            17,
            11,
            19,
            12.5,
            21,
            13,
          ],
          "text-max-width": 8,
          "text-offset": [0, 1.35],
          "text-anchor": "top",
          "text-optional": true,
          "text-allow-overlap": false,
          "text-padding": 2,
          "symbol-sort-key": ["coalesce", ["get", "rank"], 0],
        },
        paint: {
          "text-color": THEME.ink,
          "text-halo-color": THEME.casing,
          "text-halo-width": 1.6,
          "text-halo-blur": 0.3,
        },
      },
    );
  }

  // Invisible, larger touch target. Keep it above the icons so a tap
  // does not have to land on the 18–24 px glyph itself. On top of this,
  // the feature-tap pipeline adds extra pixel tolerance around it.
  if (!map.getLayer(POI_HIT_LAYER_ID)) {
    map.addLayer({
      id: POI_HIT_LAYER_ID,
      type: "circle",
      source: POI_SOURCE_ID,
      "source-layer": "poi",
      minzoom: POI_MIN_ZOOM,
      filter: categoryFilter,
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          15,
          22,
          18,
          26,
        ],
        "circle-color": "rgba(0,0,0,0.01)",
        "circle-stroke-width": 0,
      },
    });
  }
}

export function removePoiLayers(map: MLMap) {
  for (const id of [
    POI_HIT_LAYER_ID,
    POI_LABEL_LAYER_ID,
    POI_ICON_LAYER_ID,
    POI_DOT_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(POI_SOURCE_ID)) map.removeSource(POI_SOURCE_ID);
  for (const spec of Object.values(ICONS)) {
    if (map.hasImage(spec.id)) map.removeImage(spec.id);
  }
}

// ── Selection ring ────────────────────────────────────────────────────
// A static ring around every active selection: the place detail, transit
// from/to/via, and the last tapped rail/tram/bus stop. The dark halo
// keeps it visible on light basemaps; the light ring does the same on
// dark/satellite ones. Both are screen-space circles, so they follow the
// points at every zoom without re-fetching anything.

const selectionRadius = [
  "interpolate",
  ["linear"],
  ["zoom"],
  14, 12,
  18, 17,
] as ExpressionSpecification;

export function ensureSelectionRingLayers(map: MLMap) {
  if (!map.getSource(SELECTION_RING_SOURCE_ID)) {
    map.addSource(SELECTION_RING_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
  }
  if (!map.getLayer(SELECTION_RING_HALO_LAYER_ID)) {
    map.addLayer({
      id: SELECTION_RING_HALO_LAYER_ID,
      type: "circle",
      source: SELECTION_RING_SOURCE_ID,
      paint: {
        "circle-radius": selectionRadius,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": THEME.casing,
        "circle-stroke-width": 5,
        "circle-stroke-opacity": 0.55,
      },
    });
  }
  if (!map.getLayer(SELECTION_RING_LAYER_ID)) {
    map.addLayer({
      id: SELECTION_RING_LAYER_ID,
      type: "circle",
      source: SELECTION_RING_SOURCE_ID,
      paint: {
        "circle-radius": selectionRadius,
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": THEME.ink,
        "circle-stroke-width": 2.4,
      },
    });
  }
}

export interface SelectionRingPoint {
  lon: number;
  lat: number;
}

/** Point the ring at every active selection; an empty list clears it. */
export function updateSelectionRing(
  map: MLMap,
  selections: readonly SelectionRingPoint[],
): void {
  ensureSelectionRingLayers(map);
  const seen = new Set<string>();
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const selection of selections) {
    if (!Number.isFinite(selection.lon) || !Number.isFinite(selection.lat)) continue;
    const key = `${selection.lon.toFixed(5)}:${selection.lat.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [selection.lon, selection.lat],
      },
      properties: {},
    });
  }
  const source = map.getSource(SELECTION_RING_SOURCE_ID) as
    | { setData?: (data: GeoJSON.FeatureCollection) => void }
    | undefined;
  source?.setData?.({ type: "FeatureCollection", features });
  // Keep the ring above dots/icons/labels after a style or zoom re-add.
  for (const id of [SELECTION_RING_HALO_LAYER_ID, SELECTION_RING_LAYER_ID]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

// ── Kind filters (Gastro / Shopping / Culture / Sport / Parks) ────────

export type PoiKindFilter = "food" | "shop" | "culture" | "sport" | "space";

export const POI_KIND_FILTERS: {
  id: PoiKindFilter;
  label: string;
  classes: readonly string[];
}[] = [
  { id: "food", label: "Food", classes: FOOD },
  { id: "shop", label: "Shopping", classes: SHOP },
  { id: "culture", label: "Culture", classes: CULTURE },
  { id: "sport", label: "Sport", classes: SPORT },
  { id: "space", label: "Parks & public", classes: SPACE },
];

function classesForKinds(kinds: readonly PoiKindFilter[]): string[] {
  if (kinds.length === 0) return [];
  const out: string[] = [];
  for (const id of kinds) {
    const spec = POI_KIND_FILTERS.find((k) => k.id === id);
    if (spec) out.push(...spec.classes);
  }
  return out;
}

/** Layer filter = category filter AND the selected kind chips. */
export function poiLayerFilter(
  kinds: readonly PoiKindFilter[],
): FilterSpecification {
  const classes = classesForKinds(kinds);
  if (classes.length === 0) return categoryFilter;
  return [
    "all",
    categoryFilter,
    [
      "any",
      ["in", ["get", "class"], ["literal", classes]],
      ["in", ["get", "subclass"], ["literal", classes]],
    ],
  ] as FilterSpecification;
}

/** Apply the kind chips to all detail layers (no-op when layers absent). */
export function applyPoiKindFilters(
  map: MLMap,
  kinds: readonly PoiKindFilter[],
): void {
  const filter = poiLayerFilter(kinds);
  for (const id of [
    POI_DOT_LAYER_ID,
    POI_ICON_LAYER_ID,
    POI_LABEL_LAYER_ID,
    POI_HIT_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.setFilter(id, filter);
  }
}

/**
 * Pure mirror of the layer filter for cluster aggregation and tests.
 * Keep the NAMED_ONLY rule in sync with `categoryFilter`.
 */
export function featureMatchesKinds(
  props: Record<string, unknown>,
  kinds: readonly PoiKindFilter[] = [],
): boolean {
  const cls = typeof props.class === "string" ? props.class : "";
  const sub = typeof props.subclass === "string" ? props.subclass : "";
  const name = typeof props.name === "string" ? props.name.trim() : "";
  const base = [...FOOD, ...SHOP, ...CULTURE, ...SPORT, ...SPACE_FREE];
  const matchesBase = base.includes(cls) || base.includes(sub);
  const matchesNamed =
    (NAMED_ONLY.includes(cls) || NAMED_ONLY.includes(sub)) && name !== "";
  if (!matchesBase && !matchesNamed) return false;
  if (kinds.length === 0) return true;
  const classes = classesForKinds(kinds);
  return classes.includes(cls) || classes.includes(sub);
}

// ── City-overview clusters ────────────────────────────────────────────
// OpenFreeMap's poi layer is only dense at z14. The cluster GeoJSON is
// built in `poiClusterData.ts` by fetching and decoding z14 tiles
// directly (MapLibre skips tile zooms below a source's minzoom, so a
// pinned vector source cannot feed a z12 map).

export const POI_CLUSTER_DATA_SOURCE_ID = "poi-cluster-data-src";
export const POI_CLUSTER_CIRCLE_LAYER_ID = "poi-cluster-circles";
export const POI_CLUSTER_COUNT_LAYER_ID = "poi-cluster-count";
export const POI_CLUSTER_NAME_LAYER_ID = "poi-cluster-names";
export const POI_CLUSTER_MIN_ZOOM = 10;
export const POI_CLUSTER_MAX_ZOOM = POI_MIN_ZOOM;
/** Stop building at this zoom — clusters hand over to detail dots. */
export const POI_CLUSTER_BUILD_MAX_ZOOM = POI_CLUSTER_MAX_ZOOM;

/**
 * A font stack that actually exists in the active basemap's glyph set.
 * Glyph providers use different names for the same families:
 *   CARTO/cartocdn  Open Sans Bold, Noto Sans Regular
 *   OpenFreeMap     Noto Sans Bold / Regular
 *   protomaps       Noto Sans Medium / Regular
 *   VersaTiles      noto_sans_bold / noto_sans_regular
 *   OHM             OpenHistorical Bold / OpenHistorical
 */
export function poiTextFont(map: MLMap, bold = false): string[] {
  const glyphs = map.getStyle()?.glyphs ?? "";
  // Always a single family. MapLibre interpolates a multi-font array into
  // one comma-separated URL (`.../Noto Sans Medium,Noto Sans Regular/...`);
  // several glyph CDNs (protomaps, VersaTiles, OHM) only serve single
  // family names and return 404 for the combined stack.
  if (glyphs.includes("openhistoricalmap")) {
    return bold ? ["OpenHistorical Bold"] : ["OpenHistorical"];
  }
  if (glyphs.includes("versatiles")) {
    return bold ? ["noto_sans_bold"] : ["noto_sans_regular"];
  }
  if (glyphs.includes("cartocdn")) {
    return bold ? ["Open Sans Bold"] : ["Noto Sans Regular"];
  }
  if (glyphs.includes("protomaps")) {
    return bold ? ["Noto Sans Medium"] : ["Noto Sans Regular"];
  }
  return bold ? ["Noto Sans Bold"] : ["Noto Sans Regular"];
}

export function ensurePoiClusterLayers(map: MLMap) {
  if (!map.getSource(POI_CLUSTER_DATA_SOURCE_ID)) {
    map.addSource(POI_CLUSTER_DATA_SOURCE_ID, {
      type: "geojson",
      // Pre-aggregated Stadtteil markers (see aggregatePoiDistricts):
      // deliberately no supercluster hierarchy, so each district is
      // exactly one counted marker.
      data: { type: "FeatureCollection", features: [] },
    });
  }

  if (!map.getLayer(POI_CLUSTER_CIRCLE_LAYER_ID)) {
    map.addLayer({
      id: POI_CLUSTER_CIRCLE_LAYER_ID,
      type: "circle",
      source: POI_CLUSTER_DATA_SOURCE_ID,
      minzoom: POI_CLUSTER_MIN_ZOOM,
      maxzoom: POI_CLUSTER_MAX_ZOOM,
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": [
          "step",
          ["get", "point_count"],
          7,
          10, 9,
          50, 11,
          200, 13,
          600, 15,
        ],
        "circle-color": THEME.accent,
        "circle-opacity": 0.9,
        "circle-stroke-color": THEME.casing,
        "circle-stroke-width": 2,
      },
    });
  }
  // The Stadtteil name sits just below the circle. Some vector basemaps
  // label districts themselves and some do not; showing our name in both
  // cases guarantees the marker is identifiable (with a halo over any
  // duplicate basemap label).
  if (!map.getLayer(POI_CLUSTER_NAME_LAYER_ID)) {
    map.addLayer({
      id: POI_CLUSTER_NAME_LAYER_ID,
      type: "symbol",
      source: POI_CLUSTER_DATA_SOURCE_ID,
      // Counts start at 10; names join at the city view (12) so the
      // regional band stays calm instead of stacking every district name.
      minzoom: POI_CLUSTER_MIN_ZOOM + 2,
      maxzoom: POI_CLUSTER_MAX_ZOOM,
      filter: ["all", ["has", "point_count"], ["has", "district_name"]],
      layout: {
        "text-field": ["get", "district_name"],
        "text-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          9,
          13,
          11,
        ],
        "text-font": poiTextFont(map),
        "text-anchor": "top",
        "text-offset": [0, 1.6],
        // A district name must never disappear because a basemap label
        // (or a neighbouring count) reserved its slot. The halo keeps it
        // readable over both.
        "text-allow-overlap": true,
        "text-padding": 3,
        // Lower sort values are placed first. Invert the count so the
        // biggest districts are drawn first when names overlap.
        "symbol-sort-key": ["-", 0, ["get", "point_count"]],
      },
      paint: {
        "text-color": THEME.ink,
        "text-halo-color": THEME.casing,
        "text-halo-width": 1.5,
        "text-halo-blur": 0.3,
      },
    });
  }
  if (!map.getLayer(POI_CLUSTER_COUNT_LAYER_ID)) {
    map.addLayer({
      id: POI_CLUSTER_COUNT_LAYER_ID,
      type: "symbol",
      source: POI_CLUSTER_DATA_SOURCE_ID,
      minzoom: POI_CLUSTER_MIN_ZOOM,
      maxzoom: POI_CLUSTER_MAX_ZOOM,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count"],
        "text-size": 9,
        "text-font": poiTextFont(map, true),
        // Centre the digits in the circle; the font box carries
        // descender space, which otherwise pushes them slightly high.
        "text-anchor": "center",
        "text-justify": "center",
        "text-offset": [0, 0.08],
        // The count is the primary information. It must not be culled
        // by a basemap label that happens to sit on the same district
        // point, so allow it to overlap.
        "text-allow-overlap": true,
        "text-padding": 2,
        "symbol-sort-key": ["-", 0, ["get", "point_count"]],
      },
      paint: {
        "text-color": THEME.accentInk,
      },
    });
  }
}

export function removePoiClusterLayers(map: MLMap) {
  for (const id of [
    POI_CLUSTER_COUNT_LAYER_ID,
    POI_CLUSTER_NAME_LAYER_ID,
    POI_CLUSTER_CIRCLE_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(POI_CLUSTER_DATA_SOURCE_ID)) {
    map.removeSource(POI_CLUSTER_DATA_SOURCE_ID);
  }
}
