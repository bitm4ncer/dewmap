import { gibsDateNDaysAgo } from "./gibs";

export type BasemapCategory = "photo" | "vector";

/**
 * Picker section. `category` still drives the Image/Vector/Hybrid switch;
 * `group` only controls how the collection is presented.
 */
export type BasemapGroup =
  | "global"
  | "dach"
  | "europe"
  | "historical"
  | "thematic";

export const BASEMAP_GROUP_LABELS: Record<BasemapGroup | "all", string> = {
  all: "All",
  global: "Global",
  dach: "DACH",
  europe: "Europe",
  historical: "Historical",
  thematic: "Thematic",
};

export const BASEMAP_GROUP_ORDER: (BasemapGroup | "all")[] = [
  "all",
  "global",
  "dach",
  "europe",
  "historical",
  "thematic",
];

export interface BasemapVariant {
  id: string;
  label: string;
  /** Substituted into the URL where the placeholder appears. */
  urlValue: string;
}

export interface BasemapVariantSpec {
  /** String in the basemap URL that gets replaced (e.g. "${year}"). */
  placeholder: string;
  options: BasemapVariant[];
  defaultId: string;
}

export interface Basemap {
  id: string;
  label: string;
  /**
   * Short secondary line shown under the label in the basemap picker.
   * May embed dynamic placeholders (`__GIBS_TODAY__`, the variant
   * placeholder) which `resolveBasemapSubtitle` substitutes at render
   * time.
   */
  subtitle?: string;
  kind: "raster" | "style";
  category: BasemapCategory;
  group: BasemapGroup;
  /** Human-readable source, shown as a tooltip / in the sources panel. */
  provider?: string;
  /** Licence short name, e.g. "CC BY 4.0". */
  license?: string;
  /** Coverage hint, e.g. "DE", "CH", "Welt". */
  coverage?: string;
  /** Optional WGS84 bounds [west, south, east, north] for regional layers. */
  bounds?: [number, number, number, number];
  url: string;
  maxzoom?: number;
  attribution: string;
  tileSize?: number;
  /** Optional run-time URL parameters (e.g. year, date). */
  variants?: BasemapVariantSpec;
}

const EOX_ATTRIB =
  '<a href="https://s2maps.eu" target="_blank" rel="noreferrer">Sentinel-2 cloudless</a> by <a href="https://eox.at" target="_blank" rel="noreferrer">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data)';

const CARTO_ATTRIB =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';

const GIBS_ATTRIB =
  '<a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA GIBS</a>';

const ESRI_ATTRIB =
  '<a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community';

const ESRI_TOPO_ATTRIB =
  'Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const ESRI_OCEAN_ATTRIB =
  'Esri, GEBCO, NOAA, National Geographic, DeLorme, HERE, Geonames.org, and other contributors';

const OSM_ATTRIB =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

const OPENTOPO_ATTRIB = `${OSM_ATTRIB}, SRTM | © <a href="https://opentopomap.org/" target="_blank" rel="noreferrer">OpenTopoMap</a> (CC-BY-SA)`;

const OFM_ATTRIB = `OpenFreeMap © OpenMapTiles · Data ${OSM_ATTRIB}`;

const VT_ATTRIB = `VersaTiles · ${OSM_ATTRIB}`;

const BKG_ATTRIB =
  '© <a href="https://basemap.de/" target="_blank" rel="noreferrer">basemap.de</a> · © GeoBasis-DE / BKG (2026) · DL-DE-BY 2.0';

const BY_ATTRIB =
  '© <a href="https://www.ldbv.bayern.de/" target="_blank" rel="noreferrer">Bayerische Vermessungsverwaltung</a> · CC BY 4.0';

const AT_ATTRIB =
  '© <a href="https://basemap.at/" target="_blank" rel="noreferrer">basemap.at</a> · CC BY 4.0';

const CH_ATTRIB =
  '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noreferrer">swisstopo</a>';

const PDOK_ATTRIB =
  '© <a href="https://www.kadaster.nl/" target="_blank" rel="noreferrer">Kadaster</a> / <a href="https://www.pdok.nl/" target="_blank" rel="noreferrer">PDOK</a>';

const IGN_ATTRIB =
  '© <a href="https://www.ign.fr/" target="_blank" rel="noreferrer">IGN</a> · Licence Ouverte 2.0';

const NO_ATTRIB =
  '© <a href="https://www.kartverket.no/" target="_blank" rel="noreferrer">Kartverket</a> · CC BY 4.0';

const CZ_ATTRIB =
  '© <a href="https://www.cuzk.cz/" target="_blank" rel="noreferrer">ČÚZK</a>';

const PL_ATTRIB =
  '© <a href="https://www.gov.pl/web/gugik" target="_blank" rel="noreferrer">GUGiK</a>';

const ES_ATTRIB =
  '© <a href="https://www.ign.es/" target="_blank" rel="noreferrer">IGN España</a> · CC BY 4.0';

const NLS_ATTRIB =
  '© <a href="https://maps.nls.uk/" target="_blank" rel="noreferrer">National Library of Scotland</a> · CC BY-NC 4.0';

const WIEN_ATTRIB =
  '© <a href="https://www.wien.gv.at/" target="_blank" rel="noreferrer">Stadt Wien</a> (MA 41) · CC BY 4.0';

