# Basemap collection — research & expansion plan

_2026-11-18 · scope: raster/vector basemaps, open tile APIs, aerial imagery, city archives, historical maps. All endpoints were probed live (HTTP status + `Access-Control-Allow-Origin` + real tile) on 2026-11-18; "verified" below means a real tile returned 200 with browser-compatible CORS, not just a docs claim._

## 1. Executive summary

The current collection has **9 basemaps**: 4 imagery (Esri, GIBS today, Sentinel-2, night) and 5 "vector" entries (3 CARTO styles, EOX terrain, OpenTopoMap). That is a solid global core, but it has four gaps:

1. **No keyless vector fallback.** All three vector street styles depend on CARTO. CARTO's *vector* tiles still work without a key (verified 2026-11-18), but its *raster* tiles are blank without a key. A second independent vector provider is cheap insurance.
2. **No official DACH cartography.** basemap.de, basemap.at and swisstopo are free, keyless, CORS-open and better than any global style for Germany/Austria/Switzerland — exactly the app's home market.
3. **History stops at OpenHistoricalMap.** OHM is reconstructed vector data, not scans. swisstopo, IGN, Vienna and the NLS expose real historical map series as ordinary XYZ tiles today.
4. **No aerial/orthophoto time machine.** Vienna (1938/1956/1976/1992), swisstopo (1844–2021) and IGN (1950–1995) have working endpoints. Munich has an even longer series (1956–2023), but its WMS is EPSG:25832-only and therefore not directly usable (see §6).

**Top 10 additions, in order of value/effort:**

| # | Basemap | Why |
|---|---|---|
| 1 | **OpenFreeMap Dark** (style) | keyless, unlimited, dark, independent of CARTO; drop-in fallback |
| 2 | **basemap.de Farbe + Grau** (raster WMTS) | official Germany, keyless, z19 |
| 3 | **basemap.at geoland + Orthofoto** | official Austria, keyless, z18/19, CC BY 4.0 |
| 4 | **swisstopo Pixelkarte + SWISSIMAGE** | official Switzerland, keyless, z18, excellent for hiking |
| 5 | **swisstopo Siegfried 1890–1949** | real 1:25k historical map, per-year variants |
| 6 | **swisstopo Zeitreihen 1844–2021** | 178 historical orthophoto years, one URL pattern |
| 7 | **IGN État-Major 1820–1866** | railway-age map of Alsace/Lorraine/Saarland/Palatinate |
| 8 | **Vienna 1938/1956/1976/1992** | best city aerial time machine in the German-speaking world |
| 9 | **OpenFreeMap Liberty/Bright + VersaTiles Eclipse** | modern light/dark vector alternatives |
| 10 | **IGN Scan50 1950 + orthos 1950–1995** | post-war France, z18 |

Two live findings outside the basemap list:

- **GIBS "Live · Today" is unreliable at zoom ≥ 5.** `gibsYesterday()` resolves to 2026-11-17; that date returns a valid z0–z3 tile but a 1,665-byte blank JPEG at z5/z6, while 2026-11-16 returns 15 KB. The UI says "yesterday", the map shows nothing at hiking zoom in many regions. Use a 2-day lag or probe the date.
- **OpenRailwayMap blocks non-browser clients.** `curl` without a browser UA gets 403; with a Chrome UA it returns real 512×512 tiles (44 KB at Berlin Hbf) and CORS `*`. The existing overlay works in a browser; the app's `tileSize: 256` simply downsamples the 512 px tile at 2× density. Hotlink protection is UA-sensitive, so a dev health check is cheap insurance. (A single 139-byte placeholder was observed once; it did not reproduce.)

### 1.1 Sofortmaßnahmen (unabhängig vom Ausbau)

1. **GIBS-Datum absichern.** `gibsYesterday()` liefert 2026-11-17; die Kacheln sind ab z5 leer (1.665-Byte-JPEG), während 2026-11-16 echte Daten liefert. Entweder fest auf 2 Tage Verzögerung gehen oder beim ersten Tile-Fehler/leeren Bild automatisch einen Tag zurückfallen und das Ergebnis pro Session cachen.
2. **OpenRailwayMap beobachten.** 403 für Curl-UA, 200 mit Browser-UA (512×512-Kacheln, CORS `*`). Das Overlay funktioniert im Browser; ein Health-Check mit Browser-UA im Dev-Build reicht, falls der Hotlink-Schutz verschärft wird.
3. **CARTO nicht auf Raster umstellen.** Die Vector-Tiles (`carto.streets/v2`) funktionieren keyless; die Raster-Endpunkte sind keyless leer. Die bestehenden Style-Einträge sind also korrekt, aber ein keylesser Fallback (OpenFreeMap/VersaTiles) ist sinnvoll.

## 2. Evaluation criteria

| Criterion | Why it matters here |
|---|---|
| Keyless | static export, no backend, no secret storage |
| Browser CORS | MapLibre fetches tiles via `fetch`; no ACAO = dead |
| XYZ or style.json | current `Basemap` type supports only these two |
| WMS with `{bbox-epsg-3857}` | MapLibre 5 substitutes it, so CORS-open WMS also works |
| Licence | attribution + commercial/reuse terms must be clear |
| Max zoom | source resolution, not server limit; overzoom is fine |
| Coverage | regional layers need a UI hint, not a hard failure |
| Cacheability | public demo endpoints should be polite and cacheable |

## 3. Current inventory

| id | kind | category | Source | Max zoom | Note |
|---|---|---|---|---|---|
| `esri-imagery` | raster | photo | Esri World_Imagery | 17 | capped deliberately; z18+ returns error tiles in places |
| `gibs-today` | raster | photo | NASA GIBS VIIRS NOAA-20 | 9 | date lag issue (see §1) |
| `s2cloudless` | raster | photo | EOX Sentinel-2 cloudless | 15 | annual variants 2018–2024 |
| `night` | raster | photo | NASA Black Marble 2023 | 8 | |
| `streets-dark` | style | vector | CARTO Dark Matter | 19 | default; custom Graphite tint |
| `streets-light` | style | vector | CARTO Positron | 19 | |
| `voyager` | style | vector | CARTO Voyager | 19 | |
| `terrain` | raster | vector | EOX terrain-light | 11 | actually raster |
| `opentopo` | raster | vector | OpenTopoMap | 17 | actually raster |

Structural issues relevant to expansion:

- `category` mixes **rendering behaviour** (`photo` vs `vector` drives the Image/Vector switch) with **content type**. Historical scans and official topographic maps are not "photo" in the semantic sense.
- The picker renders two flat lists; more than ~12 entries per list becomes a scroll wall.
- `variants` is data-driven, but only Sentinel-2 exposes a selector (`TimelineYearTab` is hard-coded to `s2cloudless`).
- There is no licence/provider metadata, no coverage hint, no recent/favourite state.
- `rasterStyle()` already supports `tileSize`, `maxzoom`, attribution and arbitrary `tiles` URLs — so **WMS via `{bbox-epsg-3857}` works without code changes**.

