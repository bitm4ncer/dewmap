# History Worldwide Implementation Plan (v1, revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fast, worldwide historic-sites layer for the History tab: a curated static Wikidata heritage dataset rendered as PMTiles clusters (z0–7) and sites (z8–9), with honest year/category filters, heritage/UNESCO toggles, detail popups, monthly refresh and a safe fallback when the dataset is unavailable.

**Architecture:** A build-time pipeline aggregates Wikidata via QLever into one row per item, normalizes/categorizes it, builds H3 cluster bands and five PMTiles archives (four bands + sites), validates them, and publishes a versioned manifest. At runtime MapLibre reads the archives through the PMTiles protocol; a robust range probe falls back to a full-file `FileSource` on broken hosts. The existing live OSM loader stays untouched behind its current toggle and is not part of v1.

**Tech Stack:** Next.js 16 static export, React 19, MapLibre GL JS 5, `pmtiles`, Zustand, Vitest, tippecanoe (build-time), QLever/WDQS, `h3-js` (build-time), GitHub Actions/Pages.

**Spec:** `docs/superpowers/specs/2026-11-18-history-worldwide-design.md`
**Critique:** `docs/audit/2026-11-18-history-plan-critique.md`

## Global Constraints

- Keep `output: "export"`, no backend, no accounts, no tracking.
- MapLibre GL JS 5.x and existing React/Zustand patterns; no new UI framework.
- Public data only: Wikidata CC0, OSM ODbL, Wikipedia CC BY-SA, Commons per-file licenses. Attribution is visible in `DataSourcesPanel` and the History panel; if OSM ever enters the static archive, the ODbL obligations attach to the tileset.
- v1 archive budgets: **target 25 MB, hard 40 MB**; clusters < 1,000 rendered features at any zoom; sites layer < 3,000 rendered features.
- Tiles carry only render/filter properties: `id`, `name`, `category`, `inception`, `dissolved`, `heritage`, `unesco`, `qid`. No `kind`, `wikipedia`, `image`, `nameDe`.
- No emoji in `src/`.
- If the manifest or archive is missing, the app keeps working with the current live loader at z8+ and shows a source-status hint.

## Review Focus

- **Cold world view:** clusters render at z0–2 with zero Overpass/Wikidata requests.
- **Broken range host:** a 206 with `Content-Encoding: gzip` must not be trusted; the full-file fallback renders the same clusters.
- **Mixed archive/manifest versions:** a cached old manifest must never point at a new file or vice versa; versioned paths + SHA-256 catch this.
- **Cluster honesty:** clicking a cluster zooms in; the year/category filters do not pretend clusters are filtered.
- **Missing data:** no manifest, 404 archive, or oversize build leaves the app usable and explains the state.

---

### Task 1: Spike — scope query, size model and hosting probe (go/no-go)

**Files:**
- Create: `scripts/history/scope.rq`
- Create: `scripts/history/spike-export.mjs`
- Create: `docs/audit/2026-11-18-history-spike.md`

**Interfaces:**
- `scope.rq`: SPARQL query returning one row per item with `item`, `name`, `coord`, `inception`, `dissolved`, `types`, `heritage`, `unesco`.
- The spike writes `tmp/history-spike/sites.geojsonl`, `sites.pmtiles`, and measurements.

- [ ] **Step 1: Write the scope query**

Use QLever (`https://qlever.dev/api/wikidata`) with:
- `?item wdt:P625 ?coord` required;
- English `rdfs:label` (`FILTER(lang(?label)="en")`) as `name`;
- optional `P571`, `P576`, `P31` types;
- `BIND(EXISTS { ?item wdt:P1435 ?hd } AS ?heritage)` and
  `BIND(EXISTS { ?item wdt:P1435 wd:Q9259 } AS ?unesco)`;
- scope: (heritage roots `P31/P279*` in `Q210272`, `Q358`, `Q1081138`,
  `Q2319498`) **or** (a reviewed historic class allowlist: castle,
  archaeological site, ruins, battlefield, religious building, monastery,
  fortification, palace/château, tower, city gate, industrial heritage,
  museum). A bare `P1435` is not enough: require `P1435` **and** one of
  those cultural/historic classes, so natural protected areas do not
  enter the dataset;
