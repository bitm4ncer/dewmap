# History Worldwide — Verification

_2026-11-18 · v1 static global heritage layer._

## Data build

- Scope query: 324,207 candidate Wikidata items (heritage/historic classes,
  English label, coordinate).
- Sample build: **4,981 normalized sites → 2,110 H3 clusters → 0.65 MB**
  across four cluster PMTiles archives and the site archive.
- Linear projection to the 250k cap: **~33 MB**, under the 40 MB hard
  limit and slightly over the 25 MB target (warning, not a failure).
- `npm run history:build` validates schema, duplicate IDs, coordinates,
  manifest SHA-256, layer names, z2 cluster sum vs site count, a z8 sample
  tile and the antimeridian before publishing.
- Artifact tests: `npm run test:scripts` → 25 passed.
- Unit tests: `npx vitest run src/lib/history` → 53 passed (before the
  final hook/panel changes; rerun in the final gate).

## Runtime (production build, Python static server without Range)

The server answers `Range` with `200`, so this exercised the **full-download
fallback**, not the 206 path.

- PMTiles protocol contained all five archives keyed by basename
  (`history-sites.pmtiles`, four `history-clusters-*.pmtiles`).
- At z9 over Eremo delle Carceri: 4 raw site features (tile buffers), one
  unique site; rendered dot present.
- At z3 over Germany: 17 cluster features, one rendered cluster.
- Cluster click: zoom **3 → 5**, centered on the cluster.
- Category filter: one site visible → click “Castle” → **0** → click
  “Religious” → **1**.
- Site click: popup header `Eremo delle Carceri · Religious · date unknown`
  with the Heritage badge; summary loading is best-effort and depends on
  Wikipedia/Wikidata reachability.
- Missing dataset (directory renamed): panel shows **offline** and
  “Global dataset unavailable — local OSM detail only”; no stuck loading.
- Fresh session with the global layer ready: resource log contains
  **only `.pmtiles`** requests (no Overpass, no Wikidata SPARQL).
- World view (z2): panel ready, `199 sites` from the sample dataset,
  Heritage/UNESCO toggles, category chips, data-as-of date.
- Accessibility: category chips expose `aria-pressed`, switches expose
  `aria-checked`, year slider has `aria-label="History year"`, cluster
  and site layers are pointer targets with a cursor change.

## Not verified locally

- Firefox + GitHub Pages `206 + Content-Encoding: gzip`: the probe unit
  test covers the exact response shape and falls back to a full download.
  A real Pages preview remains a release check.
- The full 250k-site build was not run in this environment (QLever export
  plus tippecanoe); the 5k sample and linear projection are the evidence.
- Screenshot capture needs a visible desktop window; verification used the
  map instance query API and DOM state instead.

## Post-review fixes (2026-11-18)

The whole-branch review found a critical scope bug and several runtime
honesty issues. Fixed and re-verified:

- **Scope:** exclusion now applies only to direct `P31` classes, so
  castles, museums, industrial sites, fortresses, city gates and
  monuments survive. QLever counts: castle 30,484; museum 50,856;
  industrial 277; fortress 2,152; city gate 2,803; monument 368,669.
- **Honest counts:** `queryRenderedFeatures` on the filtered site layer,
  `siteZoom` at z8+, zero counts are shown as zero, and category chips are
  disabled below z8.
- **Integrity:** manifest `no-store`, 200-body PMTiles magic check,
  content-range/byte check, and SHA-256 verification for full downloads.
- **Resilience:** 90 s abort timeout, saveData gate with an explicit
  “Load global dataset” action, protocol reuse for full archives, and
  layer persistence when the sheet collapses.
- **Pipeline:** export page offsets, fresh export directory, no
  short-page truncation, QLever timeout + WDQS fallback, deploy triggered
  by the data workflow, stat/hash/sample-ID/category/antimeridian
  validation, second-precision build IDs, category quotas in the cap.
- **UI:** English category labels, muted undated dots, Commons link,
  coordinate-based OSM link, PMTiles/Tippecanoe attribution.

Gate after these fixes: **253 Vitest tests**, **33 `node:test` script
tests**, `tsc`, `eslint` (history files), `check:no-emoji`, and
`next build` pass. Browser check at z12 shows **0 sites** with the
category chips enabled; the old 199-total substitution is gone.

## Final gate

```bash
npm test
npm run test:scripts
npx tsc --noEmit
npx eslint
npm run check:no-emoji
npm run build
```
