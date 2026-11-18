# History Worldwide — Design Spec

_2026-11-18 · KugelMaps History tab · status: proposed_

## 1. Intent

Turn the History tab from a local, live-API tile viewer into a professional
worldwide historic-sites tool: instant global overview at every zoom, date
and category filtering, clustering, rich detail cards, and predictable
behaviour when public APIs are slow or down. Local OSM detail follows in
v1.1; v1 proves the worldwide, static foundation first.

The tab should feel like a curated map product, not a debug view of two
APIs.

## 2. Today (problem statement)

- Fresh data only loads when the viewport intersects at most 120 z9 tiles.
  On a 1440×900 desktop a z9 tile is 128 px at z8, so ~79–96 tiles load;
  at z7 it is 64 px, so ~315 tiles exceed the cap. Fresh desktop data
  therefore starts at **z8** (z7 on a 390×700 phone); z4–7 are blocked by
  the tile cap, and z<4 by the explicit zoom guard. World and continent
  views are empty on a fresh session.
- Every tile makes one Overpass and one Wikidata request. Dense cities hit
  `LIMIT 400`; public endpoints rate-limit; the 12 s Overpass budget can
  make a country view take minutes.
- No clustering, no category filter, no nearby list, no offline dataset.
- OSM is dense in Europe and sparse elsewhere; Wikidata is broad but noisy
  (tram stops, streets, artworks).
- Antimeridian/pole handling and OSM relations were fixed in the previous
  pass; the remaining limits are architectural.

## 3. Goals

1. **Worldwide from zoom 0 (v1)**: a meaningful global/continental view
   without live API fan-out.
2. **Fast (v1)**: first useful paint < 1 s on a normal connection;
   pan/zoom never triggers more than a handful of requests; no UI freeze.
3. **Local depth (v1.1)**: OSM `historic=*` richness at city/region zoom,
   including recent changes not yet in the global snapshot.
4. **Curated quality (v1)**: categories, heritage/UNESCO flags, readable
   names, honest filters.
5. **Resilient (v1)**: static dataset works if Overpass/Wikidata are down;
   clear source health and data-as-of label.
6. **Client-only (v1)**: no backend, no accounts, no tracking; static
   hosting remains possible.
7. **Maintainable (v1)**: reproducible data pipeline, schema validation,
   size budgets, artifact-level tests.

## 4. Non-goals

- Real-time editing or contribution to OSM/Wikidata.
- A complete OSM planet import in this phase.
- User accounts, saved collections, server-side search.
- Replacing the OHM time-travel basemap; this spec is about the landmark
  layer and its UI.
- Full text search over every historic site; viewport/city-level discovery
  is the v1 scope, nearby lists come later.

## 5. Constraints

- Next.js 16 static export (`output: "export"`), GitHub Pages deployment.
- MapLibre GL JS 5.x, React 19, Zustand.
- Existing code style and 4 px UI grid; no emoji in source.
- Public data only: Wikidata CC0, OSM ODbL (attribution required).
- GitHub Actions: 6 h job limit, 1 GB Pages site, 100 MB per git file.
- The app must keep working if the new data asset is missing (fallback to
  the current live loader at high zoom).

## 6. Approaches considered

### A. Runtime adaptive tiling only
Choose a coarser z-tile at low map zoom, raise limits, cache in IndexedDB.
No build pipeline. **Rejected as the primary strategy:** a world view still
needs one global query per source, results are capped at a few hundred
points, and the experience depends on Overpass/Wikidata availability. It
remains useful as the high-zoom detail path.

### B. Static global dataset only
Build one global PMTiles archive and use it for all zooms. **Rejected as
the final strategy:** fast and reliable, but misses OSM-only sites, local
detail, and new data between builds. It is the right **v1** foundation,
with live local detail added in v1.1.

### C. Hybrid: static global base + live local detail — **recommended**
- **v1:** a build-time **global dataset** (curated Wikidata heritage/historic
  sites) served as PMTiles. Covers z0–9: H3 clusters at z0–7, individual
  sites at z8–9 (overzoomed above).
- **v1.1:** the existing **live OSM loader** at z11+ for local density and
  freshness, zoom-separated from the global sites (global sites hidden
  above z10), with adaptive tile zoom and an IndexedDB cache. No dedupe
  dependency: the two layers never render the same zoom.
- Detail cards enrich on click (Wikipedia/Commons), not at tile load.
This gives instant worldwide coverage in v1 and keeps the local richness
as a low-risk follow-up.