- exclude **direct `P31`** humans, events, organizations, administrative areas,
  cities, artworks/publications, transport stops/streets, natural
  protected areas, and items without a label;
- `GROUP BY ?item ?name ?coord` with `MIN(?inception)`, `MAX(?dissolved)`,
  `GROUP_CONCAT(DISTINCT ?type; separator="|")`, `SAMPLE` for the flags;
- `ORDER BY ?item LIMIT 10000`; paginate by keyset
  `FILTER(?item > <last item IRI>)`.

- [ ] **Step 2: Export and build a world sample**

Run the export, normalize to GeoJSONL, and build:
`tippecanoe -o sites.pmtiles -l history_sites -Z8 -z9 -r1 --force sites.geojsonl`
Build a second archive for clusters if the H3 script is ready; otherwise
record only the site archive size.

- [ ] **Step 3: Measure and decide**

Record in `docs/audit/2026-11-18-history-spike.md`:
- distinct items, category distribution, excluded/no-label counts;
- rows per page and total export time;
- site archive bytes at z8–9; projected size at 250k sites;
- `Range: bytes=0-7` response on a GitHub Pages preview: status,
  `content-encoding`, `content-range`, byte length, `PMTiles` magic;
- Chrome and Firefox rendering result.

Pass criteria: projected archive ≤ 40 MB at the chosen cap; a z8 sample
renders in Chrome; the Firefox probe result is recorded (either range is
safe or the full fallback is required). If the projection exceeds 40 MB,
reduce the cap, lower maxzoom to 8, or tighten the scope before Task 2.
Record the decision; stop if no viable scope exists.

- [ ] **Step 4: Commit**

```bash
git add scripts/history/scope.rq scripts/history/spike-export.mjs docs/audit/2026-11-18-history-spike.md
git commit -m "chore(history): spike worldwide heritage scope and PMTiles size"
```

---

### Task 2: Shared types, category map and filter predicates

**Files:**
- Create: `src/lib/history/types.ts`
- Create: `src/lib/history/category-map.json` (single source of truth)
- Create: `src/lib/history/categories.ts`
- Test: `src/lib/history/categories.test.ts`

**Interfaces:**
- `type HistoricCategory = "castle" | "religious" | "archaeological" | "memorial" | "battlefield" | "industrial" | "museum" | "other"`
- `interface HistoricSite { id; name; category; inception?; dissolved?; heritage; unesco; qid?; }`
- `categoryFromWikidata(qids: readonly string[]): HistoricCategory`
- `categoryFromOsm(historic: string | undefined): HistoricCategory`
- `categoryLabel(category, lang: "en" | "de"): string`
- `isSiteVisibleAtYear(site, year: number): boolean`
  - dated: `inception <= year && (dissolved === undefined || dissolved >= year)`
  - undated: **always visible** (v1 change; muted style, not hidden until 2000)
- `HISTORIC_CATEGORIES: readonly HistoricCategory[]`

- [ ] **Step 1: Write the failing tests**

Assert the mappings from the spike-confirmed values, not from memory:
- OSM: `castle → castle`, `archaeological_site → archaeological`,
  `wayside_cross → religious`, `memorial → memorial`,
  `battlefield → battlefield`, `mine → industrial`, `museum → museum`,
  `undefined → other`.
- Wikidata: the QIDs measured in Task 1 (at minimum castle, archaeological
  site, religious building, memorial/monument, battlefield). Derive the
  exact list from `scope.rq`; do not hardcode unverified QIDs.
- `isSiteVisibleAtYear({ inception: 1900, dissolved: 1950 }, 1899) === false`,
  `1950 === true`, `1951 === false`; an undated site is true at 1500 and
  2026.
- `categoryLabel("castle", "de") === "Burg"`, `("castle", "en") === "Castle"`.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/history/categories.test.ts`
Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement**

`categories.ts` imports `category-map.json` (tsconfig has
`resolveJsonModule: true`), so the build script and runtime share one map.
`types.ts` contains the types and ordered category list.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/lib/history/categories.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/history src/lib/history/categories.test.ts
git commit -m "feat(history): share category map and site types"
```