## 4. Recommended additions

### 4.1 Global vector (keyless)

| id | Style URL | Max z | Licence | Verdict |
|---|---|---|---|---|
| `ofm-dark` | `https://tiles.openfreemap.org/styles/dark` | 14 | OSM ODbL; OpenFreeMap free/unlimited | **add** — dark fallback |
| `ofm-liberty` | `https://tiles.openfreemap.org/styles/liberty` | 14 | same | **add** |
| `ofm-bright` | `https://tiles.openfreemap.org/styles/bright` | 14 | same | add |
| `ofm-positron` | `https://tiles.openfreemap.org/styles/positron` | 14 | same | add |
| `ofm-fiord` | `https://tiles.openfreemap.org/styles/fiord` | 14 | same | optional |
| `vt-eclipse` | `https://tiles.versatiles.org/assets/styles/eclipse/style.json` | 14 | OSM ODbL; VersaTiles free | **add** — independent dark |
| `vt-graybeard` | `.../graybeard/style.json` | 14 | same | add |
| `vt-colorful` | `.../colorful/style.json` | 14 | same | optional |
| `vt-shadow` | `.../shadow/style.json` | 14 | same | optional |
| `vt-neutrino` | `.../neutrino/style.json` | 14 | same | optional (muted) |
| `esri-vector` | `https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/resources/styles/root.json` | 22 | Esri ToS, free account recommended | conditional |
| `americana` | `https://americanamap.org/style.json` | 14 | OSM US, **non-commercial** | skip for now |

All OpenFreeMap and VersaTiles styles returned 200 with `Access-Control-Allow-Origin: *`; tiles are CORS-open and keyless. OpenFreeMap explicitly allows commercial use and has no published request limit (no SLA). VersaTiles has no published quota either.

### 4.2 Global raster / imagery

| id | URL pattern | Max z | Licence | Verdict |
|---|---|---|---|---|
| `esri-topo` | `.../World_Topo_Map/MapServer/tile/{z}/{y}/{x}` | 19 | Esri, HERE, Garmin, USGS, OSM | **add** — best general fallback |
| `esri-street` | `.../World_Street_Map/MapServer/tile/{z}/{y}/{x}` | 19 | Esri et al. | add |
| `esri-ocean` | `.../Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}` | 16 | Esri, GEBCO, NOAA | add (bathymetry context) |
| `esri-natgeo` | `.../NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}` | 16 | NatGeo, Esri | optional |
| `esri-canvas-light` | `.../Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}` | 19 | Esri, OSM | add (quiet background) |
| `esri-hillshade` | `.../Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}` | ~15 | Esri, Airbus, USGS | overlay only |
| `usgs-imagery` | `basemap.nationalmap.gov/.../USGSImageryOnly/MapServer/tile/{z}/{y}/{x}` | 16 | US public domain | add (US travel) |
| `usgs-topo` | `.../USGSTopo/MapServer/tile/{z}/{y}/{x}` | 16 | US public domain | add (US travel) |
| `gibs-bluemarble` | `.../BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg` | 8 | NASA public domain | add (world backdrop) |
| `gibs-citylights` | `.../VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg` | 8 | NASA | optional |
| `gibs-modis` | `.../MODIS_Terra_CorrectedReflectance_TrueColor/default/{date}/...` | 9 | NASA | optional |
| `emodnet-bathy` | `https://tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/{z}/{x}/{y}.png` | 13 | EMODnet, CC BY | add (sea floor) |

Esri, USGS, GIBS and EMODnet all returned `Access-Control-Allow-Origin: *`. Esri World_Imagery is already in use; the others are the same infrastructure and terms.

### 4.3 DACH official cartography

| id | URL | Max z | Licence | Verdict |
|---|---|---|---|---|
| `de-basemap-col` | `https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png` | 19 | DL-DE-BY 2.0, © GeoBasis-DE/BKG | **add — best DE default** |
| `de-basemap-gry` | `.../de_basemapde_web_raster_grau/...` | 19 | same | **add** |
| `de-topplusopen` | `https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png` | 17 | dl-de/by-2-0, © BKG | add |
| `de-by-webkarte` | `https://wmtsod1.bayernwolke.de/wmts/by_webkarte/smerc/{z}/{x}/{y}` | 19 | CC BY 4.0, © Bayerische Vermessungsverwaltung | add |
| `de-by-amtl` | `.../by_amtl_karte/smerc/{z}/{x}/{y}` | 19 | same | add (Flurstücke) |
| `de-by-dop` | `.../by_dop/smerc/{z}/{x}/{y}` | 19 | same | add (20 cm) |
| `de-basemap-col` | `https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json` | 15 | DL-DE-BY 2.0 | optional (Vektor) |
| `de-basemap-gry` | `.../styles/bm_web_gry.json` | 15 | same | optional (Vektor) |
| `at-geoland` | `https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png` | 18 | CC BY 4.0, © basemap.at | **add** |
| `at-grau` | `.../bmapgrau/normal/google3857/{z}/{y}/{x}.png` | 18 | same | add |
| `at-ortho` | `.../bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg` | 18 | same | **add** |
| `at-hidpi` | `.../bmaphidpi/normal/google3857/{z}/{y}/{x}.jpeg` | 18 | same | optional (`tileSize: 512`) |
| `at-overlay` | `.../bmapoverlay/normal/google3857/{z}/{y}/{x}.png` | 18 | same | labels overlay |
| `at-gelaende` | `.../bmapgelaende/grau/google3857/{z}/{y}/{x}.jpeg` | 18 | same | relief overlay |
| `ch-pixelkarte` | `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg` | 19 | © swisstopo, free | **add** |
| `ch-swissimage` | `.../ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg` | 19 | same | **add** |
| `ch-landeskarte-10` | `.../ch.swisstopo.landeskarte-farbe-10/default/current/3857/{z}/{x}/{y}.png` | 19 | same | add (PNG only) |
| `ch-landeskarte-grau` | `.../ch.swisstopo.landeskarte-grau-10/...png` | 19 | same | add (PNG only) |

Notes:

- **basemap.at moved**: the old `basemap.at/wmts/...` host path 404s; the working host is `mapsneu.wien.gv.at`. Path order is **row before column** (`{z}/{y}/{x}`).
- **basemap.de**: use the **raster WMTS** (`/wmts_basemapde/tile/1.0.0/...`) for z19; the vector styles stop at z15 and are only an optional alternative. The old `/wmts_basemapde/1.0.0/dtk/...` path returns 500; the working template is `/tile/1.0.0/{layer}/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png`. Verified with `Accept: image/*`, `Accept: */*` and no Accept header — all return the same 150 KB tile, so MapLibre's default fetch is fine.
- **Bayern**: current host is `wmtsod1.bayernwolke.de` (the old `geoservices.bayern.de` paths are dead). No file extension, axes `{z}/{x}/{y}`.
- **swisstopo** paths use `{z}/{x}/{y}` and `.png` for scanned series, `.jpeg` for current raster. `current` works for pixelkarte/swissimage/dufour; Siegfried needs a year. Pixelkarte/SWISSIMAGE go to z19, Siegfried only to z17, Dufour to z15.
- **swisstopo coverage** is Switzerland + a small border buffer. Outside it, tiles 404 — acceptable with a coverage hint, not a global default.

### 4.3.1 Europe & world official (verified)

| id | URL | Max z | Licence | Note |
|---|---|---|---|---|
| `nl-brt` | `https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png` | 19 | © Kadaster/PDOK | axes `{z}/{x}/{y}`; also `grijs`, `pastel` |
| `nl-luchtfoto` | `https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg` | 19 | © PDOK | year layers `2024_orthoHR`, … |
| `fr-planign` | IGN `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2`, **png** | 18 | Licence Ouverte 2.0 | official France |
| `fr-ortho` | IGN `ORTHOIMAGERY.ORTHOPHOTOS`, jpeg | 19 | same | current ortho |
| `no-topo` | `https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png` | 18 | CC BY 4.0 | axes `{z}/{y}/{x}` |
| `no-sjokart` | `.../sjokartraster/default/webmercator/{z}/{y}/{x}.png` | 18 | CC BY 4.0 | sea chart |
| `cz-orto` | `https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}` | 20 | © ČÚZK | `_WM` = WebMercator; plain `ORTOFOTO` is EPSG:5514 |
| `cz-ztm` | `.../ZTM_WM/MapServer/tile/{z}/{y}/{x}` | 20 | © ČÚZK | topo |
| `pl-orto` | GUGiK `ORTOFOTOMAPA`, WMTS KVP, `EPSG:3857` | 18 | © GUGiK | |
| `es-ign` | `https://www.ign.es/wmts/ign-base?...LAYER=IGNBaseTodo...` | 18 | CC BY 4.0 | |
| `es-pnoa` | `https://www.ign.es/wmts/pnoa-ma?...LAYER=OI.OrthoimageCoverage...` | 18 | CC BY 4.0 | aerial |
| `jp-seamless` | `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg` | 18 | GSI | current aerial |
| `jp-pale` | `.../xyz/pale/{z}/{x}/{y}.png` | 18 | GSI | pale topo |
| `jp-gazo1` | `.../xyz/gazo1/{z}/{x}/{y}.jpg` | 17 | GSI | 1961–69 aerial |
| `au-nsw` | `https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Imagery/MapServer/tile/{z}/{y}/{x}` | 21 | © Spatial Services NSW | NSW only |

**Not usable without a key/proxy:** Sweden (Lantmäteriet token), Finland (MML api-key), Denmark (Dataforsyningen token), New Zealand (LINZ api_key), Italy PCN (HTTPS→HTTP redirect = mixed content), Canada NRCan (timeout from here), most German state WMS as XYZ (but they work as WMS with `{bbox-epsg-3857}`), Baden-Württemberg WMTS (GetTile 400).

### 4.4 Historical maps (ready today)

| id | URL | Max z | Licence | Note |
|---|---|---|---|---|
| `ch-siegfried` | `.../ch.swisstopo.hiks-siegfried/default/{year}/3857/{z}/{x}/{y}.png` | 17 | © swisstopo | years 1870–1949; 1880 can be blank, 1890+ solid |
| `ch-dufour` | `.../ch.swisstopo.hiks-dufour/default/current/3857/{z}/{x}/{y}.png` | 15 | © swisstopo | 1845–1865 |
| `ch-zeitreihen` | `.../ch.swisstopo.zeitreihen/default/{YYYY}1231/3857/{z}/{x}/{y}.png` | 17 | © swisstopo | 178 years, 1844–2021 |
| `ch-swissimage-1946` | `.../ch.swisstopo.swissimage-product_1946/default/1946/3857/{z}/{x}/{y}.jpeg` | 17 | © swisstopo | 1946 aerial |
| `fr-etatmajor` | IGN WMTS KVP, `GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40`, jpeg | 15 | Licence Ouverte 2.0 | 1820–1866, Alsace/Lorraine/Saarland |
| `fr-etatmajor10` | `...ETATMAJOR10`, jpeg | 16 | same | Paris 1818–24 |
| `fr-scan50-1950` | `...MAPS.SCAN50.1950`, jpeg | 15 | same | post-war topo |
| `fr-cassini` | `...BNF-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI`, **png** | 14 | same | 18th century |
| `fr-ortho-1950` | `...ORTHOPHOTOS.1950-1965`, **png** | 18 | same | post-war aerial |
| `fr-ortho-1965` | `...ORTHOPHOTOS.1965-1980`, png | 18 | same | |
| `fr-ortho-1980` | `...ORTHOPHOTOS.1980-1995`, png | 18 | same | |
| `at-wien-1938` | `https://maps.wien.gv.at/wmts/lb1938/grau/google3857/{z}/{y}/{x}.jpeg` | 19 | Stadt Wien, CC BY 4.0 | variants 1938/1956/1976/1992 |
| `ch-zuerich-1850` | `https://wms.zh.ch/WildkarteZHWMS?...&bbox={bbox-epsg-3857}...` | 16 | GIS-ZH | WMS, CORS echoes origin |
| `uk-nls-6inch` | `https://mapseries-tilesets.s3.amazonaws.com/os/6inchfirst/{z}/{x}/{y}.png` | 17 | NLS, **CC BY-NC 4.0** | 1st/2nd edition variants |
| `no-historisk` | `https://wms.geonorge.no/skwms1/wms.historiskekart?...&bbox={bbox-epsg-3857}...` | 16 | Kartverket, CC BY 4.0 | Norway mosaic |
| `jp-gsi-ort` | `https://cyberjapandata.gsi.go.jp/xyz/ort/{z}/{x}/{y}.jpg` | 17 | GSI Japan | 1961–69 aerial |

**IGN WMTS KVP template** (all layers):

```text
https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0
&LAYER={LAYER}&STYLE=normal&TILEMATRIXSET=PM&FORMAT={FORMAT}
&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}
```

All tested IGN layers returned 200 with `Access-Control-Allow-Origin: *`. Use **png** for the 1950–1995 orthos, jpeg for the scanned topo series.

**Not a basemap (but valuable):** Allmaps turns any georeferenced IIIF sheet into XYZ tiles:

```text
https://allmaps.xyz/maps/{allmapsId}/{z}/{x}/{y}.png
```

