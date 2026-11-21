# Live transit — vehicles, disruptions, ferries, delay, GPS readiness

Status: implemented on `feat/live-transit` (2026-11-21)
Scope: `src/lib/routing/**`, `src/lib/planner/**`, `src/components/planner/**`,
`src/components/hud/**` (transit only). No server, no VPS changes.

## Intent

Live vehicles already worked but were undiscoverable: the switch lived two
clicks deep inside "Route options" and defaulted to off. The goal is that a
user who opens the transit pane immediately sees that live vehicles exist,
that they are on by default, and what the data actually is. Disruptions,
ferries and delays become first-class, and the vehicle model is ready for a
future server-side GPS feed without another UI rewrite.

## Verified sources (checked with curl on 2026-11-21)

| Source | Endpoint | What it returned | Licence / terms | Browser use |
| --- | --- | --- | --- | --- |
| Transitous (MOTIS 2.11.4) | `https://api.transitous.org/api/v6/map/trips` | Trip segments with encoded shape, real-time departure/arrival. **No GPS coordinates.** Positions must be interpolated. | Community service, best effort. `link: <https://transitous.org/sources/>; rel="license"`, attribution to DELFI/GTFS.de/OSM required. Usage policy: open-source, non-commercial, light use; contact them if `/plan` exceeds ~720 requests/24 h. | Yes: `access-control-allow-origin: *` |
| Transitous alerts | `https://api.transitous.org/api/v6/stoptimes?...&withAlerts=true` | Alerts are only attached to stop-time `place` objects (and to itinerary `legs`/places in `/plan`). **There is no standalone `/alerts` endpoint** (`/api/v6/alerts` → 404, verified against the v2.11.4 OpenAPI). Schema: `headerText`, `descriptionText` (HTML), `cause`, `effect`, `severityLevel`, `communicationPeriod`, `impactPeriod`, `url`. | same as above | Yes |
| GTFS.de realtime free | `https://realtime.gtfs.de/realtime-free.pb` | 7.1 MB protobuf, 30,854 `TripUpdate` + 246 `Alert` entities, **0 `VehiclePosition`** entities. Updated every 10 s. No `Retry-After`, no rate-limit headers. | CC BY-SA 4.0, with special agreements for VRR/VRS/DEFAS; attribution required. | **No CORS** (verified with `Origin`), 7 MB per poll — not usable from the browser. |
| VBB GTFS-RT | `https://production.gtfsrt.vbb.de/data` | 35-byte feed, **0 entities** on 2026-11-21; the operator reports degraded coverage since 2026-06-04. ETag, CC BY 4.0, documented limit 7 requests/min. | CC BY 4.0, informative User-Agent required | Documentation claims CORS, but no `Access-Control-Allow-Origin` header was returned; empty feed anyway. |
| DELFI / Mobilithek | `opendata-oepnv.de`, `mobilithek.info` | Registration / API key. Used indirectly through Transitous. | CC BY 4.0 / dataset-specific | No direct browser feed verified. |
| DB GTFS-RT | `gtfs-datenstroeme.tech.deutschebahn.com` | `DB-Api-Key` required, ETag support, 20 s recommended polling. | DB terms | No. |

**Conclusion:** there is no verified, public, browser-accessible German-wide
`VehiclePositions` feed. Transitous itself has no GPS. Interpolation along
the timetable shape is therefore the correct default, and a future GPS feed
is a data-model concern, not a UI concern.

### Ferry coverage (verified)

`FERRY` is present in the current MOTIS feed, but coverage is thin:

| Area | Query | Result |
| --- | --- | --- |
| Hamburg harbour | bbox 53.48–53.58 N, 9.85–10.05 E, z12 | 11 ferry segments (HADAG line 62, e.g. Bubendey-Ufer → Neumühlen/Övelgönne, `routeColor: 009bb6`) |
| North Sea (Wyk–Dagebüll) | bbox 54.55–54.80 N, 8.40–8.90 E, z11 | 1 ferry segment |
| Rhine (Düsseldorf–Cologne) | bbox 50.80–51.35 N, 6.60–7.05 E, z10 | 0 ferry segments |
| Chiemsee / Fehmarn | z10–z11 | 0 ferry segments |

So the ferry mode gets a real filter and colour, but the UI must not promise
"Rhine ferries". Empty states say so.

### Polling and cost

| Call | Observed size | Interval | Cost |
| --- | --- | --- | --- |
| `map/trips` | ~117 KB gzip for a Düsseldorf z12 window (500 KB raw) | 30 s while visible + on `moveend` (5 s throttle), jittered ±4 s | ~14 MB/h while watching |
| `stoptimes` (area alerts) | ~28 KB gzip for `n=10`, 1 h window | at most 3 stops every 5 min, plus an immediate refresh after the view moves 4 km | ~1.5 MB/h while watching |
| `/plan` | only on user search | unchanged | unchanged |

Transitous returned no `RateLimit-*` or `Retry-After` headers. The client
keeps the existing 429 → `retryAfter` backoff, backs off to 60 s on other
errors, pauses when the tab is hidden, and adds jitter so many clients do not
poll in lockstep. Auto-refresh of searches remains opt-in (the documented
720 `/plan` per day budget).

## Approaches considered

1. **Fetch GTFS-RT Alerts directly from gtfs.de.** Rejected: no CORS,
   7 MB per poll, and `VehiclePositions` are absent anyway.
2. **Build a standalone alerts list by scanning `/plan`.** Rejected: a plan
   only covers one origin/destination pair, not the visible map.