---

### Task 3: Aggregated QLever export and normalization

**Files:**
- Create: `scripts/history/export-wikidata.mjs`
- Create: `scripts/history/normalize.mjs`
- Test: `scripts/history/normalize.test.mjs`
- Create: `scripts/history/fixtures/wikidata-sample.csv`
- Create: `scripts/history/category-map.mjs` that re-exports the shared JSON

**Interfaces:**
- `parseWktPoint("POINT(6.95 50.94)") → { lon: 6.95, lat: 50.94 }`
- `parseYear("1848-01-01T00:00:00Z") → 1848`; `"-0500-..." → -500`; invalid → `undefined`
- `normalizeRow(row) → HistoricSite | null`
- `dedupeSites(sites) → HistoricSite[]` by `id`
- `toGeoJsonLine(site) → string` (one object per line, `[lon, lat]`)
- `exportPages({ cursor, pageSize, out })` writes one CSV per page and a
  `cursor.json`; resume from the last cursor.

- [ ] **Step 1: Write the failing tests**

Fixture rows:
- a castle with coordinate, inception, heritage, en label;
- an archaeological site without inception;
- an excluded human (`Q5`);
- an invalid coordinate;
- a duplicate QID with a fuller second row.
Assert normalization, category, `null` handling, dedupe, GeoJSON `Point`,
and that an undated site survives.

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test scripts/history/normalize.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement normalization**

Plain ESM; import the shared `category-map.json` via
`createRequire`/`readFile`, not a TS import. No fan-out: the query already
returns one row per item.

- [ ] **Step 4: Implement the exporter**

- QLever POST with `Accept: text/csv`;
- keyset pagination by `?item`;
- retry 3× with exponential backoff;
- `--limit`, `--cursor`, `--out` for tests and local runs;
- write `cursor.json` after each page so a failed run resumes;
- WDQS fallback only if QLever returns 5xx twice (same query shape,
  smaller page size).

- [ ] **Step 5: Run tests and a sample export**

Run: `node --test scripts/history/normalize.test.mjs`
Run: `node scripts/history/export-wikidata.mjs --limit 200 --out tmp/history/sample`
Expected: PASS; CSV rows + cursor file.

- [ ] **Step 6: Commit**

```bash
git add scripts/history
git commit -m "feat(history): export and normalize the global heritage dataset"
```

---

### Task 4: H3 clusters, PMTiles build and versioned manifest

**Files:**
- Create: `scripts/history/cluster.mjs`
- Create: `scripts/history/build.mjs`
- Create: `scripts/history/build-all.mjs`
- Test: `scripts/history/cluster.test.mjs`
- Modify: `package.json` (dev dependency `h3-js`; script
  `"history:build": "node scripts/history/build-all.mjs"`)

**Interfaces:**
- `clusterSites(sites, { resolution }): ClusterFeature[]`
  - `id`, `coordinates`, `count`, `heritageCount`, `unescoCount`.
- `buildArchives({ inputGeoJsonl, outDir, tippecanoe })` writes:
  - `<outDir>/<buildId>/history-clusters-<min>-<max>.pmtiles` (one per
    band: 0–1, 2–3, 4–5, 6–7; layer `history_clusters`)
  - `<outDir>/<buildId>/history-sites.pmtiles` (z8–9, layer `history_sites`)
  - `<outDir>/manifest.json` (pointer with `buildId`, files, bytes, sha256, counts, builtAt, attribution)
- `build-all.mjs` orchestrates export → normalize → build; defaults:
  `tmp/history/export`, `public/data/history`; supports `--skip-tiles`
  and `--limit` for a fast CI fixture.
- Cluster bands (non-overlapping):
  - z0–1: H3 resolution 1
  - z2–3: resolution 2
  - z4–5: resolution 3
  - z6–7: resolution 4
  - each feature has the **nested** property
    `"tippecanoe": { "minzoom": a, "maxzoom": b }`; a top-level property
    is ignored by tippecanoe.
