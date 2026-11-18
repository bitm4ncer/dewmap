# History Worldwide — Rollout

_2026-11-18 · v1._

## What ships

- A curated Wikidata heritage/historic dataset (~250k cap) built into four
  H3 cluster archives (z0–7) and one site archive (z8–9), versioned by
  build id and published as a GitHub Release asset.
- The History pane loads the manifest, probes Range support, adds the
  PMTiles archives to the protocol, and renders clusters/sites.
- Heritage/UNESCO toggles, category chips, year filtering at z8+, and a
  detail popup with Wikipedia/Commons enrichment.
- Missing or broken data falls back to the existing live OSM loader; the
  panel says “Global dataset unavailable — local OSM detail only”.

## Refresh

- The `History data` workflow runs monthly (`0 4 1 * *`) and on manual
  dispatch. It exports QLever, builds/validates the archives, uploads a
  30-day workflow artifact and a permanent `history-data-<buildId>`
  release asset.
- The deploy workflow downloads the newest `history-data-*` release into
  `public/data/history/<buildId>/` and copies it into the Pages artifact.
  A download failure does not block the app deploy.

## Force a rebuild

1. GitHub → Actions → **History data** → Run workflow.
2. Wait for the release `history-data-<buildId>`.
3. Run **Deploy to GitHub Pages** (or push to `main`); the deploy picks
   the newest release.

## Budgets and failure behaviour

- Target 25 MB, hard 40 MB (sum of all cluster files + site file).
- 25–40 MB: build succeeds with a warning; still deployable.
- > 40 MB: data build fails; the app deploy continues with the previous
  release or without data. The runtime falls back, never blocks.
- If a release contains a mismatched manifest/SHA, the build validation
  fails before publishing.

## Rollback

- Data is versioned and immutable. Re-run deploy against an older release
  by pinning the tag in the deploy download step, or remove
  `public/data/history` and deploy: the app shows the offline/fallback
  state.
- Code rollback: revert the `feat/history-worldwide` merge; the previous
  live loader remains in the codebase.

## Attribution

Visible in the History panel and `DataSourcesPanel`: Wikidata (CC0),
OpenStreetMap (ODbL), Wikipedia (CC BY-SA), Wikimedia Commons (per-file),
PMTiles/MapLibre/Tippecanoe. If OSM is later folded into the static
archive, the ODbL obligations attach to that tileset.