### D. Commercial tile provider
No provider offers a heritage-specific global layer with the required
filters and licensing; adds cost and a network dependency. **Rejected.**

## 7. Design

### 7.1 Data model

**Tile shape (must stay small — this is what ships in MVT):**

```ts
interface HistoricSiteTile {
  id: string;                 // "wd/Q123"
  name: string;               // English label for map display
  category: HistoricCategory; // castle | religious | archaeological |
                              // memorial | battlefield | industrial |
                              // museum | other
  inception?: number;         // year, negative = BCE
  dissolved?: number;
  heritage: boolean;          // P1435
  unesco: boolean;            // P1435 = Q9259
  qid: string;                // "Q123" for click-time detail
}
```

**Detail shape (resolved on click, never in the tiles):**

```ts
interface HistoricSiteDetail {
  summary: WikipediaSummary | null;  // via fetchWikipediaSummaryFromQid
  image: string | null;              // via fetchWikidataImage (P18)
  kind?: string;                     // raw Wikidata type label
  wikipedia?: string;
  osm?: string;
}
```

Categorization is a pure function from Wikidata `P31` QIDs and OSM
`historic=*` values to the enum. Unknown kinds stay `other`; the raw kind
is resolved for the popup.

v1 data targets **heritage-first ~250k sites**. Ancient sites keep their
negative years; the slider starts at 1500, so they are visible from the
first slider position (they existed). Undated sites are always visible
with a muted style and a “date unknown” badge; they are not hidden until
2000.

### 7.2 Global dataset build

**Source of truth:** Wikidata via the QLever Wikidata endpoint (fast,
supports large CSV exports), with WDQS as a fallback. The reviewed
`scripts/history/scope.rq` defines the scope:

- Include if the item has `P625` and any of:
  - `P31/P279*` within heritage roots: cultural heritage (`Q210272`),
    heritage site (`Q358`), historic site (`Q1081138`), architectural
    landmark (`Q2319498`);
  - `P1435` heritage designation (with a cultural-heritage class or
    historic type);
  - a reviewed historic class allowlist (castle, archaeological site,
    ruins, battlefield, religious building, monastery, fortification,
    palace/château, tower, city gate, industrial heritage, museum).
- Exclude humans, events, organizations, administrative areas, cities,
  artworks/publications, transport infrastructure (stations, tram stops,
  streets, bridges unless heritage), natural protected areas, generic
  memorials/churches without a heritage designation or inception, and
  items without an English label or coordinate.
- One row per item: `P571`, `P576`, `P1435`, `P31`, English `rdfs:label`;
  `GROUP_CONCAT` the types, `MIN`/`MAX` the dates. Do **not** fetch
  `P18`/Wikipedia in the tile build; those are click-time.
- Target **~250k sites**; the spike measures the class distribution. If
  the build exceeds the budget, keep heritage-designated sites first,
  then dated historic classes, then the rest.

**Build steps:**
1. Query QLever in keyset-paginated pages (`FILTER(?item > <last IRI>)`,
   `ORDER BY ?item LIMIT 10000`), writing one CSV per page and a cursor.
2. Normalize to the tile shape, categorize, dedupe by QID.
3. Write `sites.geojsonl`.
4. Build low-zoom **H3 clusters** (build-only `h3-js`):
   - z0–1: res 1; z2–3: res 2; z4–5: res 3; z6–7: res 4.
   - cluster fields: `count`, `heritageCount`, `unescoCount`; nested
     `tippecanoe: { minzoom, maxzoom }` with non-overlapping bands.
   - cap each band at 5,000 features by merging to a coarser resolution.
5. Tippecanoe:
   - `history-clusters-<min>-<max>.pmtiles` (one per band: 0–1, 2–3,
     4–5, 6–7), layer `history_clusters`.
   - `history-sites.pmtiles` z8–9, layer `history_sites`.
   - Point features, `--drop-densest-as-needed`, size budget.
6. Validate: schema, duplicate IDs, coordinate ranges, category
   distribution, **tile content** (layer name, z2 cluster count sum ≈
   site count, z8 Düsseldorf > 0, antimeridian cluster), sample sites,
   file size, SHA-256.