- `buildId` is `history-YYYYMMDD-HHmm` (UTC).

- [ ] **Step 1: Write the failing cluster test**

Assert:
- two sites in one H3 cell → one cluster with `count: 2`,
  `heritageCount`/`unescoCount` correct;
- different cells stay separate;
- empty input → `[]`;
- band edges do not overlap (z2 belongs to res 2 only, z4 to res 3 only).

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test scripts/history/cluster.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement clustering**

Use `h3-js` `latLngToCell`/`cellToLatLng`. Aggregate counts per cell per
band; emit a `tippecanoe` object on every feature. Cap each band at 5,000
features by merging to the next coarser resolution if necessary.

- [ ] **Step 4: Implement the build**

- Write `clusters.geojsonl` and `sites.geojsonl`.
- Run tippecanoe twice:
  - `-Z0 -z7 -l history_clusters --drop-densest-as-needed --force`
  - `-Z8 -z9 -l history_sites -r1 --force`
- Direct PMTiles output via the `.pmtiles` extension.
- Compute SHA-256 for each archive; write the versioned manifest.
- `--skip-tiles` supports dry runs/tests.
- `build-all.mjs` calls `export-wikidata.mjs`, `normalize.mjs`, then
  `build.mjs`; it is the command CI runs.
- Fail on tippecanoe non-zero, missing layer, or > 40 MB; emit a warning
  and a warning if 25–40 MB; a hard failure leaves the last good release
  in place rather than blocking app deploys.

- [ ] **Step 5: Run tests and a dry build**

Run: `node --test scripts/history/cluster.test.mjs`
Run: `node scripts/history/build.mjs --input tmp/history/sample/sites.geojsonl --out tmp/history/out --skip-tiles`
Expected: PASS; `manifest.json` with versioned paths and counts.

- [ ] **Step 6: Commit**

```bash
git add scripts/history package.json package-lock.json
git commit -m "feat(history): build H3 clusters and versioned PMTiles archives"
```

---

### Task 5: Artifact validation and tile-content checks

**Files:**
- Create: `scripts/history/validate.mjs`
- Test: `scripts/history/validate.test.mjs`
- Modify: `package.json` (script `test:scripts`)

**Interfaces:**
- `validateSites(sites): { ok, errors }` — required fields, coordinate
  ranges, category enum, no duplicate IDs, finite dates.
- `validateManifest(manifest, { maxBytes }): { ok, errors }` — schema 1,
  buildId, counts > 0, files exist, sha256 matches, size ≤ 40 MB.
- `validateArchive({ command, archive, expectedLayer, sample })` — uses
  `tippecanoe-decode`/`pmtiles` to assert:
  - the layer name matches `history_clusters` / `history_sites`;
  - z2 cluster count sum is within 5% of the site count;
  - a z8 Düsseldorf tile has > 0 sites;
  - an antimeridian tile (z2 around 180°) has a cluster;
  - known samples (from the spike, e.g. Eiffel Tower/Colosseum if present
    in the chosen scope) are found at their coordinates.

- [ ] **Step 1: Write failing tests**

Assert invalid coordinates, duplicate IDs, unknown category, sha mismatch,
oversize archive, wrong layer name, and a valid fixture.

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test scripts/history/validate.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement and wire into `build.mjs`**

`build.mjs` validates the source rows, archives and manifest; exits 1 on
schema/sha/layer errors, warning-only on the 25–40 MB band.

- [ ] **Step 4: Add `test:scripts`**

`package.json`: `"test:scripts": "node --test scripts/history/*.test.mjs"`.
CI runs it next to `npm test`.

- [ ] **Step 5: Run tests**

Run: `node --test scripts/history/validate.test.mjs && npm run test:scripts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/history package.json
git commit -m "feat(history): validate archives, layers and size budgets"
```

---

### Task 6: Data workflow and deploy integration

**Files:**
- Create: `.github/workflows/history-data.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/ci.yml` (add `npm run test:scripts`)
- Modify: `.gitignore` (`public/data/history/`, `tmp/history/`)