Verified 200 + `*`. It is per-sheet, not a mosaic; use it for a "historical sheet of the week" or a deep link, not as a permanent basemap. David Rumsey IIIF is CORS-open and Allmaps-compatible (CC BY-NC-SA).

### 4.5 Thematic / activity basemaps

| id | URL | Max z | CORS | Verdict |
|---|---|---|---|---|
| `cyclosm` | `https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png` | 20 | `*` | **add** — cycling/hiking detail |
| `hot` | `https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png` | 19 | `*` | add |
| `openseamap` | `https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png` | 18 | `*` | overlay, not basemap |
| `opensnowmap` | `https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png` | 18 | `*` | overlay (ski) |
| `waymarked-hiking` | `https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png` | 18 | `*` | overlay |
| `osm-de` | `https://tile.openstreetmap.de/{z}/{x}/{y}.png` | 19 | `*` | conditional (policy) |
| `osm` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | 19 | `*` | avoid as default (policy) |
| `oepnvkarte` | `https://tile.memomaps.de/tilegen/{z}/{x}/{y}.png` | 18 | **none** | avoid (CORS) |
| `openrailwaymap` | `https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png` | 19 | UA-sensitive (403 for curl) | existing overlay; 512 px tiles |

OpenRailwayMap needs a browser-like UA/Referer; `curl` gets 403. It is not a general basemap, but the existing overlay deserves a health check.

## 5. Open APIs & archives

Beyond static XYZ, these are the APIs worth knowing:

| API / archive | What it gives | Auth | Use in this app |
|---|---|---|---|
| **NASA GIBS WMTS** | hundreds of near-real-time science layers (true colour, NDVI, IMERG, fires, sea ice, SST) | none | already used; extend layer catalog |
| **Copernicus Data Space / Sentinel Hub** | Sentinel-1/2/3/5P, custom evalscripts, STAC, OGC WMS | OAuth client (BYO, already supported) | "latest Sentinel-2 scene", SAR, false colour |
| **ESA Earth Search STAC** | free STAC search over Sentinel/Landsat | none | search + render, not a tile endpoint |
| **Microsoft Planetary Computer** | STAC + rendering | none/SAS | advanced imagery, needs backend or SAS tokens |
| **USGS TNM Access** | US imagery, elevation, hydro, historical quads | none | US travel mode |
| **swisstopo geo.admin.ch** | WMTS, height, search, vector tiles | none | DACH expansion |
| **IGN Géoplateforme** | WMTS/WMS/STAC, 758 layers incl. historical | none | France/border |
| **BKG basemap.de** | WMTS + vector tiles + styles | none | Germany |
| **basemap.at** | WMTS raster/vector, ortho, terrain | none | Austria |
| **PDOK** | BRT, luchtfoto, historical | none | Netherlands |
| **Kartverket/Geonorge** | topo, sjøkart, historical WMS | none | Norway |
| **LINZ** | NZ aerial imagery, vector basemaps | api_key | NZ travel |
| **Lantmäteriet / MML / Dataforsyningen** | SE/FI/DK topo + ortho | token/api-key | Nordic travel; not keyless |
| **GSI Japan** | current + 1960s aerial, scanned topo | none | Japan travel |
| **OpenAerialMap** | per-image TMS + metadata API | none | disaster/niche, no global mosaic |
| **Allmaps** | georeferencing annotations + XYZ tiles for IIIF | none | historical sheets |
| **IIIF (Rumsey, LoC, NYPL, NLS)** | image API per map | varies | needs Allmaps/georeferencing |
| **OldMapsOnline** | aggregator search API | key (401) | licensing blocker |
| **MapWarper** | georeferenced historical maps | none | degraded: blank tiles, no working API |
| **OpenHistoricalMap** | vector time-travel tiles + Overpass | none | already integrated |
| **EMODnet Bathymetry** | sea-floor XYZ | none | ocean context |
| **RainViewer** | radar frames via JSON + tiles | none | live weather overlay |
| **MapTiler / Stadia / Thunderforest / Mapbox** | commercial styles/tiles | key | not for a keyless static app |
| **Protomaps** | daily PMTiles builds | none (self-host) / key (API) | needs PMTiles protocol, not plain XYZ |
| **OSM tile servers** | raster OSM | none | policy-restricted; not for a popular app |

**Konkrete API-Einstiegspunkte**

| API | Endpoint |
|---|---|
| NASA GIBS WMTS | `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml` |
| Copernicus Data Space STAC | `https://catalogue.dataspace.copernicus.eu/stac` |
| Copernicus Sentinel Hub | `https://sh.dataspace.copernicus.eu` (OAuth) |
| ESA Earth Search STAC | `https://earth-search.aws.element84.com/v1` |
| Microsoft Planetary Computer | `https://planetarycomputer.microsoft.com/api/stac/v1` |
| USGS TNM Access | `https://tnmaccess.nationalmap.gov/api/v1/products` |
| swisstopo API | `https://api3.geo.admin.ch/rest/services/api/` |
| IGN Géoplateforme | `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetCapabilities` |
| BKG basemap.de | `https://sgx.geodatenzentrum.de/wmts_basemapde?REQUEST=GetCapabilities` |
| PDOK | `https://service.pdok.nl/` (WMTS/OGC API per dataset) |
| Kartverket/Geonorge | `https://wms.geonorge.no/skwms1/` |
| GSI Japan | `https://cyberjapandata.gsi.go.jp/xyz/{layer}/{z}/{x}/{y}.jpg` |
| OpenAerialMap | `https://api.openaerialmap.org/meta` |
| Allmaps | `https://api.allmaps.org/maps?query=...` · `https://annotations.allmaps.org/` |
| OpenHistoricalMap | `https://vtiles.openhistoricalmap.org/maps/ohm/{z}/{x}/{y}.pbf` |
| RainViewer | `https://api.rainviewer.com/public/weather-maps.json` |
| OldMapsOnline (paid) | `https://api.oldmapsonline.org/1.0/maps` |

### 5.1 Deliberately excluded

| Source | Why not |
|---|---|
| Google `mt{0-3}.google.com/vt/lyrs=s` | violates Google Maps Platform ToS; no public tile licence |
| Bing / Microsoft Virtual Earth | requires key/ToS; no free tile endpoint |
| Yandex / 2GIS / Amap (Gaode) | regional ToS, no reusable licence, unstable endpoints |
| Mapbox styles | access token would be exposed in client JS; paid |
| Maxar / Planet / Airbus | commercial contracts |
| Strava heatmap | OAuth token; not a basemap |
| MapLibre demotiles | z6 country outlines only |
| OldMapsOnline | paid API; unclear sub-licensing |
| MapWarper | degraded/blank tiles, no working discovery API |
| Arcanum/Mapire | tiles return blank 160-byte PNGs |
| Berlin/Hamburg archive WMS | no discoverable CORS-open endpoint |
| Munich historical WMS | EPSG:25832 only, blank in 3857 |
| Czech/Polish/Hungarian/Slovenian historical | portal-only, 401/403, or no public WMS |