const ZH_ATTRIB =
  '© <a href="https://geo.zh.ch/" target="_blank" rel="noreferrer">GIS-ZH / Kanton Zürich</a> · Wildkarte J. Wild (~1850)';

const GSI_ATTRIB =
  '© <a href="https://www.gsi.go.jp/" target="_blank" rel="noreferrer">GSI Japan</a>';

type Bounds = [number, number, number, number];

/** Rough WGS84 coverage boxes; keep tile requests inside the source. */
const BOUNDS: Record<
  "de" | "by" | "at" | "ch" | "nl" | "fr" | "no" | "cz" | "pl" | "es" | "uk" | "jp" | "wien" | "zh",
  Bounds
> = {
  de: [5.8, 47.2, 15.1, 55.1],
  by: [8.9, 47.2, 13.9, 50.6],
  at: [9.5, 46.3, 17.2, 49.1],
  ch: [5.9, 45.8, 10.5, 47.9],
  nl: [3.3, 50.7, 7.3, 53.6],
  fr: [-5.2, 41.3, 9.6, 51.2],
  no: [4.5, 57.9, 31.1, 71.2],
  cz: [12.0, 48.5, 18.9, 51.1],
  pl: [14.1, 49.0, 24.2, 54.9],
  es: [-9.4, 35.9, 4.4, 43.8],
  uk: [-8.7, 49.8, 1.8, 60.9],
  jp: [122.9, 24.0, 153.9, 45.6],
  wien: [16.1, 48.1, 16.6, 48.35],
  zh: [8.4, 47.2, 9.0, 47.6],
};

/** Special placeholder replaced at render time with a recent UTC date. */
export const GIBS_TODAY_DATE_PLACEHOLDER = "__GIBS_TODAY__";

const S2_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];

const SIEGFRIED_YEARS = ["1890", "1900", "1910", "1920", "1926", "1940", "1949"];

const ZEITREIHEN_YEARS = [
  "1850",
  "1880",
  "1900",
  "1920",
  "1940",
  "1950",
  "1960",
  "1970",
  "1980",
  "1990",
  "2000",
  "2010",
  "2021",
];

const WIEN_LUFTBILD_LAYERS = ["lb1938", "lb1956", "lb1976", "lb1992"];

const NL_ORTHO_YEARS = ["2024", "2023", "2022", "2021", "2020"];

const IGN_WMTS =
  "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0";

function ignLayer(layer: string, format: "image/jpeg" | "image/png") {
  return `${IGN_WMTS}&LAYER=${layer}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`;
}