7. Write a versioned `manifest.json`:
   ```json
   {
     "schema": 1,
     "buildId": "history-20261118-0400",
     "builtAt": "2026-11-18T04:00:00Z",
     "counts": { "sites": 250000, "clusters": 40000 },
     "files": {
       "clusters": [
         { "path": "history-20261118-0400/history-clusters-0-1.pmtiles",
           "bytes": 123, "sha256": "...", "minzoom": 0, "maxzoom": 1 }
       ],
       "sites": { "path": "history-20261118-0400/history-sites.pmtiles",
                  "bytes": 456, "sha256": "..." }
     },
     "attribution": ["Wikidata contributors (CC0)", "..."]
   }
   ```

**Size budget:** target **25 MB**, hard **40 MB**. The hard limit fails
the data build, not the app deploy. A 25–40 MB archive emits a warning and
a reduced variant (lower site cap or maxzoom 8). Versioned filenames plus
the SHA-256 prevent mixed old-directory/new-data responses through CDNs.

**Update cadence:** monthly GitHub Actions data workflow (separate from
the app deploy), publishing a GitHub Release asset and a workflow
artifact. The deploy workflow downloads the latest release into
`public/data/history/<buildId>/`; if that fails, it deploys the app
without data and the runtime falls back to the existing live loader.
The data URL is configurable (`NEXT_PUBLIC_HISTORY_DATA_URL`) for an
S3/R2 bucket with correct range/CORS.

**GitHub Pages range risk:** Firefox + GitHub Pages can return a **206
with `Content-Encoding: gzip`**, which corrupts PMTiles offsets. The
runtime probe requests `Range: bytes=0-7` and accepts range mode only
when the response is 206, has no content-encoding (or identity), has a
matching `content-range`, returns exactly 8 bytes, and starts with the
`PMTiles` magic + version byte 3. A gzip 206 falls back to a full fetch
(reusing a 200 body when the server ignores Range); the blob is cached
and the archive is opened via `FileSource` keyed as `history.pmtiles`.
Gate the full download on `navigator.connection?.saveData` and show an
explicit “load global dataset” action on metered connections.

### 7.3 Runtime: global layer (v1)

- Register one `pmtiles` protocol at app startup; add the opened archive
  to the protocol explicitly.
- Probe range support before creating the source; full mode uses a
  `FileSource` keyed by the archive basename
  (`history-clusters-<min>-<max>.pmtiles`, `history-sites.pmtiles`) so the
  five archives do not collide.
- Add two MapLibre sources with **absolute** `pmtiles://` URLs:
  - `history-global-clusters` (vector, z0–7), circle layer with count
    labels.
  - `history-global-sites` (vector, z8–9, overzoomed above), circle +
    label layers. In v1.1 the layer gets `maxzoom: 10` and local OSM
    starts at z11.
- Style: muted heritage dot, accent for UNESCO, cluster circle with count.
- Filters:
  - clusters: heritage/UNESCO only (using `heritageCount`/`unescoCount`;
    no year or category filter). Clicking a cluster zooms in.
  - sites (z8+): category, heritage, UNESCO, and year. Undated sites pass
    at every year with a muted style. The panel shows the hint
    “Year and category filters from city zoom (z8)”.
- Add/remove/re-add on style swaps (`style.load`); insert below the first
  symbol layer when present so basemap labels stay readable.
- Count from `querySourceFeatures` after `idle`; never use it for
  correctness or dedupe.

### 7.4 Runtime: local live layer (v1.1)

Deferred; not part of v1. In v1, when the global dataset is ready, the
legacy “Historic landmarks” switch is disabled with the hint “covered by
the global dataset” to avoid duplicate dots. If the global dataset is
missing, the legacy switch stays enabled as the fallback. v1.1 will:

- run OSM-only (no Wikidata SPARQL per tile) at map zoom ≥ 11;
- use global sites only ≤ z10, so the two layers never render together;
- adapt tile zoom, cap at 6 tiles/concurrency 3, Overpass limit 500;
- use `${z}/${x}/${y}` keys for memory, in-flight and IndexedDB caches;
- keep the existing timeouts, mirror fallback, partial rendering and
  abort-race fixes;
- show a “local detail unavailable” hint when Overpass fails.

### 7.5 UI (v1)

History panel:
- Year slider (no histogram/play in v1).
- Heritage-only and UNESCO-only toggles.
- Category chips at z8+ (Castle, Religious, Archaeological, Memorial,
  Battlefield, Industrial, Museum, Other); hidden or disabled below z8
  with the hint.
- Counts: `N sites` (filtered, z8+), data-as-of date.
- Source health: global dataset (ready/loading/error).
- Detail popup on site click: name, category, dates, heritage/UNESCO
  badges, Wikipedia summary, Commons image, Wikidata/OSM/OHM links,
  attribution.
