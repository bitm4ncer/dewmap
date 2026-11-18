# History Worldwide — Plan Critique & Revision

_2026-11-18 · independent critic review of the first design/plan._

## Verdict

**REVISE.** The hybrid direction (static worldwide base + live local detail)
is sound, but the first plan would have shipped a broken Firefox fallback,
an undersized archive budget, semantically wrong cluster filters, and
several wiring errors. The revised v1 is deliberately narrower.

## Accepted findings (implemented in the revised plan)

1. **Range probe was a no-op for the bug it targets.** A 206 response can
   still be broken by `Content-Encoding: gzip` on GitHub Pages/Firefox.
   The probe now checks: status 206, no `content-encoding` (or identity),
   matching `content-range`, exactly 8 bytes, and the `PMTiles\x03` magic.
   A 206+gzip response falls back to a full fetch (not a corrupt range
   read).
2. **Archive budget was not credible.** 300–600k sites at z0–10 with
   `wikipedia`/`kind`/`nameDe` cannot fit 30 MB. v1 caps the scope at
   heritage-first ~250k sites, maxzoom 9, and carries only render/filter
   properties. Detail fields are resolved at click time. Target 25 MB,
   hard 40 MB; oversize produces a warning/reduced variant instead of
   blocking the app deploy.
3. **Cluster filtering lied.** v1 does not year- or category-filter
   clusters. Clusters show total/heritage/UNESCO counts; the year and
   category filters apply at z8+ with a visible hint. This removes the
   “501 sites in 1200 AD” problem. Histogram, play and nearby are cut
   from v1 because they have no valid data source at cluster zooms.
4. **Tile cache key collision.** The live loader’s key becomes
   `${z}/${x}/${y}` before any adaptive zoom work, with a regression test.
5. **Local layer duplication and SPARQL fan-out.** v1 keeps the static
   layer only. The existing live loader is not integrated into the global
   layer; when the global dataset is ready its switch is disabled to avoid
   duplicate dots. It remains the fallback when the dataset is missing.
   v1.1 makes it OSM-only and zoom-separated (global sites ≤ z10, local
   ≥ z11).
6. **PMTiles wiring was incomplete.** The opened archive is explicitly
   added to the protocol, keyed by an absolute URL; sources use absolute
   `pmtiles://` URLs; clusters are gated to z0–7 and sites to z8+;
   `querySourceFeatures` no longer decides dedupe correctness.
7. **CI/pipeline breakages.** Separate data workflow, versioned archive
   directories, manifest SHA-256, stable keyset pagination, aggregated
   one-row-per-item export, nested `tippecanoe` zoom objects with
   non-overlapping bands, and `npm run test:scripts` in CI.
8. **Data scope was too noisy.** A reviewed `scope.rq` + allow/deny QID
   lists replace the vague class list. Generic memorials, churches and
   street furniture need heritage designation or a date; OSM live detail
   gets a value allowlist and deterministic ranking.
9. **Task decomposition.** The riskiest code no longer lands last inside
   `Map.tsx`; `useHistoryLayers` is extracted first. Cache, filters,
   histogram and nearby are separate units. Artifact-level tests are
   added (tile counts, source-layer, sample sites, antimeridian).
10. **Year/undated semantics.** Dates before 1500 remain in the data; the
    slider starts at 1500, so ancient sites are visible from the first
    slider position (correct: they existed). Undated heritage sites are
    no longer hidden until 2000; they render at all years with a muted
    style and a “date unknown” detail. The old OSM behaviour is unchanged
    until v1.1.

## Findings we did not adopt verbatim

- **Tile math.** The critic wrote that 120 z9 tiles is “≈ z11” and that
  blank continent views are caused by `map.getZoom() < 4`. The measured
  math is the other way around: at z8 a z9 tile is 128 px, so a
  1440×900 viewport holds ~79–96 z9 tiles (loads); at z7 a z9 tile is
  64 px, so ~315 tiles (blocked by `MAX_TILES=120`). The spec’s “roughly
  z8+” is correct for desktop; z4–7 are blocked by the tile cap, not only
  by the z<4 guard. The revised plan keeps the accurate statement.
- **Bitfield flags.** Kept separate `heritage`/`unesco` booleans instead
  of a bitfield, because MapLibre expression support for `bitwise_and`
  is version-sensitive and the size saving is negligible.
- **`kind` in tiles.** Dropped for size; the category label is enough for
  rendering and the detail card can resolve the raw kind on click.

## Cut from v1

Live OSM integration, IndexedDB cache, dedupe, histogram/play, nearby
list, URL-hash state, `historyGlobalOn` user setting, `nameDe`/`wikipedia`/
`image`/`kind` in tiles, `settlement` category, mobile sheet redesign,
OSM planet build.

## v1 scope

A curated static Wikidata heritage/historic dataset, PMTiles clusters
(z0–7) and sites (z8–9), robust runtime loading, heritage/UNESCO toggles,
year/category filters at z8+, detail popup, attribution, data-as-of,
monthly CI build and fallback when the dataset is missing.

## v1.1 / later

OSM-only local detail at z11+ with zoom separation and IndexedDB;
nearby list; histogram/play; URL state; global OSM/UNESCO curated build;
optional archive/image database integrations.
