# BiosphereOne — implementation summary (2026-11-17)

This document records what was delivered after the functional audit in
`2026-11-17-functional-audit.md`. It is written for the next maintainer:
what changed, why, which decisions are deliberate, and what is still
best-effort.

## Product scope

BiosphereOne is now a mobile-first navigation and exploration app:

- **Walk / Bike** — BRouter profiles, alternatives, elevation, green-route
  scoring, GPX export, turn-by-turn navigation.
- **Car** — Valhalla routing with real maneuvers, motorway/toll/ferry
  attributes, avoid-highway / avoid-toll / shortest profiles, and a
  BRouter `car-eco` fallback.
- **Train / local transit** — Transitous/MOTIS 2 routing with depart/arrive
  times, transfers, platforms, line/agency/headsign, intermediate stops,
  real-time flags, delays and cancellations where the operator publishes
  them. Address search is supported: a geocoded address resolves to the
  nearest MOTIS stop and shows the walking distance. Every stop result and
  leg carries its city; an optional city field filters stop/address search.
- **Navigation mode** — live GPS or simulation, next maneuver, ETA,
  remaining time/distance, voice guidance, off-route warning, wake lock,
  course/north follow, transit leg guidance.
- **Existing exploration** — satellite/vector basemaps, Sentinel-2,
  biosphere layers, OpenHistoricalMap, historic landmarks, rail overlay.

Desktop uses the same data and controls in a fixed right-hand panel;
phones use a draggable three-snap bottom sheet.

## UX / design system

- One accent (`#d8ef6a`) for actions and selection; pane identity is a
  subtle 3 px signature tape/dot, not a second theme.
- Warm off-black surface ramp (`--surf-0..3`), AA-safe `--ink-mute`, a
  single radius scale (`8/12/16/24`), one shadow scale, one motion scale.
- Flat cards, hairline borders, no decorative glow/scanlines. The logo,
  icon and all near-blacks now resolve to the same `#0e0f0c`.
- Typography raised from 9–11 px to 11–14 px for body copy and controls.
- All primary touch targets are 44 px or larger: sheet tabs, handle,
  waypoint actions, icon buttons, switches, segmented controls, snapshot
  chips, map controls. Snapshot dots were replaced with a horizontally
  scrollable 44 px date-chip strip.
- Real bottom sheet: pointer drag, velocity-aware snapping, tap-to-toggle,
  keyboard Arrow/Enter support, `data-dragging` disables transitions,
  safe-area bottom padding, `visualViewport` height variable, and an
  opaque body (no `backdrop-filter` + height animation jank).
- Top bar: full-width search on phones, compact basemap switch on desktop,
  panel-aware right padding, no side-handle clutter.
- Accessibility: page zoom allowed, `inert` on the closed drawer,
  focus-visible rings, ARIA combobox/listbox for search, labelled sliders,
  `aria-live` async status, modal max-height/scroll, no horizontal overflow
  from the geo status pill.

## Correctness and performance fixes

- Snapshot loading is sequenced and abortable; the previous blob is
  revoked only after the map source has switched, and on unmount.
- Landmark fetching has a z4 gate, a 120-tile cap, an abort-safe tile
  cache, request-ticket ordering, and no more “empty cache poisoning”.
- Rail tile requests are aborted on teardown; IndexedDB opens retry after
  a transient failure; cache keys include zoom and records are validated.
- Duplicate `style.load` application removed across overlays.
- `moveend` no longer re-renders the 4,700-line map component; the
  coordinate readout subscribes itself.
- Hiking route selection survives streamed alternatives; camera fit runs
  once per selected route; “Computing…” cannot stick after finalize.
- Route geometry is no longer written to `localStorage` (quota-safe);
  hiking routes are recomputed from persisted waypoints on mount.
- Settings reject `NaN` and unknown basemap IDs; migration handles legacy
  values.
- Long-press suppression no longer swallows the next tap.
- Compass permission is retryable; north-up only eases when rotated.
- CDSE tokens are bound to the client ID, validated, de-duplicated against
  stampedes, and never cached with a `NaN` expiry.
- NO₂ source probing runs dates in parallel with a small probe cache.
- Elevation charts use cumulative distance and are downsampled.

## Routing data and architecture

