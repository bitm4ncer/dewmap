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
export const POI_MIN_ZOOM = 13;
/** Dots carry every place between clusters and icons (no collision). */
export const POI_DOT_LAYER_ID = "poi-mini-dots";
export const POI_ICON_MIN_ZOOM = 16.5;
export const POI_DOT_MAX_ZOOM = POI_ICON_MIN_ZOOM;
export const POI_LABEL_MIN_ZOOM = 17;
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

  // Zoom 15 → 16.5: every counted place appears as a small dot, so the
  // cluster numbers match what the map shows. Icons start once there is
  // enough room to place them without hiding most of them.
  if (!map.getLayer(POI_DOT_LAYER_ID)) {
    map.addLayer(
      {
        id: POI_DOT_LAYER_ID,
        type: "circle",
        source: POI_SOURCE_ID,
        "source-layer": "poi",
        minzoom: POI_MIN_ZOOM,
        maxzoom: POI_DOT_MAX_ZOOM,
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
          "text-font": ["Noto Sans Regular"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            16,
            10,
            18,
            11.5,
            20,
            12.5,
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
export const POI_CLUSTER_POINT_LAYER_ID = "poi-cluster-points";
export const POI_CLUSTER_MIN_ZOOM = 10;
export const POI_CLUSTER_MAX_ZOOM = POI_MIN_ZOOM;
/** Stop building at this zoom — clusters hand over to detail dots. */
export const POI_CLUSTER_BUILD_MAX_ZOOM = POI_CLUSTER_MAX_ZOOM;

/**
 * A bold-ish font that exists in the active basemap's glyph set.
 * CARTO serves Open Sans Bold but not Noto Sans Bold; Protomaps serves
 * Noto Sans Medium but not Bold; OpenFreeMap serves Noto Sans Bold.
 */
function clusterCountFont(map: MLMap): string[] {
  const glyphs = map.getStyle()?.glyphs ?? "";
  if (glyphs.includes("cartocdn")) return ["Open Sans Bold", "Noto Sans Regular"];
  if (glyphs.includes("protomaps")) return ["Noto Sans Medium", "Noto Sans Regular"];
  return ["Noto Sans Bold", "Noto Sans Regular"];
}

export function ensurePoiClusterLayers(map: MLMap) {
  if (!map.getSource(POI_CLUSTER_DATA_SOURCE_ID)) {
    map.addSource(POI_CLUSTER_DATA_SOURCE_ID, {
      type: "geojson",
      // Pre-aggregated district cells (see aggregatePoiDistricts):
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
          14,
          10, 17,
          50, 21,
          200, 25,
          600, 29,
        ],
        "circle-color": THEME.accent,
        "circle-opacity": 0.9,
        "circle-stroke-color": THEME.casing,
        "circle-stroke-width": 2,
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
        "text-size": 12,
        "text-font": clusterCountFont(map),
        // Centre the digits in the circle; the font box carries
        // descender space, which otherwise pushes them slightly high.
        "text-anchor": "center",
        "text-justify": "center",
        "text-offset": [0, 0.08],
        // Larger clusters win placement, so counts never stack up in
        // dense districts (the whole point of the overview).
        "text-padding": 2,
      },
      paint: {
        "text-color": THEME.accentInk,
      },
    });
  }
  if (!map.getLayer(POI_CLUSTER_POINT_LAYER_ID)) {
    map.addLayer({
      id: POI_CLUSTER_POINT_LAYER_ID,
      type: "circle",
      source: POI_CLUSTER_DATA_SOURCE_ID,
      minzoom: POI_CLUSTER_MIN_ZOOM,
      maxzoom: POI_CLUSTER_MAX_ZOOM,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": 4.5,
        "circle-color": THEME.accent,
        "circle-stroke-color": THEME.casing,
        "circle-stroke-width": 1.2,
      },
    });
  }
}

export function removePoiClusterLayers(map: MLMap) {
  for (const id of [
    POI_CLUSTER_POINT_LAYER_ID,
    POI_CLUSTER_COUNT_LAYER_ID,
    POI_CLUSTER_CIRCLE_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(POI_CLUSTER_DATA_SOURCE_ID)) {
    map.removeSource(POI_CLUSTER_DATA_SOURCE_ID);
  }
}