## 6. Pitfalls and negative findings

These are the traps that look good in a catalogue but fail in a browser:

1. **Munich's historical aerial WMS is EPSG:25832 only.** `geoportal.muenchen.de/geoserver/wms` returns 200 for `CRS=EPSG:3857`, but the tile is a blank 1,671-byte PNG. The layer advertises `EPSG:25832` and `CRS:84`. Without a reprojection proxy it cannot be a MapLibre basemap — despite the attractive 1956–2023 series.
2. **CARTO raster tiles are keyless-blank.** `a.basemaps.cartocdn.com/dark_all/...png` returns a 2,513-byte blank PNG. CARTO's *vector* MVT endpoint (`tiles.basemaps.cartocdn.com/v/.../carto.streets/v2/{z}/{x}/{y}.mvt`) still returns real data with CORS `*`; the app's style-based CARTO entries are fine. Do not add CARTO raster tiles.
3. **Berlin and Hamburg historical city-map layers have no *discoverable* public CORS WMS.** Guessed FIS-Broker/Geodienste paths 404; the content exists behind portals, and the service names are not guessable. General state WMS do exist (and can be used via `{bbox-epsg-3857}`, see item 15), but the historical Berlin/Hamburg layers need a per-layer discovery spike, not a feature promise.
4. **NLS tiles only send CORS when an `Origin` header is present.** In a browser that is always true; `curl` without `Origin` looks like no CORS. The licence is **CC BY-NC 4.0** — fine for a free app, not for a paid tier.
5. **OSM standard tiles are policy-restricted.** `tile.openstreetmap.org` may return HTTP 200 with a "blocked" tile when the UA/Referer looks automated. No bulk/prefetch; visible attribution; best-effort. Keep OSM out of the default set.
6. **OldMapsOnline is a paid API (401)** and re-hosts other institutions' scans; sub-licensing is murky.
7. **MapWarper is degraded**: tile URLs return 200 but often a 334-byte transparent PNG; the IIIF/API endpoints 404.
8. **USGS historical topo has no public XYZ tiles.** The quads are per-GeoTIFF; hosting them is a separate project.
9. **Estonia's historical WMS is EPSG:3301 only**; Czech/Polish/Hungarian/Slovenian **historical archive** services are largely portal-only or 401/403 (current orthos/topos are fine, see §4.3.1). Do not promise a seamless "European historical basemap" from these.
10. **GIBS true colour lags.** 2026-11-17 was blank at z5/z6 while 2026-11-16 was fine. Do not label it "yesterday" without a fallback.
11. **WMS basemaps have no tile cache.** Each pan triggers a render; do not stack five WMS layers. Use them for one historical layer at a time.
12. **`maxzoom` is source resolution.** Vienna serves z19 but the 1938 scan stops resolving around z17; MapLibre upscales. That is acceptable, but label it.
13. **basemap.de has two path generations.** `/wmts_basemapde/1.0.0/dtk/...` and similar old paths return 500/blank; use `/tile/1.0.0/.../GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png`. The `Accept` header does not matter (verified with `*/*`).
14. **Axis order differs per provider.** swisstopo/PDOK/Bayern use `{z}/{x}/{y}`; basemap.at/Kartverket/Esri/GSI/Vienna use `{z}/{y}/{x}`. A wrong order usually gives a blank tile with HTTP 200, not an error.
15. **German state WMS are not XYZ, but they are not dead.** NRW/Sachsen/Hessen etc. expose WMS with CORS; MapLibre can consume them through `{bbox-epsg-3857}` (256×256). That is a valid fallback when a state has no public XYZ/WMTS, at the cost of per-pan rendering.
16. **Italy PCN redirects HTTPS→HTTP**, which browsers block as mixed content. Not usable in a static HTTPS app without a proxy.

## 7. Architecture & UI recommendations

### 7.1 Extend the `Basemap` model (minimal, backwards-compatible)

```ts
export type BasemapGroup = "global" | "dach" | "europe" | "historical" | "thematic";

export interface Basemap {
  id: string;
  label: string;
  subtitle?: string;
  kind: "raster" | "style";
  category: BasemapCategory;      // keep: drives Image/Vector switch
  group?: BasemapGroup;           // new: picker section
  provider?: string;              // new: "swisstopo", "IGN", "basemap.at"
  license?: string;               // new: "CC BY 4.0", "DL-DE-BY 2.0"
  coverage?: [number, number, number, number]; // new: W,S,E,N
  url: string;
  maxzoom?: number;
  attribution: string;
  tileSize?: number;
  variants?: BasemapVariantSpec;
}
```

- Keep `category` for the existing Image/Vector/Hybrid mode. Do **not** add a third category; it would break `basemapMode`, the hybrid overlay and settings migration.
- Add `group` for the picker: **Global**, **DACH**, **Europa**, **Historisch**, **Thematisch**.
- Add `provider`/`license` for a small badge in the picker and for the data-sources panel.
- Add `coverage` to show "outside coverage" instead of a silent blank map.

### 7.2 Picker

Current panel: two flat lists. Proposal, in the existing compact style:

1. A row of small segmented filters (`Global · DACH · Historisch · Mehr`) above the list.
2. Collapsible groups; remember the last expanded group.
3. Each row: label, subtitle, provider/licence badge; selected state unchanged.
4. A "Zuletzt verwendet" group (2–3 entries) above the filters.
5. For regional layers, a subtle "nur AT/CH/DE" hint from `coverage`.

Do not add search until the list exceeds ~30 entries; a compact filter row is enough.

### 7.3 Variant control

`TimelineYearTab` is hard-coded to Sentinel-2. Generalise it:

- `BasemapVariantControl` reads `basemap.variants` for the active basemap.
- Few options (≤8): chips, as today.
- Many options (Siegfried 80 years, Zeitreihen 178): a `<select>` or a slider with a year label.
- Persist the choice in `basemapVariants[id]` (already the case).
- For historical series, default to a representative year (e.g. Siegfried 1926, Zeitreihen 1970).

### 7.4 Robustness

- **Style load failure:** the OHM swap already has a 12 s timeout and revert. Reuse that pattern for any new style URL (OpenFreeMap/VersaTiles/basemap.de) so a provider outage does not leave a blank map.
- **Tile errors:** MapLibre silently shows nothing. Add a per-source `error` listener in development, or a tiny "Quelle nicht erreichbar" hint after N failures.
- **GIBS date:** resolve the date at render time and fall back one day if the first tile probe fails; cache the probe result per session (the app already has a module-level probe cache for GIBS).
- **Attribution:** raster sources already carry it. For style sources, verify the style's `sources[*].attribution` is present (OpenFreeMap/VersaTiles include it); otherwise add a manual attribution overlay.