export const BASEMAPS: Basemap[] = [
  // ── Global · imagery ────────────────────────────────────────────────
  {
    id: "esri-imagery",
    label: "Satellite · HD",
    subtitle: "Esri / Maxar mosaic · sub-meter to 1 m",
    kind: "raster",
    category: "photo",
    group: "global",
    provider: "Esri / Maxar",
    license: "Esri Terms of Use",
    coverage: "Welt",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    // Cap at 17 — the mosaic has higher detail in some urban areas, but
    // many regions return Esri's "Map data not yet available" error tile
    // past z=17. Capping makes MapLibre overzoom from z=17 instead so the
    // user sees imagery (just upscaled) at any zoom level.
    maxzoom: 17,
    attribution: ESRI_ATTRIB,
  },
  {
    id: "gibs-today",
    label: "Live · VIIRS",
    subtitle: `NOAA-20 VIIRS · ${GIBS_TODAY_DATE_PLACEHOLDER} · 250 m`,
    kind: "raster",
    category: "photo",
    group: "global",
    provider: "NASA GIBS",
    license: "Public domain",
    coverage: "Welt",
    // NOAA-20 VIIRS — primary daily true-colour since SNPP went offline in March 2026.
    // Two-day lag: yesterday's high-zoom tiles are often still blank.
    url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_NOAA20_CorrectedReflectance_TrueColor/default/${GIBS_TODAY_DATE_PLACEHOLDER}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
    maxzoom: 9,
    attribution: `${GIBS_ATTRIB} · VIIRS NOAA-20 True Color · ~250 m, daily`,
  },
  {
    id: "s2cloudless",
    label: "Sentinel-2",
    subtitle: "EOX cloudless mosaic · 10 m · annual",
    kind: "raster",
    category: "photo",
    group: "global",
    provider: "EOX / Copernicus",
    license: "CC BY 4.0",
    coverage: "Welt",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/g/{z}/{y}/{x}.jpg",
    maxzoom: 15,
    attribution: EOX_ATTRIB,
    variants: {
      placeholder: "${year}",
      options: S2_YEARS.map((y) => ({
        id: String(y),
        label: String(y),
        urlValue: String(y),
      })),
      defaultId: "2025",
    },
  },
  {
    id: "night",
    label: "Night",
    subtitle: "VIIRS Black Marble · 2023 annual composite",
    kind: "raster",
    category: "photo",
    group: "global",
    provider: "NASA GIBS",
    license: "Public domain",
    coverage: "Welt",
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2023-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
    maxzoom: 8,
    attribution: `${GIBS_ATTRIB} · VIIRS Black Marble (2023)`,
  },
  {
    id: "gibs-bluemarble",
    label: "Blue Marble",
    subtitle: "NASA · global backdrop · 500 m",
    kind: "raster",
    category: "photo",
    group: "global",
    provider: "NASA GIBS",
    license: "Public domain",
    coverage: "Welt",
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg",
    maxzoom: 8,
    attribution: `${GIBS_ATTRIB} · Blue Marble Next Generation`,
  },
  {
    id: "gibs-citylights",
    label: "City Lights",
    subtitle: "VIIRS · 2012 · night lights",
    kind: "raster",
    category: "photo",
    group: "global",
    provider: "NASA GIBS",
    license: "Public domain",
    coverage: "Welt",
    url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg",
    maxzoom: 8,
    attribution: `${GIBS_ATTRIB} · VIIRS City Lights (2012)`,
  },

  // ── Global · vector styles ─────────────────────────────────────────
  {
    id: "streets-dark",
    label: "Streets · dark",
    subtitle: "Graphite tint · softened labels",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "CARTO / OSM",
    license: "CARTO terms · ODbL",
    coverage: "Welt",
    url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    maxzoom: 19,
    attribution: CARTO_ATTRIB,
  },
  {
    id: "dark-matter",
    label: "Dark Matter",
    subtitle: "CARTO original · untinted",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "CARTO / OSM",
    license: "CARTO terms · ODbL",
    coverage: "Welt",
    url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    maxzoom: 19,
    attribution: CARTO_ATTRIB,
  },
  {
    id: "streets-light",
    label: "Streets · light",
    subtitle: "CARTO Positron",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "CARTO / OSM",
    license: "CARTO terms · ODbL",
    coverage: "Welt",
    url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    maxzoom: 19,
    attribution: CARTO_ATTRIB,
  },
  {
    id: "voyager",
    label: "Voyager",
    subtitle: "CARTO Voyager",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "CARTO / OSM",
    license: "CARTO terms · ODbL",
    coverage: "Welt",
    url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    maxzoom: 19,
    attribution: CARTO_ATTRIB,
  },
  {
    id: "ofm-dark",
    label: "OpenFreeMap · Dark",
    subtitle: "keyless OSM vector · dark",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "OpenFreeMap",
    license: "ODbL",
    coverage: "Welt",
    url: "https://tiles.openfreemap.org/styles/dark",
    maxzoom: 14,
    attribution: OFM_ATTRIB,
  },
  {
    id: "ofm-liberty",
    label: "OpenFreeMap · Liberty",
    subtitle: "keyless OSM vector · full detail",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "OpenFreeMap",
    license: "ODbL",
    coverage: "Welt",
    url: "https://tiles.openfreemap.org/styles/liberty",
    maxzoom: 14,
    attribution: OFM_ATTRIB,
  },
  {
    id: "ofm-bright",
    label: "OpenFreeMap · Bright",
    subtitle: "keyless OSM vector · colour",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "OpenFreeMap",
    license: "ODbL",
    coverage: "Welt",
    url: "https://tiles.openfreemap.org/styles/bright",
    maxzoom: 14,
    attribution: OFM_ATTRIB,
  },
  {
    id: "ofm-fiord",
    label: "OpenFreeMap · Fiord",
    subtitle: "keyless OSM vector · blue-grey",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "OpenFreeMap",
    license: "ODbL",
    coverage: "Welt",
    url: "https://tiles.openfreemap.org/styles/fiord",
    maxzoom: 14,
    attribution: OFM_ATTRIB,
  },
  {
    id: "vt-eclipse",
    label: "VersaTiles · Eclipse",
    subtitle: "keyless OSM vector · dark",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "VersaTiles",
    license: "ODbL",
    coverage: "Welt",
    url: "https://tiles.versatiles.org/assets/styles/eclipse/style.json",
    maxzoom: 14,
    attribution: VT_ATTRIB,
  },
  {
    id: "vt-shadow",
    label: "VersaTiles · Shadow",
    subtitle: "keyless OSM vector · grey dark",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "VersaTiles",
    license: "ODbL",
    coverage: "Welt",
    url: "https://tiles.versatiles.org/assets/styles/shadow/style.json",
    maxzoom: 14,
    attribution: VT_ATTRIB,
  },
  {
    id: "vt-graybeard",
    label: "VersaTiles · Graybeard",
    subtitle: "keyless OSM vector · muted",
    kind: "style",
    category: "vector",
    group: "global",
    provider: "VersaTiles",
    license: "ODbL",
    coverage: "Welt",
    url: "https://tiles.versatiles.org/assets/styles/graybeard/style.json",
    maxzoom: 14,
    attribution: VT_ATTRIB,
  },
  {
    id: "esri-topo",
    label: "Esri · World Topo",
    subtitle: "global topographic fallback",
    kind: "raster",
    category: "vector",
    group: "global",
    provider: "Esri",
    license: "Esri Terms of Use",
    coverage: "Welt",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 19,
    attribution: ESRI_TOPO_ATTRIB,
  },
  {
    id: "esri-street",
    label: "Esri · World Street",
    subtitle: "global street reference",
    kind: "raster",
    category: "vector",
    group: "global",
    provider: "Esri",
    license: "Esri Terms of Use",
    coverage: "Welt",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 19,
    attribution: ESRI_TOPO_ATTRIB,
  },
  {
    id: "esri-ocean",
    label: "Esri · Ocean",
    subtitle: "bathymetry · GEBCO / NOAA",
    kind: "raster",
    category: "vector",
    group: "global",
    provider: "Esri / GEBCO",
    license: "Esri Terms of Use",
    coverage: "Welt",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 16,
    attribution: ESRI_OCEAN_ATTRIB,
  },
  {
    id: "esri-natgeo",
    label: "Esri · National Geographic",
    subtitle: "reference cartography",
    kind: "raster",
    category: "vector",
    group: "global",
    provider: "National Geographic / Esri",
    license: "Esri Terms of Use",
    coverage: "Welt",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 16,
    attribution:
      'National Geographic, Esri, Garmin, HERE, UNEP-WCMC, USGS, NASA, ESA, METI, NRCan, GEBCO, NOAA, increment P Corp.',
  },
  {
    id: "esri-canvas-light",
    label: "Esri · Light Canvas",
    subtitle: "quiet grey background",
    kind: "raster",
    category: "vector",
    group: "global",
    provider: "Esri",
    license: "Esri Terms of Use",
    coverage: "Welt",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 19,
    attribution: `Esri, HERE, Garmin, ${OSM_ATTRIB}`,
  },

  // ── Global · terrain / thematic ────────────────────────────────────
  {
    id: "terrain",
    label: "Terrain",
    subtitle: "EOX terrain-light · relief",
    kind: "raster",
    category: "vector",
    group: "global",
    provider: "EOX",
    license: "CC BY 4.0",
    coverage: "Welt",
    url: "https://tiles.maps.eox.at/wmts/1.0.0/terrain-light_3857/default/g/{z}/{y}/{x}.jpg",
    maxzoom: 11,
    attribution: EOX_ATTRIB,
  },
  {
    id: "opentopo",
    label: "Topographic",
    subtitle: "OpenTopoMap · contours · hiking",
    kind: "raster",
    category: "vector",
    group: "global",
    provider: "OpenTopoMap",
    license: "CC BY-SA",
    coverage: "Welt",
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxzoom: 17,
    attribution: OPENTOPO_ATTRIB,
  },
  {
    id: "cyclosm",
    label: "CyclOSM",
    subtitle: "cycling & hiking detail",
    kind: "raster",
    category: "vector",
    group: "thematic",
    provider: "CyclOSM / OSM",
    license: "CC BY-SA · ODbL",
    coverage: "Welt",
    url: "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maxzoom: 20,
    attribution: `${OSM_ATTRIB} · CyclOSM`,
  },
  {
    id: "hot",
    label: "Humanitarian",
    subtitle: "HOT OSM style",
    kind: "raster",
    category: "vector",
    group: "thematic",
    provider: "HOT / OSM",
    license: "ODbL",
    coverage: "Welt",
    url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    maxzoom: 19,
    attribution: `${OSM_ATTRIB} · Tiles style by HOT`,
  },
  {
    id: "emodnet-bathy",
    label: "Sea floor",
    subtitle: "EMODnet bathymetry",
    kind: "raster",
    category: "vector",
    group: "thematic",
    provider: "EMODnet",
    license: "CC BY 4.0",
    coverage: "Weltmeere",
    url: "https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png",
    maxzoom: 13,
    attribution: '© <a href="https://emodnet.ec.europa.eu/en/bathymetry" target="_blank" rel="noreferrer">EMODnet Bathymetry</a>',
  },

  // ── DACH · official ────────────────────────────────────────────────
  {
    id: "de-basemap-col",
    label: "basemap.de · Farbe",
    subtitle: "BKG · amtliche Webkarte · z19",
    kind: "raster",
    category: "vector",
    group: "dach",
    provider: "BKG / basemap.de",
    license: "DL-DE-BY 2.0",
    coverage: "DE",
    bounds: BOUNDS.de,
    url: "https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png",
    maxzoom: 19,
    attribution: BKG_ATTRIB,
  },
  {
    id: "de-basemap-gry",
    label: "basemap.de · Grau",
    subtitle: "BKG · amtliche Webkarte · z19",
    kind: "raster",
    category: "vector",
    group: "dach",
    provider: "BKG / basemap.de",
    license: "DL-DE-BY 2.0",
    coverage: "DE",
    bounds: BOUNDS.de,
    url: "https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_grau/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png",
    maxzoom: 19,
    attribution: BKG_ATTRIB,
  },
  {
    id: "de-topplusopen",
    label: "TopPlusOpen",
    subtitle: "BKG · DE + Nachbarn · z17",
    kind: "raster",
    category: "vector",
    group: "dach",
    provider: "BKG",
    license: "dl-de/by-2-0",
    coverage: "DE",
    bounds: BOUNDS.de,
    url: "https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png",
    maxzoom: 17,
    attribution:
      '© <a href="https://www.bkg.bund.de/" target="_blank" rel="noreferrer">BKG</a> (2026) · dl-de/by-2-0',
  },
  {
    id: "de-by-webkarte",
    label: "Bayern",
    subtitle: "Bayerische Webkarte · z19",
    kind: "raster",
    category: "vector",
    group: "dach",
    provider: "Bayerische Vermessungsverwaltung",
    license: "CC BY 4.0",
    coverage: "BY",
    bounds: BOUNDS.by,
    url: "https://wmtsod1.bayernwolke.de/wmts/by_webkarte/smerc/{z}/{x}/{y}",
    maxzoom: 19,
    attribution: BY_ATTRIB,
  },
  {
    id: "de-by-amtl",
    label: "Bayern · amtlich",
    subtitle: "Topo mit Flurstücken · z19",
    kind: "raster",
    category: "vector",
    group: "dach",
    provider: "Bayerische Vermessungsverwaltung",
    license: "CC BY 4.0",
    coverage: "BY",
    bounds: BOUNDS.by,
    url: "https://wmtsod1.bayernwolke.de/wmts/by_amtl_karte/smerc/{z}/{x}/{y}",
    maxzoom: 19,
    attribution: BY_ATTRIB,
  },
  {
    id: "at-geoland",
    label: "basemap.at",
    subtitle: "amtliche Österreich-Karte · z18",
    kind: "raster",
    category: "vector",
    group: "dach",
    provider: "basemap.at",
    license: "CC BY 4.0",
    coverage: "AT",
    bounds: BOUNDS.at,
    url: "https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png",
    maxzoom: 18,
    attribution: AT_ATTRIB,
  },
  {
    id: "at-grau",
    label: "basemap.at · Grau",
    subtitle: "amtlich · overlay-freundlich",
    kind: "raster",
    category: "vector",
    group: "dach",
    provider: "basemap.at",
    license: "CC BY 4.0",
    coverage: "AT",
    bounds: BOUNDS.at,
    url: "https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png",
    maxzoom: 18,
    attribution: AT_ATTRIB,
  },
  {
    id: "at-ortho",
    label: "Österreich · Orthofoto",
    subtitle: "basemap.at · 30 cm",
    kind: "raster",
    category: "photo",
    group: "dach",
    provider: "basemap.at",
    license: "CC BY 4.0",
    coverage: "AT",
    bounds: BOUNDS.at,
    url: "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
    maxzoom: 18,
    attribution: AT_ATTRIB,
  },
  {
    id: "ch-pixelkarte",
    label: "Swisstopo · Landeskarte",
    subtitle: "amtliche Schweiz-Karte · z19",
    kind: "raster",
    category: "vector",
    group: "dach",
    provider: "swisstopo",
    license: "OGD · attribution",
    coverage: "CH",
    bounds: BOUNDS.ch,
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg",
    maxzoom: 19,
    attribution: CH_ATTRIB,
  },
  {
    id: "ch-swissimage",
    label: "Swisstopo · SWISSIMAGE",
    subtitle: "Orthofoto · 10–25 cm · z19",
    kind: "raster",
    category: "photo",
    group: "dach",
    provider: "swisstopo",
    license: "OGD · attribution",
    coverage: "CH",
    bounds: BOUNDS.ch,
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg",
    maxzoom: 19,
    attribution: CH_ATTRIB,
  },
  {
    id: "ch-landeskarte-10",
    label: "Swisstopo · LK 1:10k",
    subtitle: "Landeskarte 1:10 000",
    kind: "raster",
    category: "vector",
    group: "dach",
    provider: "swisstopo",
    license: "OGD · attribution",
    coverage: "CH",
    bounds: BOUNDS.ch,
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.landeskarte-farbe-10/default/current/3857/{z}/{x}/{y}.png",
    maxzoom: 19,
    attribution: CH_ATTRIB,
  },

  // ── Europe · official ──────────────────────────────────────────────
  {
    id: "nl-brt",
    label: "Nederland · BRT",
    subtitle: "PDOK BRT · z19",
    kind: "raster",
    category: "vector",
    group: "europe",
    provider: "Kadaster / PDOK",
    license: "CC BY 4.0",
    coverage: "NL",
    bounds: BOUNDS.nl,
    url: "https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png",
    maxzoom: 19,
    attribution: PDOK_ATTRIB,
  },
  {
    id: "nl-luchtfoto",
    label: "Nederland · Luchtfoto",
    subtitle: "PDOK aerial orthophoto",
    kind: "raster",
    category: "photo",
    group: "europe",
    provider: "Kadaster / PDOK",
    license: "CC BY 4.0",
    coverage: "NL",
    bounds: BOUNDS.nl,
    url: "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/${year}_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg",
    maxzoom: 19,
    attribution: PDOK_ATTRIB,
    variants: {
      placeholder: "${year}",
      options: NL_ORTHO_YEARS.map((y) => ({
        id: y,
        label: y,
        urlValue: y,
      })),
      defaultId: "2024",
    },
  },
  {
    id: "fr-planign",
    label: "France · Plan IGN",
    subtitle: "IGN · amtliche Karte · z18",
    kind: "raster",
    category: "vector",
    group: "europe",
    provider: "IGN",
    license: "Licence Ouverte 2.0",
    coverage: "FR",
    bounds: BOUNDS.fr,
    url: ignLayer("GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png"),
    maxzoom: 18,
    attribution: IGN_ATTRIB,
  },
  {
    id: "fr-ortho",
    label: "France · Orthophoto",
    subtitle: "IGN · 20 cm · z19",
    kind: "raster",
    category: "photo",
    group: "europe",
    provider: "IGN",
    license: "Licence Ouverte 2.0",
    coverage: "FR",
    bounds: BOUNDS.fr,
    url: ignLayer("ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg"),
    maxzoom: 19,
    attribution: IGN_ATTRIB,
  },
  {
    id: "no-topo",
    label: "Norge · Topo",
    subtitle: "Kartverket · z18",
    kind: "raster",
    category: "vector",
    group: "europe",
    provider: "Kartverket",
    license: "CC BY 4.0",
    coverage: "NO",
    bounds: BOUNDS.no,
    url: "https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png",
    maxzoom: 18,
    attribution: NO_ATTRIB,
  },
  {
    id: "no-sjokart",
    label: "Norge · Sjøkart",
    subtitle: "Kartverket sea chart",
    kind: "raster",
    category: "vector",
    group: "europe",
    provider: "Kartverket",
    license: "CC BY 4.0",
    coverage: "NO",
    bounds: BOUNDS.no,
    url: "https://cache.kartverket.no/v1/wmts/1.0.0/sjokartraster/default/webmercator/{z}/{y}/{x}.png",
    maxzoom: 18,
    attribution: NO_ATTRIB,
  },
  {
    id: "cz-orto",
    label: "Česko · Ortofoto",
    subtitle: "ČÚZK · WebMercator",
    kind: "raster",
    category: "photo",
    group: "europe",
    provider: "ČÚZK",
    license: "Open data · attribution",
    coverage: "CZ",
    bounds: BOUNDS.cz,
    url: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 20,
    attribution: CZ_ATTRIB,
  },
  {
    id: "cz-ztm",
    label: "Česko · Topo",
    subtitle: "ČÚZK · Základní topografická mapa",
    kind: "raster",
    category: "vector",
    group: "europe",
    provider: "ČÚZK",
    license: "Open data · attribution",
    coverage: "CZ",
    bounds: BOUNDS.cz,
    url: "https://ags.cuzk.gov.cz/arcgis1/rest/services/ZTM_WM/MapServer/tile/{z}/{y}/{x}",
    maxzoom: 20,
    attribution: CZ_ATTRIB,
  },
  {
    id: "pl-orto",
    label: "Polska · Ortofoto",
    subtitle: "GUGiK · StandardResolution",
    kind: "raster",
    category: "photo",
    group: "europe",
    provider: "GUGiK",
    license: "Open data · attribution",
    coverage: "PL",
    bounds: BOUNDS.pl,
    url: "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&TILEMATRIXSET=EPSG:3857&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
    maxzoom: 18,
    attribution: PL_ATTRIB,
  },
  {
    id: "es-ign",
    label: "España · IGN Base",
    subtitle: "MTN · z18",
    kind: "raster",
    category: "vector",
    group: "europe",
    provider: "IGN España",
    license: "CC BY 4.0",
    coverage: "ES",
    bounds: BOUNDS.es,
    url: "https://www.ign.es/wmts/ign-base?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=IGNBaseTodo&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
    maxzoom: 18,
    attribution: ES_ATTRIB,
  },
  {
    id: "es-pnoa",
    label: "España · PNOA",
    subtitle: "Orthofoto · 25–50 cm",
    kind: "raster",
    category: "photo",
    group: "europe",
    provider: "IGN España",
    license: "CC BY 4.0",
    coverage: "ES",
    bounds: BOUNDS.es,
    url: "https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
    maxzoom: 18,
    attribution: ES_ATTRIB,
  },

  // ── Historical ─────────────────────────────────────────────────────
  {
    id: "ch-siegfried",
    label: "Siegfriedkarte",
    subtitle: "swisstopo 1:25 000 · historical",
    kind: "raster",
    category: "vector",
    group: "historical",
    provider: "swisstopo",
    license: "OGD · attribution",
    coverage: "CH",
    bounds: BOUNDS.ch,
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hiks-siegfried/default/${year}/3857/{z}/{x}/{y}.png",
    maxzoom: 17,
    attribution: CH_ATTRIB,
    variants: {
      placeholder: "${year}",
      options: SIEGFRIED_YEARS.map((y) => ({ id: y, label: y, urlValue: y })),
      defaultId: "1926",
    },
  },
  {
    id: "ch-dufour",
    label: "Dufourkarte",
    subtitle: "swisstopo 1:100 000 · 1845–1865",
    kind: "raster",
    category: "vector",
    group: "historical",
    provider: "swisstopo",
    license: "OGD · attribution",
    coverage: "CH",
    bounds: BOUNDS.ch,
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hiks-dufour/default/current/3857/{z}/{x}/{y}.png",
    maxzoom: 15,
    attribution: CH_ATTRIB,
  },
  {
    id: "ch-zeitreihen",
    label: "Schweiz · Zeitreise",
    subtitle: "swisstopo historical orthophoto",
    kind: "raster",
    category: "photo",
    group: "historical",
    provider: "swisstopo",
    license: "OGD · attribution",
    coverage: "CH",
    bounds: BOUNDS.ch,
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.zeitreihen/default/${year}1231/3857/{z}/{x}/{y}.png",
    maxzoom: 17,
    attribution: CH_ATTRIB,
    variants: {
      placeholder: "${year}",
      options: ZEITREIHEN_YEARS.map((y) => ({ id: y, label: y, urlValue: y })),
      defaultId: "1970",
    },
  },
  {
    id: "ch-swissimage-1946",
    label: "Schweiz · 1946",
    subtitle: "SWISSIMAGE 1946 · Luftbild",
    kind: "raster",
    category: "photo",
    group: "historical",
    provider: "swisstopo",
    license: "OGD · attribution",
    coverage: "CH",
    bounds: BOUNDS.ch,
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage-product_1946/default/1946/3857/{z}/{x}/{y}.jpeg",
    maxzoom: 17,
    attribution: CH_ATTRIB,
  },
  {
    id: "fr-etatmajor",
    label: "État-Major 1820–66",
    subtitle: "IGN · Alsace/Lorraine/Saarland",
    kind: "raster",
    category: "vector",
    group: "historical",
    provider: "IGN",
    license: "Licence Ouverte 2.0",
    coverage: "FR",
    bounds: BOUNDS.fr,
    url: ignLayer("GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40", "image/jpeg"),
    maxzoom: 15,
    attribution: IGN_ATTRIB,
  },
  {
    id: "fr-scan50-1950",
    label: "France 1950",
    subtitle: "IGN SCAN50 · Nachkriegs-Topo",
    kind: "raster",
    category: "vector",
    group: "historical",
    provider: "IGN",
    license: "Licence Ouverte 2.0",
    coverage: "FR",
    bounds: BOUNDS.fr,
    url: ignLayer("GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN50.1950", "image/jpeg"),
    maxzoom: 15,
    attribution: IGN_ATTRIB,
  },
  {
    id: "fr-ortho-hist",
    label: "France · Ortho historical",
    subtitle: "IGN · post-war aerial",
    kind: "raster",
    category: "photo",
    group: "historical",
    provider: "IGN",
    license: "Licence Ouverte 2.0",
    coverage: "FR",
    bounds: BOUNDS.fr,
    url: ignLayer("ORTHOIMAGERY.ORTHOPHOTOS.${year}", "image/png"),
    maxzoom: 18,
    attribution: IGN_ATTRIB,
    variants: {
      placeholder: "${year}",
      options: [
        { id: "1950", label: "1950–65", urlValue: "1950-1965" },
        { id: "1965", label: "1965–80", urlValue: "1965-1980" },
        { id: "1980", label: "1980–95", urlValue: "1980-1995" },
      ],
      defaultId: "1950",
    },
  },
  {
    id: "fr-cassini",
    label: "Cassini · 18. Jh.",
    subtitle: "IGN / BnF · Carte de Cassini",
    kind: "raster",
    category: "vector",
    group: "historical",
    provider: "IGN / BnF",
    license: "Licence Ouverte 2.0",
    coverage: "FR",
    bounds: BOUNDS.fr,
    url: ignLayer("BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI", "image/png"),
    maxzoom: 14,
    attribution: IGN_ATTRIB,
  },
  {
    id: "at-wien-luftbild",
    label: "Wien · Luftbild",
    subtitle: "Stadt Wien · historical aerial",
    kind: "raster",
    category: "photo",
    group: "historical",
    provider: "Stadt Wien (MA 41)",
    license: "CC BY 4.0",
    coverage: "Wien",
    bounds: BOUNDS.wien,
    url: "https://maps.wien.gv.at/wmts/${year}/grau/google3857/{z}/{y}/{x}.jpeg",
    maxzoom: 19,
    attribution: WIEN_ATTRIB,
    variants: {
      placeholder: "${year}",
      options: WIEN_LUFTBILD_LAYERS.map((layer) => ({
        id: layer.slice(2),
        label: layer.slice(2),
        urlValue: layer,
      })),
      defaultId: "1938",
    },
  },
  {
    id: "ch-zuerich-1850",
    label: "Zürich ~1850",
    subtitle: "Wildkarte · 1:25 000",
    kind: "raster",
    category: "vector",
    group: "historical",
    provider: "GIS-ZH",
    license: "OGD · attribution",
    coverage: "ZH",
    bounds: BOUNDS.zh,
    url: "https://wms.zh.ch/WildkarteZHWMS?service=WMS&version=1.3.0&request=GetMap&layers=wild&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png",
    maxzoom: 16,
    attribution: ZH_ATTRIB,
  },
  {
    id: "uk-nls-6inch",
    label: "OS 6-inch",
    subtitle: "NLS · historical OS map",
    kind: "raster",
    category: "vector",
    group: "historical",
    provider: "National Library of Scotland",
    license: "CC BY-NC 4.0",
    coverage: "UK",
    bounds: BOUNDS.uk,
    url: "https://mapseries-tilesets.s3.amazonaws.com/os/${year}/{z}/{x}/{y}.png",
    maxzoom: 17,
    attribution: NLS_ATTRIB,
    variants: {
      placeholder: "${year}",
      options: [
        { id: "6inchfirst", label: "1st ed.", urlValue: "6inchfirst" },
        { id: "6inchsecond", label: "2nd ed.", urlValue: "6inchsecond" },
      ],
      defaultId: "6inchfirst",
    },
  },
  {
    id: "no-historisk",
    label: "Norge · Historisk",
    subtitle: "Kartverket · 1700s–1900s",
    kind: "raster",
    category: "vector",
    group: "historical",
    provider: "Kartverket",
    license: "CC BY 4.0",
    coverage: "NO",
    bounds: BOUNDS.no,
    url: "https://wms.geonorge.no/skwms1/wms.historiskekart?service=WMS&version=1.3.0&request=GetMap&layers=historiskekart&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256&format=image/png&transparent=true",
    maxzoom: 16,
    attribution: NO_ATTRIB,
  },
  {
    id: "jp-gazo1",
    label: "Japan · 1961–69",
    subtitle: "GSI · historical aerial",
    kind: "raster",
    category: "photo",
    group: "historical",
    provider: "GSI Japan",
    license: "Open data · attribution",
    coverage: "JP",
    bounds: BOUNDS.jp,
    url: "https://cyberjapandata.gsi.go.jp/xyz/gazo1/{z}/{x}/{y}.jpg",
    maxzoom: 17,
    attribution: GSI_ATTRIB,
  },

  // ── Japan · current ────────────────────────────────────────────────
  {
    id: "jp-seamless",
    label: "Japan · Seamless",
    subtitle: "GSI · current aerial",
    kind: "raster",
    category: "photo",
    group: "global",
    provider: "GSI Japan",
    license: "Open data · attribution",
    coverage: "JP",
    bounds: BOUNDS.jp,
    url: "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
    maxzoom: 18,
    attribution: GSI_ATTRIB,
  },
  {
    id: "jp-pale",
    label: "Japan · Pale",
    subtitle: "GSI · pale topographic",
    kind: "raster",
    category: "vector",
    group: "global",
    provider: "GSI Japan",
    license: "Open data · attribution",
    coverage: "JP",
    bounds: BOUNDS.jp,
    url: "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png",
    maxzoom: 18,
    attribution: GSI_ATTRIB,
  },
];

