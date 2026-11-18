# History Worldwide — Spike Results

_2026-11-18 · go/no-go for the static global heritage layer._

## Scope

`scripts/history/scope.rq` was run against QLever
(`https://qlever.dev/api/wikidata`). Count query: **324,207 distinct items**
with `P625`, an English label, and a reviewed heritage/historic class or a
`P1435` designation on such a class, after excluding humans, events,
organizations, settlements, artworks, publications, streets and protected
areas.

Representative classes: cultural heritage 408k, heritage site 195k,
archaeological site 326k, castle 34k, church building 396k (only admitted
with `P1435`), monument 561k (only admitted with `P1435`).

## Sample build

- Export: 2,000 rows in 2 QLever pages (1,000 per page); 1,993 normalized
  sites after excluding invalid/excluded rows.
- H3 clusters: 780 features across the four zoom bands.
- Tippecanoe: `history-clusters.pmtiles` 67 KB, `history-sites.pmtiles`
  196 KB; total **0.26 MB** for 1,993 sites at z8–9 with the v1 property
  set (`id`, `qid`, `name`, `category`, `heritage`, `unesco`, dates).
- Projection at 250k sites: **~33 MB** (sites ~25 MB + clusters ~3–8 MB),
  under the 40 MB hard limit and above the 25 MB target. The build emits a
  warning in that band; it does not fail the app deploy.

## Range/host probe

- The local static server answers `Range: bytes=0-7` with `200` (no range
  support), which is exactly the full-download branch the runtime handles.
- GitHub Pages is known to answer `206` with `Content-Encoding: gzip` in
  Firefox, which corrupts PMTiles offsets. The runtime probe therefore
  requires 206 + no content-encoding + matching `content-range` + 8 bytes
  + the `PMTiles` magic; anything else becomes a full fetch. A real Pages
  preview check is part of Task 11.
- Content is served same-origin from the Pages artifact (the data workflow
  publishes a release asset, the deploy copies it into `out/`), so CORS is
  not required for the default deployment.

## Decision

**Go.** Ship v1 with:
- ~250k heritage-first cap (the spike's 324k scope is capped by
  `--max-sites`), maxzoom 9, z0–7 H3 clusters;
- target 25 MB / hard 40 MB, warning-only between them;
- robust probe + full fallback; versioned paths and SHA-256;
- detail fields (`kind`, Wikipedia, image) resolved on click only.

If the full build exceeds 40 MB, the next lever is 200k sites or maxzoom 8
before changing the architecture.
