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
export const POI_MIN_ZOOM = 15;
export const POI_LABEL_MIN_ZOOM = 16;
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

  if (!map.getLayer(POI_ICON_LAYER_ID)) {
    map.addLayer(
      {
        id: POI_ICON_LAYER_ID,
        type: "symbol",
        source: POI_SOURCE_ID,
        "source-layer": "poi",
        minzoom: POI_MIN_ZOOM,
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
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(POI_SOURCE_ID)) map.removeSource(POI_SOURCE_ID);
  for (const spec of Object.values(ICONS)) {
    if (map.hasImage(spec.id)) map.removeImage(spec.id);
  }
}