| Mode | Provider | Notes |
| --- | --- | --- |
| Walk / Bike | `brouter.de` | Profiles, elevation, alternatives; maneuvers derived from geometry because BRouter does not emit turn instructions. |
| Car | `valhalla1.openstreetmap.de` | Real maneuvers/verbal instructions, `has_toll/has_highway/has_ferry`; BRouter `car-eco` fallback. |
| Transit | `api.transitous.org` (MOTIS 2) | Germany/Europe feeds; CORS enabled; real-time where feeds publish. Limit: 720 `/plan` requests / 24 h per IP. |
| Address search | `photon.komoot.io` | Proximity-biased. |
| Stop search | Transitous `/geocode` | Stop IDs, modes, platforms. |

**No backend / no VPS was added.** All sources expose CORS and work from the
static export. The VPS (2 vCPU, 3.7 GB, 6.6 GB free) has no headroom for a
Germany-wide MOTIS or Valhalla instance next to the existing 13 containers.
If a future feed is CORS-locked, a <64 MB micro-proxy is the intended
fallback, not a full routing server.

The long-term ideal for self-hosting is DELFI/OpenData ÖPNV (NeTEx + GTFS,
GTFS-RT every 10 s, CC BY 4.0/CC BY-SA 4.0) plus a small MOTIS instance.
The client currently talks to Transitous directly, so the app stays lean.

## PWA

- Manifest updated (name, description, categories, colors, icons).
- `public/sw.js` caches the shell and hashed `_next/static` assets for an
  offline-capable interface. Map tiles and routing APIs remain network-only
  on purpose (size, freshness and licensing).
- Registered only in production builds via `ServiceWorkerRegister`.

## Place details (POI)

- Tapping a search result opens a **minimised place card immediately**;
  tapping it, the chevron or swiping up expands it. Map taps do the same.
- The compact card shows the search hit before the detail fetch finishes:
  thumbnail placeholder, name, category, city, address and open state.
- Directions in the card hands the destination to the existing route mode
  picker.
- Nominatim `extratags` supplies opening hours, phone, email, website,
  address, wheelchair/payment facts and `contact:*` social tags. Results are
  cached for 24 hours and requests are serialised to respect Nominatim's
  1 request/second policy.
- Wikidata fills official websites, descriptions, social profiles and
  Commons images; Wikipedia supplies a fallback description and thumbnail.
  Brand-level Wikidata entities are not used as place photos or place
  descriptions (for example a REWE branch does not show another store).
- Opening hours are parsed into a weekly grid with an "open now" state for
  common OSM syntax; complex rules fall back to the raw value.
- Photos come from OSM, Wikimedia Commons and Wikipedia. Commons files are
  resolved through the imageinfo API to direct `thumb.wikimedia.org` URLs
  (with author and licence) instead of redirect-based `Special:FilePath`
  URLs. The hero fades in after load and falls back to a category panel.
  The card uses the flat surface system, a compact 152px mobile header,
  a 78dvh expanded sheet and a 380px desktop card.
- `src/lib/poi/*` contains the data layer, parser and cache;
  `src/components/poi/PoiDetail.tsx` the UI.

## Verification

- `npx tsc --noEmit` — clean.
- `npm run lint` — 0 errors, 0 warnings.
- `npm test` — 211 tests passing (format, HTTP, engine, BRouter, Valhalla,
  MOTIS, hiking routing, POI/Commons parsing and opening-hours rules).
- `npm run build` — static export succeeds.
- Lighthouse (production export): Accessibility 100, Best Practices 100,
  SEO 100.
- Browser QA at 390×700 and desktop: drag sheet peek↔half↔full, mobile
  panes, car Berlin→Hamburg (289 km / 3 h 05), transit Berlin→Hamburg
  (ICE 872, platforms, real-time fields), car navigation simulation with
  turn instruction and ETA, hiking route with waypoints and alternatives,
  POI detail cards for a museum and a supermarket (photo, hours, contact,
  socials), immediate compact card on search, expand/drag, directions handoff,
  direct Commons thumbnails, map-click reverse lookup.

## Known limitations

- Public demo routing endpoints are best-effort; they can rate-limit or
  disappear. The app surfaces errors instead of pretending success.
- Transit routing uses the first and last waypoint; intermediate transit
  waypoints are not yet chained.
- BRouter has no street names, so hike/bike maneuvers are geometric
  (“Turn right”) rather than street-aware.
- Offline mode covers the app shell, not map tiles or live data.
- No official DB/HAFAS scraping; `db-rest` was rejected for stability and
  terms reasons.
- Route alternatives are provider-dependent; “shortest” for car uses
  Valhalla's `shortest` costing option.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # static export to out/
npm run preview      # serve out/ (if configured)
```

The app is a static export; deploy `out/` to GitHub Pages with
`NEXT_PUBLIC_BASE_PATH=/biosphere_one`.