**Interfaces:**
- `history-data.yml` runs monthly (`cron: "0 4 1 * *"`) and on dispatch;
  builds `public/data/history`, uploads a workflow artifact and a GitHub
  Release asset named `history-data-<buildId>`.
- `deploy.yml` downloads the latest release asset into
  `public/data/history/<buildId>/`, writes/uses the pointer manifest, and
  continues without data on failure (`continue-on-error`).
- `buildId` is `history-YYYYMMDD-HHmm`.

- [ ] **Step 1: Write the data workflow**

- `permissions: contents: write` for the release asset.
- Node 22, `npm ci`, install tippecanoe
  (`sudo apt-get update && sudo apt-get install -y tippecanoe`), verify
  `tippecanoe --version`.
- Run `npm run history:build`.
- Run `npm run test:scripts` and archive validation.
- Upload `public/data/history` as an artifact and create/update the release
  `history-data-<buildId>` with `gh release upload --clobber`.
- `concurrency` group so two builds cannot race.

- [ ] **Step 2: Write the deploy integration**

- `permissions: contents: read` with `GH_TOKEN: ${{ github.token }}`
  available to the download step.
- Find the latest `history-data-*` release (`gh release list --limit 20 |
  grep history-data`), download its archive asset, extract to
  `public/data/history/<buildId>/`, and ensure the pointer manifest is in
  place.
- If the download fails (no release, GitHub outage), log a warning and
  continue; the runtime fallback handles the missing manifest.
- Keep `npm run build` after the data step.
- Manual data refresh happens through the separate **History data**
  workflow; the deploy workflow consumes its newest release (including
  `workflow_run`).

- [ ] **Step 3: Verify locally**

Run: `npm run history:build -- --skip-tiles --limit 100`
Run: `npm run build`
Expected: the manifest lands in `out/data/history/`; the app still builds
without a PMTiles file.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows .gitignore package.json
git commit -m "ci(history): monthly data release and resilient Pages deploy"
```

---

### Task 7: PMTiles runtime — robust probe, protocol wiring, manifest

**Files:**
- Create: `src/lib/history/global.ts`
- Test: `src/lib/history/global.test.ts`
- Modify: `src/components/Map.tsx` (register once)

**Interfaces:**
- `historyManifestUrl(): string` = `new URL(`${basePath}/data/history/manifest.json`, location.href).href`
- `historyFileUrl(path: string): string` = absolute URL for a versioned file
- `type ArchiveMode = "range" | "full" | "missing"`
- `probeHistoryArchive(url, fetchImpl = fetch): Promise<{ mode; blob?: Blob }>`
  - request `Range: bytes=0-7`;
  - `200` → `{ mode: "full", blob }` (reuse this body);
  - `206` → mode is `"range"` only if all hold:
    - `content-encoding` is absent or `identity`;
    - `content-range` matches `bytes 0-7/<n>`;
    - `arrayBuffer().byteLength === 8`;
    - first 7 bytes are `PMTiles` and byte 7 is `3`;
    otherwise `{ mode: "full" }` and the caller performs a fresh full fetch
    (a gzip 206 body is not a valid full archive).
  - non-ok → `{ mode: "missing" }`.
- `loadHistoryManifest(fetchImpl = fetch): Promise<HistoryManifest | null>`
- `createHistoryProtocol(maplibregl): { protocol; open(manifestFile, mode): Promise<string> }`
  - `open` returns the **source URL** to use and must be called once per
    archive (clusters and sites):
    - range: `pmtiles://<absolute file url>`, archive added via
      `protocol.add(new PMTiles(absoluteUrl))`;
    - full: `pmtiles://history-clusters-<min>-<max>.pmtiles` /
      `pmtiles://history-sites.pmtiles` after adding
      `new PMTiles(new FileSource(new File([blob], basename)))`.
  - the file basename keeps the two full-mode archives distinct in the
    protocol map;
  - idempotent registration; one protocol instance per app.
- `verifyManifestFile(file, bytes, sha256): Promise<boolean>` (optional
  runtime check; used in dev/tests, not on every load).

