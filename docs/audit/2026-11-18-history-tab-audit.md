# History tab — audit & repair

_2026-11-18 · scope: History pane (`SidebarPane = "history"`), historic
landmarks, OHM time-travel basemap, Wikipedia/Commons enrichment._

## 1. Executive summary

The History pane was structurally sound but its primary data layer could
stay empty forever. Both landmark sources were fetched with `fetch()` and
**no timeout**; the three Overpass mirrors were tried sequentially. One
stalled mirror therefore blocked `Promise.allSettled` inside every tile,
the tile promise never settled, and neither source ever reached the map —
even when Wikidata had already answered. During the audit the public
Overpass endpoints returned `502`/hung, which reproduced the bug reliably.

The layer now renders partial results as soon as the first source answers,
bounds every request with a timeout, survives mirror outages, and retries
tiles that failed transiently. The panel counter reflects the active year
filter and updates while loading. Marker popups gain Wikimedia Commons
images for OSM-tagged and Wikidata items.

## 2. Root cause

`src/lib/history/landmarks.ts` (before the fix):

1. `overpass()` looped over `OVERPASS_ENDPOINTS` and awaited `fetch()`
   without a timeout. `fetch` has no implicit timeout, so a mirror that
   accepts the connection but never answers hung the loop.
2. `loadTile()` awaited `Promise.allSettled([overpass, wikidata])`.
   `allSettled` only settles after **both** sources settle, so a hanging
   Overpass request withheld the Wikidata result.
3. `fetchLandmarksForBounds()` awaited every tile. The UI stayed in
   `loading…` and `setData()` was never called.
4. A second race: `tileInFlight` stored the promise without its abort
   signal. When a pan/style reload aborted request A, a request B starting
   immediately could pick up A's doomed promise and inherit its
   `AbortError`. The area then stayed blank until the next pan.
5. A tile where both sources failed was cached as empty forever, so a
   transient outage blanked that region for the rest of the session.

Reproduction evidence (in-app browser, `performance.getEntriesByType`):

```
overpass-api.de      → 502 after 32 ms
overpass.kumi.systems → aborted after 6 000 ms
overpass.private.coffee → aborted after ~5 958 ms
query.wikidata.org   → 200 after 7 849 ms (data available!)
```

Before the fix the panel remained at `LOADING…` with `NO DATA` although
Wikidata had returned rows.

## 3. Fixes applied

### 3.1 Bounded requests and mirror fallback
`src/lib/history/landmarks.ts`

- `HISTORY_OVERPASS_ATTEMPT_TIMEOUT_MS = 6_000` per mirror,
  `HISTORY_OVERPASS_TOTAL_TIMEOUT_MS = 12_000` across mirrors,
  `HISTORY_WIKIDATA_TIMEOUT_MS = 10_000`.
- `createAttempt()` combines the caller signal with a timeout and cleans
  up the timer/listener. A caller abort still wins over a timeout.
- Overpass mirrors are tried sequentially within the overall deadline;
  a timeout moves on to the next mirror instead of throwing.
- After all mirrors fail, Overpass is skipped for 60 s
  (`overpassUnavailableUntil`) so every pan during an outage does not
  repeat the 12 s wait.

### 3.2 Progressive rendering
- `loadTile(..., onPartial)` emits the merged tile as each source settles.
- `fetchLandmarksForBounds(bounds, signal, onProgress)` aggregates the
  latest per-tile result and calls `onProgress` after every source update.
- `Map.tsx` paints those partial collections immediately; Wikidata dots
  appear while Overpass is still slow.

### 3.3 Cache correctness
- `CachedTile` now records `partial` and `cachedAt`. A one-source tile is
  revalidated after 60 s, so missing OSM data can fill in.
- Empty tiles (both sources failed) are **not** cached.
- `tileInFlight` stores `{ promise, signal }`; aborted entries are not
  reused, and `finally` only deletes its own entry (fixes the abort race).
- Both-source failures now log a diagnostic instead of failing silently.

### 3.4 Correct, live counter
- `isLandmarkVisibleAtYear()` is the single source of truth shared by the
  MapLibre filter and the panel counter.
- The counter now reflects `inception <= year && (dissolved >= year or
  extant)`, and undated features appear from 2000.
- It recounts on slider changes without refetching, and while loading it
  shows `N sites · loading…` as soon as partial data arrives.
- `historyDataRef` remembers the last collection for cheap recounts.

### 3.5 Popup enrichment (image database)
- OSM `image` and `wikimedia_commons=File:…` tags become a Commons
  `Special:FilePath` thumbnail (`osmImageUrl`).
- For Wikidata items without a Wikipedia thumbnail, the popup calls
  `wbgetclaims&property=P18` (`fetchWikidataImage`) and shows the image.