/** Only annual Sentinel-2 and the daily GIBS layer expose timeline settings. */
export function basemapUsesTimeline(
  imageId: string,
  mode: "photo" | "hybrid" | "vector",
): boolean {
  return (
    mode !== "vector" && (imageId === "s2cloudless" || imageId === "gibs-today")
  );
}

export const DEFAULT_IMAGE_BASEMAP_ID = "esri-imagery";
export const DEFAULT_VECTOR_BASEMAP_ID = "streets-dark";

export function getBasemap(id: string): Basemap | undefined {
  return BASEMAPS.find((b) => b.id === id);
}

export function basemapGroup(basemap: Basemap): BasemapGroup {
  return basemap.group;
}

/** Basemaps for a picker filter; `"all"` returns the whole collection. */
export function basemapsInGroup(
  group: BasemapGroup | "all",
): Basemap[] {
  if (group === "all") return BASEMAPS;
  return BASEMAPS.filter((b) => b.group === group);
}

export function getActiveVariant(
  basemap: Basemap,
  variantId: string | undefined,
): BasemapVariant | null {
  if (!basemap.variants) return null;
  const list = basemap.variants.options;
  return (
    list.find((v) => v.id === variantId) ??
    list.find((v) => v.id === basemap.variants!.defaultId) ??
    list[0] ??
    null
  );
}