- No nearby list, no URL-hash state, no user-facing global toggle in v1.

### 7.6 Performance budgets

- Global manifest + header + first tiles: < 500 KB before first paint at
  z0–4; first cluster visible < 1 s on 4G.
- PMTiles archive: target 25 MB, hard 40 MB.
- Cluster layer: < 1,000 rendered features at any zoom; sites layer
  < 3,000.
- Local live (v1.1): ≤ 6 tile requests per viewport, concurrency 3, each
  ≤ 12 s.
- Measure the JS bundle delta in Task 11; do not assume a number.
- No long task > 200 ms while panning at z8 with clusters visible.

### 7.7 Failure modes

- PMTiles missing/404: banner “Global dataset unavailable — local detail
  only”; the existing live loader remains available behind its toggle.
- Range host broken (206 + gzip): full-download fallback; cache the blob;
  on metered connections ask before downloading.
- Mixed versions: versioned paths + SHA-256 in the manifest; refuse a
  mismatched pair.
- Stale manifest: show “data as of <date>”; still use it.
- Overpass down (v1.1): keep global layer, show local-detail hint.
- Wikidata down: global static layer unaffected; click enrichment
  degrades gracefully.
- Archive > hard budget: data build fails, app deploy continues with the
  previous or no dataset.
- Duplicate features: not an issue in v1 (single static source); v1.1 uses
  zoom separation instead of dedupe.

## 8. Licensing & attribution

- Wikidata: CC0; credit “Wikidata contributors”.
- OSM: ODbL; credit “© OpenStreetMap contributors” and link to copyright.
  If OSM is ever folded into the static archive, the ODbL obligations
  attach to the tileset, not just the live layer; state that in the data
  manifest and attribution.
- Wikipedia: CC BY-SA; link the article, show the extract with attribution.
- Commons images: per-file license; link to the file page, do not rehost.
- PMTiles/MapLibre/Tippecanoe: include tool attribution in the data sources
  panel.
- Add all of this to `DataSourcesPanel` and the History panel footer.

## 9. Testing

- Unit: category mapping, date parsing, dedupe, H3 clustering, tile wrap,
  year/category filter predicates, record ordering, panel summary.
- Scripts: `node --test scripts/history/*.test.mjs`, wired into CI.
- Data/artifact validation: schema, sample sites, counts, bbox, file size,
  manifest hash, no duplicate IDs, layer name, tile content, antimeridian
  tile, z2 cluster sum vs site count.
- Runtime: PMTiles probe (including 206+gzip), protocol registration,
  full fallback, manifest failure, source health.
- Browser: world clusters, z8 Düsseldorf, year/category filters, heritage
  toggle, cluster click, detail popup, OHM swap, Firefox Pages fallback,
  mobile 390×700, keyboard/focus/labels.
- Performance: archive size, first cluster < 1 s, request count, rendered
  feature caps, measured bundle delta.

## 10. Phases

### v1 — worldwide static foundation (this plan)
1. **Spike (go/no-go):** scope query, export, size model, GitHub Pages
   range/Firefox probe.
2. **Data pipeline:** QLever export, normalization, H3 clusters, PMTiles,
   validation, versioned manifest.
3. **Runtime:** PMTiles probe/protocol, global clusters/sites, filters,
   detail popup, status/attribution.
4. **Hardening:** monthly data workflow, deploy fallback, browser/perf/a11y
   verification, rollout docs.

### v1.1 — local detail (separate plan)
OSM-only live layer at z11+, zoom separation (global ≤ z10), adaptive tile
zoom, `${z}/${x}/${y}` cache keys, IndexedDB, source health.

### Later
Nearby list, histogram/play, URL state, global OSM/UNESCO curated build,
archive/image-database enrichment.

## 11. Resolved decisions

- **Global max zoom:** 9 (clusters z0–7, sites z8–9); overzoom above.
- **Data URL:** same-origin Pages by default, configurable for S3/R2.
- **Archives:** five files (four cluster bands + sites), versioned directory.
- **Labels:** English `rdfs:label` in tiles; localized detail on click.
- **Year range:** data keeps BCE; the slider starts at 1500; ancient and
  undated sites are visible from the first position with clear badges.
- **Cluster filters:** heritage/UNESCO only; year/category at z8+ with an
  explicit UI hint.
- **v1 scope:** no live OSM, no histogram/play, no nearby, no URL state.
- **Open for the spike:** exact class allow/deny list and the resulting
  site cap.