- `summaryToHtml()` accepts a fallback image and renders a `Commons ↗`
  link. The P18 lookup stays out of the bbox SPARQL query on purpose:
  `OPTIONAL { P18 }` multiplies rows and the 400-row cap would return
  fewer distinct sites.
- Popup kinds are human-readable: Wikidata `kindLabel` (e.g. “castle”)
  instead of a QID, and OSM `historic=archaeological_site` renders as
  “archaeological site”.

### 3.6 OHM style watchdog
- Switching to the OHM style used to leave a blank map if the style URL
  never loaded (offline, blocked CDN, expired unpkg pin). A 12 s watchdog
  now reverts to the previous basemap and flips `historyMapOn` off with a
  console warning instead of hanging silently.

### 3.7 Landmark label font per basemap
- OHM's glyph endpoint serves `OpenHistorical` and Open Sans but not
  Noto Sans; Protomaps serves Noto Sans but not OpenHistorical. The
  landmark label layer now picks its font from the active style's
  `glyphs` URL, so labels no longer 404 on the OHM basemap.

### 3.8 Worldwide geometry and OSM relations
- The Overpass query now uses `nwr[historic]` (nodes, ways **and
  relations**) instead of only nodes/ways; `out tags center` supplies a
  representative point for polygons and relations.
- Tile indices wrap across the antimeridian: MapLibre reports longitudes
  beyond ±180 (e.g. west 170, east 190), which previously produced
  invalid tile x values (512+) and skipped the valid wrapped tiles. The
  wrapping is deduplicated.
- Tile y is clamped to the Web Mercator range, so polar/near-pole
  viewports cannot produce negative or out-of-range rows.

### 3.9 UI copy
- `HistoryPanel`: the historical map now states that OHM includes
  period-aware political borders, settlements and roads; the landmark
  caption mentions summaries/photos and the year filter.
- `HistoryTimeline`: “no data” → “no sites”.

## 4. Verification

- `src/lib/history/landmarks.test.ts` (11 tests): partial Wikidata before a
  stalled Overpass, mirror fallback, no empty-tile poisoning, cache reuse,
  aborted in-flight isolation, OSM Commons image, year-predicate cases,
  antimeridian wrapping and world-bbox deduplication.
- `src/lib/history/wikipedia.test.ts` (2 tests): P18 resolution + cache,
  missing image.
- `npm test` → full suite green (209 tests at the time of writing).
- `npx tsc --noEmit` and `npx eslint` clean.
- Browser: History pane at 2026 → **236 sites**; slider 1800 → **16
  sites**; layer updates live; no console errors. (Counts vary with the
  live Wikidata snapshot and the exact viewport.)

## 5. Remaining audit findings

| Severity | Finding | Recommendation |
| --- | --- | --- |
| Medium | The bbox query is deliberately broad: any item with an inception date is included, so tram stops, streets and museums appear next to castles. | Add category filters and/or a positive heritage-class facet (`P1435`, castle/monument/archaeological-site classes). |
| Medium | Wikidata `LIMIT 400` caps **rows**, not items. Multiple `P31`/article rows per item can truncate a dense tile. | Paginate with `LIMIT/OFFSET` or aggregate in a subquery; raise the cap for cities. |
| Medium | Overpass `out ... 400` caps dense z9 tiles; central European tiles easily exceed 400 `historic=*` objects. | Raise to 1 000–2 000 or lower the tile zoom for dense regions. |
| Medium | Both-source failures only log to the console; the UI cannot distinguish “empty area” from “sources down”. | Add a fetch-status callback and an inline warning/retry button. |
| Medium | SPARQL only pre-resolves the English Wikipedia article; other languages need a click-time `wbgetentities`. | Acceptable latency; consider caching sitelinks per QID (already cached in memory). |
| Low | OSM/Wikidata duplicates without a shared `wikidata` tag create two dots. | Deduplicate by name + proximity (e.g. <150 m) per tile. |
| Low | Overpass rate-limit cooldown is global; one 429 pauses both sources. | Track source-specific cooldowns. |
| Low | No clustering; hundreds of dots overlap at low zoom. | MapLibre cluster source or zoom-dependent filtering by kind. |
| Low | `parseOsmYear` accepts years before 1500 although the slider starts there; 5-digit years are truncated to 4. | Clamp `< HISTORY_YEAR_MIN` to undefined and use `\d{4,5}`. |
| Low | OHM style/plugin are pinned to `map-styles@0.9.15` / `maplibre-gl-dates@1.3.0`; current releases are 0.9.23 / 2.0.0. | Evaluate an upgrade in a branch; check style schema and plugin API. |
| Info | While `historyMapOn` is on, the Image/Hybrid/Vector basemap buttons have no visible effect (`active` is forced to OHM). | Disable/dim the basemap switch or explain the override. |