- [ ] **Step 1: Write failing tests**

- 206 with identity + valid magic → `"range"`.
- **206 with `content-encoding: gzip` → `"full"`**.
- 206 with a short body or wrong magic → `"full"`.
- 200 → `"full"` and the blob is returned.
- 404 → `"missing"`.
- `loadHistoryManifest` returns null on 404/invalid JSON, parses a valid
  manifest.
- `createHistoryProtocol` called twice registers one protocol.
- `open` in full mode calls `protocol.add` with a `FileSource` archive and
  returns `pmtiles://history-sites.pmtiles` (and the clusters basename
  separately).
- `open` in range mode adds the absolute URL archive and returns
  `pmtiles://<absolute URL>`.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/history/global.test.ts`
Expected: FAIL.

- [ ] **Step 3: Install and implement**

Run: `npm install pmtiles`
Implement `global.ts` with no React imports. In `Map.tsx`, create the
protocol once in a module-level or top-level effect guard and pass it to
`useHistoryLayers`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/lib/history/global.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/history/global.ts src/lib/history/global.test.ts src/components/Map.tsx
git commit -m "feat(history): robust PMTiles probe, full fallback and manifest"
```

---

### Task 8: Extract `useHistoryLayers` and add global sources/layers

**Files:**
- Create: `src/components/history/useHistoryLayers.ts`
- Create: `src/lib/history/global-layers.ts`
- Test: `src/lib/history/global-layers.test.ts`
- Modify: `src/components/Map.tsx` (replace the inline global layer effect with the hook)

**Interfaces:**
- `useHistoryLayers(map, { manifest, protocol, year, categories, heritageOnly, unescoOnly }): { status; count }`
- `buildClusterFilter({ heritageOnly, unescoOnly }): FilterSpecification`
- `buildSiteFilter({ year, categories, heritageOnly, unescoOnly }): FilterSpecification`
  - category clause only when `categories.length > 0`;
  - heritage/UNESCO booleans;
  - year: dated sites `inception <= year` and `dissolved >= year`;
    undated sites always pass. Use the existing flat `case`/`coalesce`
    expression shape from `buildHistoryLandmarksFilter`; do not mix
    legacy `[">=", "property", value]` syntax into an `any`/`all` array,
    which MapLibre’s validator misparses.
- `ensureGlobalLayers(map, { clusterSourceUrl, siteSourceUrl })`
  - cluster source layer `history_clusters`, layer `minzoom: 0`, `maxzoom: 7`;
  - site source layer `history_sites`, layer `minzoom: 8`, no maxzoom
    (overzoom at z10+ in v1);
  - cluster circles sized by `count`, labels from `count`;
  - site circles sized by zoom; labels from z10 (overzoomed).
- `removeGlobalLayers(map)`
- Cluster click: `map.easeTo({ center, zoom: min(currentZoom + 2, 9) })`.

- [ ] **Step 1: Write failing filter tests**

Assert the cluster filter ignores year/categories and only applies
heritage/UNESCO; the site filter applies all four; undated sites pass at
1500; empty categories produce no category clause.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/history/global-layers.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the hook and layers**

The hook owns:
- manifest load (once), protocol open, source URLs;
- `style.load` rehydration (OHM/basemap swaps);
- filter updates on settings changes;
- a status `"idle" | "loading" | "ready" | "error"`;
- a count from `querySourceFeatures` on the sites source after `idle`.
No URL/state logic; `Map.tsx` passes props.

- [ ] **Step 4: Run tests, typecheck, browser check**

Run: `npx vitest run src/lib/history/global-layers.test.ts && npx tsc --noEmit`
Browser: world view clusters; z8 sites; cluster click zooms; toggling OHM
rehydrates; toggling the global layer off removes sources.

- [ ] **Step 5: Commit**

```bash
git add src/components/history/useHistoryLayers.ts src/lib/history/global-layers.ts src/lib/history/global-layers.test.ts src/components/Map.tsx
git commit -m "feat(history): global cluster/site layers and layer hook"
```

---

### Task 9: Detail popup for global sites

