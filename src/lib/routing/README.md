# Routing library

A small, abortable provider layer for four travel modes: **walk**, **bike**,
**car**, and **transit**. Everything returns the normalized `RoutePlan` shape
from `types.ts`; provider-specific payloads never leak through the public API.

```ts
import { planRoutes, planRoutesStreaming, formatDuration } from "@/lib/routing";

const controller = new AbortController();
const plans = await planRoutes({
  mode: "bike",
  waypoints: [
    { lat: 49.41, lon: 8.68 },
    { lat: 49.42, lon: 8.69 },
  ],
  profile: "trekking",
  alternatives: 3,
  signal: controller.signal,
});
```

## Public API

| Export | Purpose |
| --- | --- |
| `planRoutes(request)` | Dispatch walk/bike -> BRouter, car -> Valhalla (BRouter `car-eco` fallback), transit -> MOTIS. |
| `planRoutesStreaming(request, { onPlan })` | Same, but BRouter alternatives stream via `onPlan` as they arrive. |
| `planBrouter(request, { onPlan })` | BRouter only. `BROUTER_PROFILES` lists supported profiles. |
| `planValhalla(request)` | Valhalla only. Supports alternates and avoid preferences. |
| `planMotis(request)` | Public transport journeys. |
| `geocodeStops(text, signal?, limit?)` | Stop search through Transitous. |
| `formatDuration`, `formatDistance`, `formatClock`, `formatRelativeDelay` | Pure UI helpers. |
| `decodePolyline(encoded, precision?)` | Polyline decoder (Valhalla precision 6, MOTIS precision 7). |
| `deriveBrouterManeuvers(coordinates, durationS?)` | Geometry -> turn instructions. |
| `ProviderError` / `isProviderError` | Normalized error type and guard. |

`planRoutes` validates waypoints (at least two, finite lat/lon) and checks the
signal before any network call.

### Types

`RoutePlan` contains `id`, `mode`, `provider`, `distanceKm`, `durationMin`,
optional `ascentM` / `descentM`, `coordinates` (`[lon, lat, ele?]`),
`maneuvers`, optional `hasToll` / `hasHighway` / `hasFerry`, and an optional
`TransitJourney`. Maneuvers carry `startIndex` / `endIndex` into
`coordinates`, plus an optional `modifier`, `streetName`, and raw provider
`type` code. Transit legs keep both normalized (`mode`) and raw (`rawMode`)
modes, real-time flags, cancellation state, platforms, stop IDs, line,
agency, headsign, intermediate stops, and decoded geometry.

## Providers

### BRouter (walk, bike, car fallback)

```
GET https://brouter.de/brouter
  ?lonlats=lon,lat|lon,lat|...
  &profile=hiking-beta
  &alternativeidx=0
  &format=geojson
```

Profiles: `hiking-beta`, `hiking-mountain`, `shortest`, `trekking`,
`fastbike-lowtraffic`, `gravel`, `mtb`, `car-eco`, `car-fast`.

BRouter's GeoJSON `messages` array is **not** a list of turn instructions. It
is per-segment routing metadata. Maneuvers are derived from the geometry:
cumulative distance plus bearing changes, grouping turns larger than 25° and
emitting `Turn left/right`, `Bear left/right`, `Turn sharply …`, `Make a
U-turn`, `Continue straight`, and `Arrive`. Long instruction-free stretches get
`continue` hints about every 10 km. No street names are invented.

Alternatives are requested in parallel (`alternativeidx=0..n-1`, capped at 5)
and streamed through `onPlan`.

### Valhalla (car)

```
POST https://valhalla1.openstreetmap.de/route
Content-Type: application/json

{
  "locations": [{ "lat": 49.41, "lon": 8.68 }, ...],
  "costing": "auto",
  "costing_options": { "auto": { "use_highways": 0.5 } },
  "directions_options": { "units": "kilometers", "language": "en" },
  "alternates": 2
}
```