3. **Use MOTIS stop-time alerts for a few high-value stops in view.** Chosen
   for area alerts: it reuses the same CORS-enabled API, needs no key and no
   protobuf decoder, and each alert stays tied to real stops (which can be
   marked on the map).
4. **Route alerts from already-fetched `/plan` responses.** Chosen as the
   primary, zero-cost alert source: the alert already belongs to a leg, so
   the affected line is exact and can highlight matching vehicles.
5. **A server-side GPS gateway.** Explicitly out of scope for this task; the
   model is prepared (`source: "gps" | "interpolated"` plus a merge helper).

## Decisions

### Discoverability and default

- A persistent `LiveTransitBar` sits directly under the transit header /
  summary, outside the collapsible form and outside "Route options".
- Live vehicles default to **on**. `liveVehiclesOptOut` is persisted and only
  written when the user flips the switch, so an explicit "off" sticks across
  reloads from this version on. The old schema had no interaction marker, so
  a pre-v3 stored `false` cannot be distinguished from "never touched"; the
  migration therefore treats it as the new default (on) and documents the
  trade-off. This is the only way to satisfy "default on" for existing users.
- A MapLibre control (bottom-left) shows `LIVE · n` plus the last update even
  when the panel is closed. It is `aria-live="polite"` and has a full
  `aria-label`.

### Data model

`LiveVehicle` gains:

- `source: "interpolated" | "gps"` — UI copy and future feed readiness.
- `phase: "moving" | "dwell"` — a vehicle counts as dwelling at a stop from
  2 min before departure to 2 min after arrival; the popup says "At <stop>".
- `stops: { from, to }` with stop id/name/coordinates, used for area-alert
  sampling without another map/stops request.
- `modeGroup` via `liveModeGroup()` so filters and the legend share one
  mapping (`RAIL`, `BUS`, `TRAM`, `SUBWAY`, `FERRY`, `OTHER`).

`TransitAlert` is a normalized, HTML-free alert shared by route and area
alerts. `TransitLeg.alerts` carries alerts parsed from `/plan`.

`mergeVehiclePositions(interpolated, gps)` prefers one GPS position per
`tripId`, so a later gateway only has to produce `LiveVehicle` values with
`source: "gps"`.

### Alerts

- Route alerts are extracted from the selected journey's legs (`/plan`),
  shown as a banner/section in the journey detail, and their lines are pushed
  to the vehicle layer to draw a warning ring on matching vehicles.
- Area alerts are sampled from at most three stops that appear in the current
  vehicle feed **and lie inside the current view** (rail first, then the
  busiest stop), `n=10`, 1 h window, every 5 minutes and immediately after the
  view moves 4 km; the resulting alerts carry the affected stops, which are
  marked on the map.
  A tap opens the full text.
- `descriptionText` arrives as HTML (`<b>`, `<ul>`, `<br>`). It is converted
  to plain text; no `dangerouslySetInnerHTML`.
- Severity maps to existing tokens without inflation: `SEVERE` → danger,
  `WARNING` → warn, `INFO`/unknown → neutral. Many DELFI alerts have no
  severity, so neutral is the common case.

### Presentation

- Status line: `n live vehicles · updated HH:MM`, or `n of m` when a mode
  filter hides some, plus a zoom hint below level 8 and a clear error state.
- Mode chips: All, Rail, Bus, Tram, Metro, Ferry. Ferries keep the teal
  mode tone and a distinct double-ring marker.
- Delay is shown in the vehicle popup and in a compact "Vehicles in view"
  list sorted by delay. No traffic-light colouring; the existing amber ramp
  is only used on the delay badge.
- Vehicle circles are capped at 1,200 features; radius interpolates with zoom
  and line labels only appear at zoom ≥ 11 to keep 500+ vehicles readable.

## Files

- `src/lib/routing/types.ts` — `TransitAlert`, `TransitLeg.alerts`.
- `src/lib/routing/alerts.ts` — HTML→text, alert normalization/dedupe,
  `fetchAreaAlerts`, small TTL cache.
- `src/lib/routing/liveVehicles.ts` — source, phase, stops, mode groups,
  filtering, GPS merge, zoom threshold constant.
- `src/lib/routing/providers/motis.ts` — parse leg/stop alerts.
- `src/lib/routing/index.ts` — exports.
- `src/lib/planner/transitStore.ts` — default-on migration, groups, vehicle
  data, alert state.
- `src/lib/planner/transitFormat.ts` — `journeyAlerts`, `alertLines`,
  period formatting.
- `src/components/planner/useLiveVehiclesLayer.ts` — polling, filtering,
  ferry/alert layers, map status control, area-alert sampling.
- `src/components/planner/LiveTransitBar.tsx` — always-visible switch,
  status, filters, disruptions and vehicle list.
- `src/components/planner/TransitPanel.tsx` — renders the bar outside the
  collapsible options; removes the old buried toggle.
- `src/components/planner/JourneyDetail.tsx` — route alert section.

## Open risks

- Area-alert sampling sees only stops that currently have vehicles in view;
  a line with no running vehicle can be missing from "nearby" alerts. Route
  alerts from `/plan` cover the selected connection independently.
- MOTIS alerts carry no `informedEntity`, so area alerts cannot be mapped to
  a specific trip. Only route alerts highlight vehicles (by exact line label).
- Old persisted `liveVehicles: false` cannot be recognized as explicit; see
  the migration note.
- Interpolated positions are only as good as the timetable. `source` tells
  the user which one they are looking at.
- A future GPS feed still needs a server for CORS/key handling; the client
  contract is ready, nothing else.
