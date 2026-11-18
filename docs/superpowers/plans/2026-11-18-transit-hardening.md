# Transit Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix every code-level finding in the 2026-11-18 train-routing audit and add the daily-use QoL features that do not require new external data.

**Architecture:** Keep the existing Zustand + provider structure. Extend the normalized MOTIS model with the fields the API already returns, move display/filter logic into pure helpers under `src/lib/planner/transitFormat.ts`, and split `TransitPanel` into focused card/detail components. Navigation stays in `useNavigation`/`NavigationOverlay`, with transit-specific alighting, transfer, and recalculate behavior.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript strict, Zustand, MapLibre 5, Vitest (node).

**Spec:** `docs/audit/2026-11-18-train-routing-audit.md`

## Global Constraints

- No new runtime dependencies. Vitest is node-only; no jsdom or testing-library.
- All new pure logic must have a failing Vitest test first.
- Keep existing public routing exports backward compatible.
- No `any`; use the existing `isRecord`/`read*` narrowing helpers.
- Final gate: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
- Defer only data that does not exist (fares, CO2, live vehicle positions) or a full offline router; record those in the final report.

## Review Focus

- Cross-timezone journeys: every clock must be rendered in the stop's `tz`, not the browser zone.
- Editing a selected place: typing a new name must never leave the old coordinates active.
- Stale async results: aborts and generation checks must win every race.
- A transit journey that has already departed/cancelled: Start must explain, not silently start.
- A walk-only MOTIS result: it is walking guidance, not a train.

---

### Task 1: Provider model and MOTIS parsing

**Files:** `src/lib/routing/types.ts`, `src/lib/routing/providers/motis.ts`, `src/lib/routing/providers/motis.test.ts`

**Produces:** `TransitStopRef.tz/description/modes/arrival/departure`, `TransitLeg.routeColor/routeTextColor/routeType/wheelchairAccessible/bikesAllowed/reservation/tripShortName`, `RoutePlan.meta`, `RouteOptions.pageCursor/transitModes/maxPreTransitTimeS/maxPostTransitTimeS/requireWheelchairAccessible/requireBikesAllowed`, `RouteRequest.fromPlace/toPlace`.

- [x] Test stop `tz`, platform, route color/type, accessibility/bike/reservation parsing.
- [x] Test ODM is a transit leg, START/END labels become Start/Destination, itinerary id is preserved, cursors are exposed.
- [x] Test plan params for stop IDs, page cursor, modes, max walk, accessibility/bike requirements.
- [x] Implement parsing and request params.

### Task 2: Clock/day-offset correctness

**Files:** `src/lib/routing/format.ts`, `src/lib/routing/format.test.ts`

**Produces:** `formatDayOffset(iso, baseIso, locale?, timeZone?)`, `formatClock` unchanged signature.

- [x] Test Basel→Berlin clocks and `+1` day crossing in `Europe/Berlin`.
- [x] Implement a DST-safe calendar-day offset using `Intl.DateTimeFormat` parts.

### Task 3: Transit display/filter helpers

**Files:** `src/lib/planner/transitFormat.ts`, `src/lib/planner/transitFormat.test.ts`

**Produces:** `legDelayMinutes`, `journeyDelayMinutes`, `isLiveJourney`, `walkTotals`, `journeyTimeZone`, `stopLabel`, `legDirection`, `lineColor`, `lineTextColor`, `modeLabel`, `bestJourneyId`, `sortJourneys`, `filterJourneys`, `transferWarnings`, `describeTransitError`, `buildShareUrl`, `parseShareParams`, `buildIcs`.

- [x] Test delay (departure + arrival), live transit-only, best selection, sorting, filtering, transfer warnings, error text, share round-trip, ICS escaping/UTC times.
- [x] Implement pure helpers.

### Task 4: Transit store correctness and persistence

**Files:** `src/lib/planner/transitStore.ts`, `src/lib/planner/transitStore.test.ts`

**Produces:** `nowLocalInput`, `setJourneys(journeys, meta?)`, `markStale`, `nextCursor/previousCursor`, `favorites`, `recents`, filter/sort/auto-refresh state, validated persisted merge.

- [x] Test that every input/filter change marks results stale and clears cursors/notice.
- [x] Test favorites/recents dedupe and persistence-safe merge.
- [x] Implement store v2 with migration.