`summary.time` is seconds, `summary.length` is kilometres (because
`units: "kilometers"`). Maneuver `length` is also kilometres. The encoded
`shape` uses precision **6** and is decoded locally.

Avoid preferences map to Valhalla factors (0 = avoid, 1 = prefer):
`use_highways`, `use_tolls`, `use_ferry`; `service_penalty`,
`walkway_factor`, `alley_factor`, `driveway_factor`, `step_penalty` are also
supported through `RouteRequest.options`. Raw Valhalla maneuver codes are
preserved in `Maneuver.rawType`.

### MOTIS / Transitous (transit)

```
GET https://api.transitous.org/api/v1/plan
  ?fromPlace=lat,lon
  &toPlace=lat,lon
  &time=2026-11-17T10:00:00.000Z
  &arriveBy=false
  &numItineraries=3
  &maxTransfers=2
  &wheelchair=true
  &detailedTransfers=false
  &searchWindow=1800

GET https://api.transitous.org/api/v1/geocode?text=...&type=STOP
```

`departAt` accepts an ISO string or `Date`; with `arriveBy: true` it is treated
as the desired arrival time. Only the first and last waypoints are used.
`numItineraries` is capped at 5. If `itineraries` is empty, the `direct` array
is used as a fallback. `geocodeStops` filters to `type === "STOP"` and maps
`modes`, `country`, `areas`, and the stop `id`.

When `legGeometry.precision` is present it is tried first. Otherwise the
decoder tries **7**, then **6**, compares the decoded endpoints against the
leg's `from` / `to` stops, accepts a match below ~0.002°, and also handles
reversed geometry. MOTIS uses precision 7 today; precision 6 exists for older
or alternative deployments.

## Errors

All provider failures become `ProviderError` with `kind`:

| Kind | Meaning |
| --- | --- |
| `aborted` | Caller aborted the `AbortSignal`. |
| `rate-limit` | HTTP 429. `retryAfterS` is filled when available. |
| `network` | Timeout, connection failure, or HTTP 5xx / 408. |
| `no-route` | Provider found no route (often HTTP 400/404/422). |
| `bad-response` | Invalid JSON, empty body, or an invalid request. |
| `unknown` | Anything else, including unexpected provider exceptions. |

`http.ts` defaults to a **20 s** timeout for route plans and **8 s** for
geocoding. Caller signals and the internal timeout are combined; a caller
abort always wins.

## Limits and operational notes

- These are shared public demo endpoints. They are best-effort, may rate-limit,
  and must not be hammered. Cache results where possible and keep alternative
  counts modest.
- No API keys or secrets are used. No request headers rely on `Referer`
  (browsers forbid setting it); `Accept: application/json` is sent explicitly.
- CORS was verified as `Access-Control-Allow-Origin: *` for all three hosts at
  the time of writing, but this is outside this library's control.
- BRouter alternatives run concurrently. Very long routes can take tens of
  seconds; the timeout is per request.
- MOTIS itinerary `steps` are currently not normalized (the field is optional
  on `TransitLeg`). Transit leg-level geometry, timings, and stops are.
- Intermediate waypoints are ignored for transit journeys.

## Attribution

- **OpenStreetMap**: all routes are based on © OpenStreetMap contributors,
  available under the ODbL. Display "© OpenStreetMap contributors" in the UI.
- **BRouter**: routing engine and public server, <https://brouter.de>. Public
  service is intended for reasonable, non-abusive use.
- **Valhalla** (`valhalla1.openstreetmap.de`): public demo instance; fair-use
  only.
- **Transitous** (`api.transitous.org`): free for **non-commercial** use.
  Transit data comes from the underlying agencies and feeds such as DELFI,
  GTFS.de, and OpenStreetMap. Keep the Transitous/agency attribution visible
  and review <https://transitous.org> before commercial use.
- **Polyline algorithm**: Google's encoded polyline format, decoded locally.