### 7.5 Tests

- Unit: unique ids, non-empty label/attribution, URL contains `{z}`, `{x}`, `{y}` or `{bbox-epsg-3857}` for raster, `https://` for style.
- Unit: every `variants.defaultId` exists in `options`; placeholder occurs in `url`.
- Optional CI smoke test (network, not blocking): fetch one tile per basemap at a representative coordinate; assert 200 + image content-type + ACAO. Keep it out of the default `npm test`.
- Settings migration: unknown ids already fall back; add a test for a new group/provider field being ignored by old persisted state.

## 8. Phased roadmap

### Phase 1 — quick wins (no UI rework, ~10 entries)

1. `ofm-dark`, `ofm-liberty`, `ofm-bright` (style)
2. `vt-eclipse` (style)
3. `de-basemap-col`, `de-basemap-gry` (raster, z19)
4. `at-geoland`, `at-ortho` (raster)
5. `ch-pixelkarte`, `ch-swissimage` (raster)
6. `esri-topo`, `cyclosm` (raster)
7. `de-topplusopen`, `de-by-amtl` (raster, optional)

This alone fills the biggest gaps: keyless vector fallback, DACH official maps, a topo fallback and a cycling style.

### Phase 2 — history & aerial (~8 entries + variant control)

1. `ch-siegfried` + variants
2. `ch-dufour`
3. `ch-zeitreihen` + year select
4. `fr-etatmajor`
5. `fr-scan50-1950`
6. `at-wien-1938` + variants
7. `ch-zuerich-1850`
8. `uk-nls-6inch` (NC licence badge)
9. `no-historisk`

Requires the generic variant control; until then, use fixed years (e.g. Siegfried 1926, Zeitreihen 1970) as separate entries.

### Phase 3 — breadth (~10 entries)

PDOK BRT + Luchtfoto (NL), Kartverket topo + sjøkart (NO), IGN Plan/Ortho (FR), USGS (US), GSI seamless/pale/gazo1 (JP), ČÚZK (CZ), GUGiK (PL), IGN España (ES), NSW Imagery (AU), EMODnet, GIBS Blue Marble, Esri Ocean/NatGeo/Canvas, OpenFreeMap Fiord. LINZ/SE/FI/DK only with a key.

Optional, only with the existing BYO credentials: **Sentinel-2 latest scene** (CDSE/Sentinel Hub WMS with a custom evalscript) and **Sentinel-1 SAR** (false colour). These need a token per request and should be marked "eigene Zugangsdaten" in the picker, not part of the keyless default set.

### Phase 4 — polish

Group filters, recents/favourites, coverage hints, licence badges, style-load fallback, optional CI smoke test.

## 9. Ready-to-paste entries

These match the current interface. Add `group`/`provider`/`license` after §7.1 lands; they are omitted here so the objects compile today.