### Task 5: PlacePicker reliability and quick places

**Files:** `src/components/planner/PlacePicker.tsx`

- [x] Remove the text-search nearest-station race.
- [x] Invalidate the parent selection on edit/clear, add clear/no-results/error states.
- [x] Add full combobox ARIA, current-location and map-pick buttons, favorites/recents chips, star toggle.

### Task 6: Journey card/detail and TransitPanel

**Files:** `src/components/planner/TransitPanel.tsx`, `src/components/planner/JourneyCard.tsx`, `src/components/planner/JourneyDetail.tsx`, `src/components/hud/RoutesPanel.tsx`, `src/components/Map.tsx`

- [x] Split card/detail out; render timezone clocks, day offsets, line colors, walk durations, platform labels, deduped headsigns, both delays, accessibility/bike/reservation, intermediate stops, transfer warnings.
- [x] Fix time input (no rounding, Now/Today/Tomorrow/+1h), "3+" labels, Best, Live, stale/error/notice behavior.
- [x] Add city result filtering, sort/filter/mode/max-walk controls, auto-refresh, earlier/later cursors, share, ICS, Start guards.
- [x] Abort on unmount/place change; use stop IDs; fit the actual sheet height; pass search completion back to collapse a full sheet to half.

### Task 7: Navigation correctness

**Files:** `src/lib/navigation/progress.ts`, `src/lib/navigation/progress.test.ts`, `src/lib/navigation/useNavigation.ts`, `src/components/navigation/NavigationOverlay.tsx`, `src/lib/navigation/store.ts`

- [x] Test that the first maneuver/transit leg is returned and distance sampling follows real distances.
- [x] Fix next-maneuver selection and geometry sampling.
- [x] Rewrite transit guidance around alighting stop/platform, transfer info, live/schedule times, delay, and a real recalculate action; add exit alerts and aria-live.
- [x] Make preview time-compressed and battery-aware; walk-only plans are not transit.

### Task 8: Map layers

**Files:** `src/components/planner/usePlannerLayers.ts`

- [x] Per-line colors, cancelled styling, stop labels/popups, intermediate stops, line labels.
- [x] Clean handlers on style reload/unmount; no crashes before style load.

### Task 9: Verification

- [x] `npm test` all green.
- [x] `npm run lint`.
- [x] `npm run typecheck`.
- [x] `npm run build`.
- [x] Report what ships, what is deferred, and the exact evidence.

## Outcome

- `npm test`: 10 files, 100 tests green.
- `npm run lint`: clean.
- `npm run typecheck`: clean.
- `npm run build`: static export succeeds.
- Browser smoke test: real MOTIS search Heidelberg → Mannheim, five journeys, card/detail rendering, cursor "Later", city filter, favorite persistence, preview navigation and recalculation. A dev-only StrictMode mount race was found and fixed during this test; each leg now renders in its origin/destination time zone, not one journey-wide zone.
- Deferred because the data does not exist: fares, CO₂, full offline routing. A "show journey during navigation" sheet remains a product-level follow-up.

## Follow-up 2026-11-18 — Via and live vehicles

**Files:** `src/lib/routing/liveVehicles.ts`, `src/lib/routing/liveVehicles.test.ts`, `src/components/planner/useLiveVehiclesLayer.ts`, `src/lib/planner/transitStore.ts`, `src/lib/routing/providers/motis.ts`, `src/lib/planner/transitFormat.ts`, `src/components/planner/TransitPanel.tsx`, `src/components/Map.tsx`

- [x] Up to two via stations through MOTIS `via` + `viaMinimumStay=1`; request, persistence, share/deep-link, station-only pickers.
- [x] Live vehicle positions from `/api/v6/map/trips`: time-based interpolation, line color/label/popup, 30 s refresh, 5 s move debounce, rate-limit backoff, map toggle.
- [x] Test `normalizeLiveVehicles` interpolation, dedupe, malformed input, and request params; test via request params and share round-trip.
- [x] `npm test`: 18 files, 159 tests green; lint, typecheck, build, no-emoji clean.
- [x] Browser smoke: Heidelberg → Weinheim → Mannheim (all five results via Weinheim, five intermediate stops on the first leg), live layer showed 16 vehicles at z12 and refreshed.

Positions are **interpolated between real-time stop times**, not raw GPS coordinates; the UI states this in the toggle and popup.