**Files:**
- Modify: `src/components/Map.tsx` (click handler)
- Create: `src/lib/history/detail.ts`
- Test: `src/lib/history/detail.test.ts`

**Interfaces:**
- `siteDetailHeader(props): string` — escaped name/category/date.
- `siteDetailLinks(props): string` — Wikidata/OSM/OHM links.
- `fetchSiteDetail(site): Promise<{ summary; image }>` — reuse
  `fetchWikipediaSummaryFromQid` and `fetchWikidataImage`; no tile fields
  required.
- Click on a cluster: zoom in (Task 8). Click on a site: open the existing
  MapLibre popup with `Loading summary…`, then the detail.

- [ ] **Step 1: Write failing tests**

- header escapes HTML and renders `date unknown` for undated sites;
- links include the QID only when present;
- `fetchSiteDetail` returns the summary/image from mocked helpers and
  falls back gracefully when both are null.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/history/detail.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Move the existing popup HTML helpers out of `Map.tsx` where practical;
keep the popup itself in MapLibre. The popup shows category, dates,
heritage/UNESCO badges, summary, image, and links. No React detail sheet in
v1.

- [ ] **Step 4: Run tests, typecheck, browser check**

Run: `npx vitest run src/lib/history/detail.test.ts && npx tsc --noEmit`
Browser: click a site; popup loads; click a cluster; map zooms.

- [ ] **Step 5: Commit**

```bash
git add src/lib/history/detail.ts src/lib/history/detail.test.ts src/components/Map.tsx
git commit -m "feat(history): detail popup for global heritage sites"
```

---

### Task 10: History panel v1 controls and status

**Files:**
- Create: `src/components/hud/HistoryFilters.tsx`
- Modify: `src/components/hud/HistoryPanel.tsx`
- Modify: `src/components/hud/HistoryTimeline.tsx`
- Modify: `src/lib/settings.ts`
- Test: `src/lib/history/panel-state.test.ts`

**Interfaces:**
- `HistoryFilters` props: `categories`, `onCategoriesChange`, `heritageOnly`, `unescoOnly`, `onHeritageOnlyChange`, `onUnescoOnlyChange`, `disabledBelowCityZoom`.
- Settings: `historyHeritageOnly` (default false), `historyUnescoOnly`
  (default false), no `historyGlobalOn` user setting (internal default on).
- Category selection lives in local `Map.tsx` state (not persisted) in v1.
- Timeline caption: "Year and category filters apply from city zoom (z8)" /
  "Year and category filters from city zoom (z8)".
- Status row: global dataset `ready/loading/error`, data-as-of date,
  attribution link.

- [ ] **Step 1: Write failing state tests**

Pure helper `panelSummary({ status, count, year, filters }): string`
asserts:
- `ready` + count → `"236 sites"`;
- `loading` → `"loading…"`;
- `error` → `"global dataset unavailable"`;
- heritage/UNESCO flags and selected categories are reflected.

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run src/lib/history/panel-state.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Reuse the existing `Switch` pattern for heritage/UNESCO.
- Category chips from `HISTORIC_CATEGORIES` using `categoryLabel`; active
  state is `aria-pressed`; disabled with the hint below z8.
- Add the filter hint.
- Keep the year slider; no histogram/play.
- Add data-as-of and source status.
- When the global dataset is `ready`, disable the legacy “Historic
  landmarks” switch with the hint “covered by the global dataset”. v1.1
  re-enables it at z11+ with zoom separation. If the global dataset is
  missing, leave the legacy switch enabled.
- Settings migration version bump for the two booleans.

- [ ] **Step 4: Run tests, typecheck, browser check**

Run: `npx vitest run src/lib/history/panel-state.test.ts && npx tsc --noEmit`
Browser: toggles filter sites at z8+; status shows data date; hint visible.

- [ ] **Step 5: Commit**

```bash
git add src/components/hud src/lib/settings.ts src/lib/history/panel-state.test.ts
git commit -m "feat(history): panel toggles, filter hint and data status"
```

---

### Task 11: Performance, accessibility and browser verification