```ts
const OFM = "https://tiles.openfreemap.org/styles";
const VT = "https://tiles.versatiles.org/assets/styles";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";
const SWISS = "https://wmts.geo.admin.ch/1.0.0";
const IGN = "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0";

export const NEW_BASEMAPS: Basemap[] = [
  // ── keyless vector ────────────────────────────────────────────────
  {
    id: "ofm-dark",
    label: "OpenFreeMap · Dark",
    subtitle: "OSM vector · keyless",
    kind: "style",
    category: "vector",
    url: `${OFM}/dark`,
    maxzoom: 14,
    attribution:
      'OpenFreeMap © OpenMapTiles · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  },
  {
    id: "ofm-liberty",
    label: "OpenFreeMap · Liberty",
    kind: "style",
    category: "vector",
    url: `${OFM}/liberty`,
    maxzoom: 14,
    attribution:
      'OpenFreeMap © OpenMapTiles · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  },
  {
    id: "ofm-bright",
    label: "OpenFreeMap · Bright",
    kind: "style",
    category: "vector",
    url: `${OFM}/bright`,
    maxzoom: 14,
    attribution:
      'OpenFreeMap © OpenMapTiles · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  },
  {
    id: "vt-eclipse",
    label: "VersaTiles · Eclipse",
    subtitle: "dark · keyless",
    kind: "style",
    category: "vector",
    url: `${VT}/eclipse/style.json`,
    maxzoom: 14,
    attribution:
      'VersaTiles · © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
  },

  // ── Germany ───────────────────────────────────────────────────────
  {
    id: "de-basemap-col",
    label: "basemap.de · Farbe",
    subtitle: "BKG · amtliche Webkarte · z19",
    kind: "raster",
    category: "vector",
    url: "https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png",
    maxzoom: 19,
    attribution:
      '© <a href="https://basemap.de/" target="_blank" rel="noreferrer">basemap.de</a> · © GeoBasis-DE / BKG (2026) · DL-DE-BY 2.0',
  },
  {
    id: "de-basemap-gry",
    label: "basemap.de · Grau",
    subtitle: "BKG · amtliche Webkarte · z19",
    kind: "raster",
    category: "vector",
    url: "https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_grau/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png",
    maxzoom: 19,
    attribution:
      '© <a href="https://basemap.de/" target="_blank" rel="noreferrer">basemap.de</a> · © GeoBasis-DE / BKG (2026) · DL-DE-BY 2.0',
  },

  // ── Austria (row before column!) ──────────────────────────────────
  {
    id: "at-geoland",
    label: "basemap.at",
    subtitle: "amtliche Österreich-Karte · 1:5k–1:1M",
    kind: "raster",
    category: "vector",
    url: "https://mapsneu.wien.gv.at/basemap/geolandbasemap/normal/google3857/{z}/{y}/{x}.png",
    maxzoom: 18,
    attribution:
      '© <a href="https://basemap.at/" target="_blank" rel="noreferrer">basemap.at</a> · CC BY 4.0',
  },
  {
    id: "at-grau",
    label: "basemap.at · Grau",
    kind: "raster",
    category: "vector",
    url: "https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png",
    maxzoom: 18,
    attribution:
      '© <a href="https://basemap.at/" target="_blank" rel="noreferrer">basemap.at</a> · CC BY 4.0',
  },
  {
    id: "at-ortho",
    label: "Österreich · Orthofoto",
    subtitle: "basemap.at · 30 cm",
    kind: "raster",
    category: "photo",
    url: "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
    maxzoom: 18,
    attribution:
      '© <a href="https://basemap.at/" target="_blank" rel="noreferrer">basemap.at</a> · CC BY 4.0',
  },

  // ── Switzerland ───────────────────────────────────────────────────
  {
    id: "ch-pixelkarte",
    label: "Swisstopo · Landeskarte",
    subtitle: "amtliche Schweiz-Karte",
    kind: "raster",
    category: "vector",
    url: `${SWISS}/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg`,
    maxzoom: 19,
    attribution:
      '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noreferrer">swisstopo</a>',
  },
  {
    id: "ch-swissimage",
    label: "Swisstopo · SWISSIMAGE",
    subtitle: "Orthofoto · 10–25 cm",
    kind: "raster",
    category: "photo",
    url: `${SWISS}/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg`,
    maxzoom: 19,
    attribution:
      '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noreferrer">swisstopo</a>',
  },
  {
    id: "ch-siegfried",
    label: "Siegfriedkarte",
    subtitle: "swisstopo 1:25 000 · ${year}",
    kind: "raster",
    category: "photo",
    // Double quotes keep ${year} literal; resolveBasemapUrl() substitutes it.
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.hiks-siegfried/default/${year}/3857/{z}/{x}/{y}.png",
    maxzoom: 17,
    attribution:
      '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noreferrer">swisstopo</a>',
    variants: {
      placeholder: "${year}",
      options: ["1890", "1900", "1910", "1926", "1940", "1949"].map((y) => ({
        id: y,
        label: y,
        urlValue: y,
      })),
      defaultId: "1926",
    },
  },
  {
    id: "ch-dufour",
    label: "Dufourkarte",
    subtitle: "swisstopo 1:100 000 · 1845–1865",
    kind: "raster",
    category: "photo",
    url: `${SWISS}/ch.swisstopo.hiks-dufour/default/current/3857/{z}/{x}/{y}.png`,
    maxzoom: 15,
    attribution:
      '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noreferrer">swisstopo</a>',
  },
  {
    id: "ch-zeitreihen",
    label: "Swisstopo · Zeitreise",
    subtitle: "Historisches Orthofoto · ${year}",
    kind: "raster",
    category: "photo",
    // ${year} is replaced with e.g. 1970, producing 19701231.
    url: "https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.zeitreihen/default/${year}1231/3857/{z}/{x}/{y}.png",
    maxzoom: 17,
    attribution:
      '© <a href="https://www.swisstopo.admin.ch/" target="_blank" rel="noreferrer">swisstopo</a>',
    variants: {
      placeholder: "${year}",
      options: ["1950", "1970", "1990", "2010", "2021"].map((y) => ({
        id: y,
        label: y,
        urlValue: y,
      })),
      defaultId: "1970",
    },
  },
  {
    id: "at-wien-1938",
    label: "Wien · Luftbild",
    subtitle: "Stadt Wien · ${year}",
    kind: "raster",
    category: "photo",
    url: "https://maps.wien.gv.at/wmts/${year}/grau/google3857/{z}/{y}/{x}.jpeg",
    maxzoom: 19,
    attribution:
      '© <a href="https://www.wien.gv.at/" target="_blank" rel="noreferrer">Stadt Wien</a> (MA 41) · CC BY 4.0',
    variants: {
      placeholder: "${year}",
      options: ["1938", "1956", "1976", "1992"].map((y) => ({
        id: y,
        label: y,
        urlValue: `lb${y}`,
      })),
      defaultId: "1938",
    },
  },

  // ── France ────────────────────────────────────────────────────────
  {
    id: "fr-etatmajor",
    label: "État-Major 1820–1866",
    subtitle: "IGN · Alsace/Lorraine/Saarland",
    kind: "raster",
    category: "photo",
    url: `${IGN}&LAYER=GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`,
    maxzoom: 15,
    attribution:
      '© <a href="https://www.ign.fr/" target="_blank" rel="noreferrer">IGN</a> · Licence Ouverte 2.0',
  },
  {
    id: "fr-scan50-1950",
    label: "France 1950",
    subtitle: "IGN SCAN50 · Nachkriegs-Topo",
    kind: "raster",
    category: "photo",
    url: `${IGN}&LAYER=GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN50.1950&STYLE=normal&TILEMATRIXSET=PM&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`,
    maxzoom: 15,
    attribution:
      '© <a href="https://www.ign.fr/" target="_blank" rel="noreferrer">IGN</a> · Licence Ouverte 2.0',
  },

  // ── global fallbacks ──────────────────────────────────────────────
  {
    id: "esri-topo",
    label: "Esri · World Topo",
    kind: "raster",
    category: "vector",
    url: `${ESRI}/World_Topo_Map/MapServer/tile/{z}/{y}/{x}`,
    maxzoom: 19,
    attribution:
      'Esri, HERE, Garmin, USGS, Intermap, INCREMENT P, NRCan, © OpenStreetMap contributors',
  },
  {
    id: "cyclosm",
    label: "CyclOSM",
    subtitle: "Rad- und Wanderwege",
    kind: "raster",
    category: "vector",
    url: "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    maxzoom: 20,
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · CyclOSM',
  },
];
```

> `ch-siegfried` is deliberately a double-quoted string: `${year}` must stay literal so `resolveBasemapUrl()` can substitute the selected variant.

## 10. Verification log (2026-11-18)