/**
 * Resolve __GIBS_TODAY__ placeholder. Two-day lag: yesterday's
 * high-zoom VIIRS tiles are frequently still blank while the mosaic
 * is being processed. Offset N = N days before that base date.
 */
function gibsTodayDate(dayOffset?: number): string {
  return gibsDateNDaysAgo((dayOffset ?? 0) + 2);
}

/**
 * Build the final tile URL for a basemap, substituting any dynamic
 * placeholders (variants like ${year}, time-based __GIBS_TODAY__).
 *
 * `dayOffset` only matters for the gibs-today basemap; ignored elsewhere.
 */
export function resolveBasemapUrl(
  basemap: Basemap,
  variantId?: string,
  dayOffset?: number,
): string {
  let url = basemap.url;
  if (basemap.variants) {
    const variant = getActiveVariant(basemap, variantId);
    if (variant) {
      url = url.replaceAll(basemap.variants.placeholder, variant.urlValue);
    }
  }
  if (url.includes(GIBS_TODAY_DATE_PLACEHOLDER)) {
    url = url.replaceAll(GIBS_TODAY_DATE_PLACEHOLDER, gibsTodayDate(dayOffset));
  }
  return url;
}

/**
 * Resolve the human-readable subtitle for a basemap, with the same
 * placeholder substitutions used for URLs. Returns null if no subtitle
 * is configured.
 */
export function resolveBasemapSubtitle(
  basemap: Basemap,
  variantId?: string,
  dayOffset?: number,
): string | null {
  if (!basemap.subtitle) return null;
  let s = basemap.subtitle;
  if (basemap.variants) {
    const variant = getActiveVariant(basemap, variantId);
    if (variant) {
      s = s.replaceAll(basemap.variants.placeholder, variant.label);
    }
  }
  if (s.includes(GIBS_TODAY_DATE_PLACEHOLDER)) {
    s = s.replaceAll(GIBS_TODAY_DATE_PLACEHOLDER, gibsTodayDate(dayOffset));
  }
  return s;
}