**Files:**
- Create: `docs/audit/2026-11-18-history-worldwide-verification.md`
- Modify: `src/components/hud/DataSourcesPanel.tsx`

**Interfaces:**
- Verification record: archive bytes, tile counts, first-cluster time,
  request count, Chrome/Firefox/GitHub Pages result, accessibility result.

- [ ] **Step 1: Measure the data**

Run the real build; record `pmtiles show` output, manifest counts, archive
sizes, and the z2 cluster count vs site count. Fail if > 40 MB.

- [ ] **Step 2: Measure runtime**

With the browser tools:
- cold z2: cluster visible; **zero** Overpass/Wikidata requests;
- z8 Düsseldorf: sites visible; cluster filter hint; year toggle changes
  dots without refetch;
- cluster click zooms;
- site click popup loads Wikipedia/Commons;
- Firefox + GitHub Pages preview: gzip 206 probe → full fallback renders;
- OHM basemap swap rehydrates the layers;
- antimeridian view (180°) shows clusters/sites;
- mobile 390×700: panel, toggles, popup usable;
- keyboard/focus/labels on all controls.

- [ ] **Step 3: Attribution**

`DataSourcesPanel`: Wikidata CC0, OSM ODbL, Wikipedia CC BY-SA, Commons,
PMTiles/MapLibre/Tippecanoe; “Data as of …” in History.

- [ ] **Step 4: Full gate**

Run: `npm test && npm run test:scripts && npx tsc --noEmit && npx eslint && npm run check:no-emoji && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add docs/audit/2026-11-18-history-worldwide-verification.md src/components/hud/DataSourcesPanel.tsx
git commit -m "docs(history): verify worldwide performance and accessibility"
```

---

### Task 12: Rollout, fallback and documentation

**Files:**
- Modify: `src/lib/history/global.ts` (missing-manifest fallback)
- Modify: `CHANGELOG.md`, `README.md`
- Create: `docs/audit/2026-11-18-history-worldwide-rollout.md`

**Interfaces:**
- Missing manifest or 404 archive: global status `"error"`, the panel
  shows “Global dataset unavailable — local detail only”, and the existing
  live loader remains available behind its current toggle.
- Versioned data path + manifest SHA-256; no fixed filenames.

- [ ] **Step 1: Implement the fallback**

`useHistoryLayers` catches manifest/archive errors and reports `"error"`.
The History panel shows the hint. The old live layer is not auto-enabled;
the user can still turn on “Historic landmarks” as before.

- [ ] **Step 2: Update docs**

README History section, CHANGELOG, rollout note: monthly refresh, how to
force a build, the 25/40 MB budgets, the Firefox probe, attribution.

- [ ] **Step 3: Final gate**

Run the full gate from Task 11 plus a production build served from `out/`
with and without the data directory.

- [ ] **Step 4: Commit**

```bash
git add src/lib/history/global.ts CHANGELOG.md README.md docs/audit/2026-11-18-history-worldwide-rollout.md
git commit -m "feat(history): worldwide heritage layer rollout and fallback"
```

---

## Follow-up plan (v1.1, separate)

Not part of this plan; write a new plan after v1 ships:

- OSM-only live detail at z11+, zoom-separated from the global sites
  (global ≤ z10, local ≥ z11); adaptive tile zoom; IDB cache; `${z}/${x}/${y}`
  keys; deterministic Overpass allowlist and ranking.
- Nearby list and histogram/play, only where site-level data exists.
- URL-hash state.
- Optional global OSM/UNESCO curated build, archive/image databases.

## Self-Review

- Spec coverage: static worldwide base (Tasks 1–8), filters (8, 10),
  detail (9), attribution/performance (11), fallback/rollout (12).
- Cut items are explicit and have no tasks, so they cannot silently
  reappear.
- Review Focus tests: cold world view (Task 11), gzip 206 (Task 7),
  version mixing (Tasks 4, 5), cluster honesty (Task 8), missing data
  (Task 12).
- No task depends on an undefined function: `useHistoryLayers` is defined
  before the UI tasks, and the protocol interface is fixed in Task 7.