| Endpoint | Status | ACAO | Content | Max z |
|---|---|---|---|---|
| `tiles.openfreemap.org/styles/dark` | 200 | `*` | JSON 20 KB | 14 |
| `tiles.openfreemap.org/styles/liberty` | 200 | `*` | JSON 43 KB | 14 |
| `tiles.versatiles.org/assets/styles/eclipse/style.json` | 200 | `*` | JSON 164 KB | 14 |
| `basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` | 200 | `*` | JSON 67 KB | 15 |
| `tiles.basemaps.cartocdn.com/.../carto.streets/v2/12/2100/1400.mvt` | 200 | `*` | MVT 18 KB | 15 |
| `a.basemaps.cartocdn.com/dark_all/12/2100/1400.png` | 200 | — | PNG 2.5 KB **blank** | — |
| `sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json` | 200 | echo | JSON 502 KB | 15 |
| `sgx.geodatenzentrum.de/wmts_basemapde/tile/.../de_basemapde_web_raster_farbe/.../12/1343/2200.png` | 200 | echo | PNG 150 KB | 19 |
| `sgx.geodatenzentrum.de/wmts_topplus_open/.../12/1343/2200.png` | 200 | echo | PNG 20 KB | 17 |
| `wmtsod1.bayernwolke.de/wmts/by_amtl_karte/smerc/12/2179/1421` | 200 | `*` | PNG 39 KB | 19 |
| `mapsneu.wien.gv.at/.../geolandbasemap/.../14/5681/8937.png` | 200 | `*` | PNG 99 KB | 18 |
| `mapsneu.wien.gv.at/.../bmaporthofoto30cm/.../14/5681/8937.jpeg` | 200 | `*` | JPEG 25 KB | 18 |
| `wmts.geo.admin.ch/.../pixelkarte-farbe/.../12/2148/1432.jpeg` | 200 | `*` | JPEG 24 KB | 18 |
| `wmts.geo.admin.ch/.../swissimage/.../18/137472/91648.jpeg` | 200 | `*` | JPEG 15 KB | 18 |
| `wmts.geo.admin.ch/.../hiks-siegfried/default/1926/.../14/8592/5728.png` | 200 | `*` | PNG 148 KB | 17 |
| `wmts.geo.admin.ch/.../hiks-dufour/.../12/2148/1432.png` | 200 | `*` | PNG 96 KB | 15 |
| `wmts.geo.admin.ch/.../zeitreihen/default/18641231/.../12/2148/1432.png` | 200 | `*` | PNG 94 KB | 17 |
| `data.geopf.fr/wmts?...ETATMAJOR40...15/11272/16592` | 200 | `*` | JPEG 16 KB | 15 |
| `data.geopf.fr/wmts?...ORTHOPHOTOS.1950-1965...` | 200 | `*` | PNG 61 KB | 18 |
| `maps.wien.gv.at/wmts/lb1938/grau/google3857/14/5681/8937.jpeg` | 200 | `*` | JPEG 21 KB | 19 |
| `wms.zh.ch/WildkarteZHWMS?...bbox=...` | 200 | echo | PNG 159 KB | 16 |
| `wms.geonorge.no/skwms1/wms.historiskekart?...bbox=...` | 200 | `*` | PNG 113 KB | 16 |
| `mapseries-tilesets.s3.amazonaws.com/os/6inchfirst/14/8046/5105.png` | 200 | `*` (with Origin) | PNG 55 KB | 17 |
| `service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/14/8415/5384.png` | 200 | `*` | PNG 66 KB | 19 |
| `ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/12/1373/2216` | 200 | echo | PNG 32 KB | 20 |
| `ags.cuzk.gov.cz/arcgis1/rest/services/ZTM_WM/MapServer/tile/12/1373/2216` | 200 | echo | JPEG 14 KB | 20 |
| `mapy.geoportal.gov.pl/.../ORTOFOTOMAPA.../12/1343/2260` | 200 | `*` | JPEG 12 KB | 18 |
| `www.ign.es/wmts/ign-base?...IGNBaseTodo.../12/1541/2017` | 200 | `*` | JPEG 10 KB | 18 |
| `cyberjapandata.gsi.go.jp/xyz/seamlessphoto/14/14552/6451.jpg` | 200 | `*` | JPEG 23 KB | 18 |
| `cyberjapandata.gsi.go.jp/xyz/gazo1/14/14552/6451.jpg` | 200 | `*` | JPEG 34 KB | 17 |
| `cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/14/4766/8681.png` | 200 | `*` | PNG 100 KB | 18 |
| `basemap.nationalmap.gov/.../USGSImageryOnly/MapServer/tile/5/12/6` | 200 | `*` | JPEG 22 KB | 16 |
| `server.arcgisonline.com/.../World_Topo_Map/.../5/10/17` | 200 | `*` | JPEG 45 KB | 19 |
| `gibs.earthdata.nasa.gov/.../BlueMarble_NextGeneration/.../5/10/17.jpeg` | 200 | `*` | JPEG 18 KB | 8 |
| `gibs.earthdata.nasa.gov/.../VIIRS_NOAA20_.../2026-11-17/.../5/10/17.jpg` | 200 | `*` | JPEG **1.7 KB blank** | 9 |
| `gibs.earthdata.nasa.gov/.../VIIRS_NOAA20_.../2026-11-16/.../5/10/17.jpg` | 200 | `*` | JPEG 16 KB | 9 |
| `tiles.emodnet-bathymetry.eu/2020/baselayer/web_mercator/...` | 200 | `*` | PNG | 13 |
| `a.tile-cyclosm.openstreetmap.fr/cyclosm/12/2100/1400.png` | 200 | `*` | PNG 40 KB | 20 |
| `a.tile.openstreetmap.fr/hot/12/2100/1400.png` | 200 | `*` | PNG 13 KB | 19 |
| `tile.memomaps.de/tilegen/12/2100/1400.png` | 200 | **none** | PNG 16 KB | 18 |
| `a.tiles.openrailwaymap.org/standard/12/2200/1343.png` (curl UA) | 403 | `*` | HTML | — |
| `.../standard/12/2200/1343.png` (Chrome UA) | 200 | `*` | PNG 44 KB, 512×512 | 19 |
| `geoportal.muenchen.de/geoserver/wms?...luftbild_1956...3857` | 200 | `*` | PNG 1.7 KB **blank** | 25832 only |

## 11. Implementation status (2026-11-18)

Implemented in this change set:

- `src/lib/basemaps.ts`: **63 basemaps** in five groups (`global`, `dach`, `europe`, `historical`, `thematic`), each with `provider`, `license`, `coverage` and optional WGS84 `bounds`.
- Picker: group filter chips, counts, **year/edition variants** inline (chips ≤8 options, native select for longer series), provider/licence line, and an "Outside coverage" warning derived from the map centre.
- Regional raster sources now pass `bounds` to MapLibre, so out-of-coverage tile requests are avoided.
- Style watchdog: a remote vector style that does not load within 12 s falls back to the CARTO dark default.
- GIBS: basemap and Live timeline now use a **2-day lag** to avoid blank high-zoom tiles.
- Tests: `src/lib/basemaps.test.ts` (ids, metadata, URL templates, variant defaults, group filter, GIBS date); full suite 265 tests green, `next build` green.
- Data sources panel and README list the new providers.

## 12. Sources

- OpenFreeMap: <https://openfreemap.org/>
- VersaTiles: <https://versatiles.org/>
- basemap.de: <https://basemap.de/>
- basemap.at: <https://basemap.at/>
- swisstopo WMTS: <https://www.swisstopo.admin.ch/en/geodata/maps/>
- IGN Géoplateforme: <https://geoservices.ign.fr/>
- Vienna maps: <https://www.wien.gv.at/stadtplanung/karten>
- Stadt Zürich GIS: <https://geo.zh.ch/>
- National Library of Scotland: <https://maps.nls.uk/>
- Kartverket/Geonorge: <https://www.geonorge.no/>
- PDOK: <https://www.pdok.nl/>
- USGS National Map: <https://basemap.nationalmap.gov/>
- NASA GIBS: <https://earthdata.nasa.gov/gibs>
- EOX: <https://s2maps.eu/>
- EMODnet: <https://emodnet.ec.europa.eu/en/bathymetry>
- OpenHistoricalMap: <https://www.openhistoricalmap.org/>
- Allmaps: <https://allmaps.org/>
- OSM tile policy: <https://operations.osmfoundation.org/policies/tiles/>