### 5.1 Worldwide coverage

Both sources are global, but the **loader is intentionally local**:

- The map is split into z9 tiles (~80 × 50 km at mid-latitudes). Each
  tile issues one Overpass and one SPARQL request.
- `MAX_TILES = 120` and `MAX_PARALLEL = 2` cap the work. For a typical
  desktop viewport (1440 × 900 px) the cap is exceeded below roughly
  **z8** (z8 ≈ 96 tiles, z7 ≈ 360). On a phone (390 × 700 px) z7 still
  fits (≈ 84 tiles), z6 does not.
- Below that threshold only tiles already in the in-memory cache are
  rendered. A fresh world or continent view is therefore **empty**, even
  though the layer’s `minzoom` is 4.
- OSM coverage depends on local mapping activity (strong in Europe,
  patchy elsewhere); Wikidata is broader but also Europe/North-America
  heavy and noisy (tram stops, streets, museums).
- The antimeridian and polar range bugs are fixed (§3.8), and OSM
  relations now contribute points.
- A true global overview needs a different strategy: a precomputed
  low-zoom dataset, or one coarse bbox query with its own cache, or a
  viewport-dependent tile zoom. Fanning out thousands of live queries at
  z4 is not acceptable for the public endpoints.

## 6. Feature roadmap

### 6.1 Political borders (high value, mostly free)
The OHM historical style **already renders period-aware political
borders**: `land_ohm_lines` with `admin_level` 1–2 (countries), 3, 4
(states), 5–6, 7–9 (counties/municipalities), filtered by the year plugin.
Next steps:

1. **Border emphasis toggle** — duplicate the OHM border line layers with a
   stronger casing/width and a legend (“Country / State / County”) on top
   of the basemap.
2. **Polity inspector** — query OHM/Overpass for `boundary=administrative`
   relations covering the map center at the selected year and show the
   name, dates and a Wikipedia/OHM link.
3. **Border timeline** — animate the year slider (`play` button); borders
   and sites move together. Cheap: reuse the existing `setHistoryYear`.

### 6.2 Image & archive databases
- **Wikimedia Commons** (implemented): P18 + OSM tags; next add a
  geosearch (“photos near this site”) using
  `generator=geosearch&ggsradius=500`.
- **Wikipedia/Wikidata sitelinks** (implemented): summaries in
  en/de/fr/es/it/nl.
- **Europeana** — rich cultural-heritage metadata; requires a free API key.
  Add as an optional “Archives” section in the popup with a name/coordinate
  search.
- **Archivportal-D / DPLA** — national archive aggregators; link out by
  site name and region; no key for search pages, APIs need registration.
- **Bildindex / Foto Marburg** — German image archive; link-out search.
- **OHM feature page** — for OSM-sourced sites with an OHM id, deep-link
  to the OpenHistoricalMap feature.
- Design: keep the popup compact; show one image, then a collapsible
  “More sources” row of links rather than stacking multiple iframes.

### 6.3 Site discovery & timeline
- **Inception histogram** behind the slider (bars per 50/100 years) using
  the in-memory collection; click a bar to jump.
- **Category chips** (castle, memorial, archaeological site, battlefield,
  ruins, monument, religious site) mapped from OSM `historic=*` and common
  Wikidata QIDs; multi-select filter expression.
- **Nearby list** — top 20 sites by distance from map center with year and
  kind; selecting one flies to it and opens the popup. Valuable on mobile
  where dots are hard to tap.
- **Clustering** at low zoom, expanding on click.
- **“Then vs now”** — split/swipe between OHM and satellite for the same
  viewport.
- **Share/deep-link** — encode center, zoom, year and active filters in the
  URL hash so a specific historical view can be shared.

### 6.4 Data quality & operations
- IndexedDB tier for landmark tiles (same pattern as
  `railTileStore`), with TTL and offline fallback.
- Source health indicator in the panel (Overpass/Wikidata last success).
- Retry button when both sources fail; distinguish “no sites here” from
  “network unavailable”.
- Optional server-side proxy/cache if Overpass blocking becomes persistent
  (keeps the client-only architecture otherwise).

## 7. Files touched

- `src/lib/history/landmarks.ts` — timeouts, backoff, partial progress,
  cache correctness, in-flight isolation, shared year predicate, OSM image.
- `src/lib/history/wikipedia.ts` — `fetchWikidataImage` (P18).
- `src/components/Map.tsx` — progressive rendering, filtered counter,
  popup image/Commons fallback.
- `src/components/hud/HistoryPanel.tsx` / `HistoryTimeline.tsx` — copy and
  loading counter.
- Tests: `landmarks.test.ts`, `wikipedia.test.ts`.
