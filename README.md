# KugelMaps

**Maps, trains and the real world.**

A client-side navigation and exploration app: train-first public transport, hiking and walking routes, satellite basemaps, and live environmental layers. No backend, no accounts, no tracking.

KugelMaps runs entirely in your browser. Your settings, saved places and Copernicus credentials stay on your device.

## What it does

### Travel

- **Public transport** — station-to-station journey planning with live departures and vehicles, transfers, via stops, accessibility and bike options, city filters, favourites, recent searches, and calendar export (`.ics`).
- **Car and walking** — route planning with alternatives, elevation profiles and GPX export.
- **Hiking** — BRouter-based route candidates, round trips, elevation chart, GPX import/export.
- **Live location** — a pulsing position marker with a compass heading cone on mobile.

### Explore

- **Basemaps** — Sentinel-2 cloudless (2024/2023), NASA Black Marble night lights, EOX Terrain, Esri imagery, CARTO Streets (dark and light), and a hybrid photo/transport mode.
- **Timeline** — lock a sector and scrub through every Sentinel-2 scene of the last 12 months, with cloud-cover dots.
- **Nature** — NDVI, ESA WorldCover land cover, GBIF species, Global Forest Watch forest loss, NASA NO₂ and Natura 2000.
- **History** — OpenHistoricalMap time travel and historic landmarks from Wikidata and OpenStreetMap.

### App

- Static export, client-side only.
- Installable PWA with an offline app shell.
- Responsive layout: desktop drawer, mobile sheet.
- Graphite UI: flat surfaces, one pigeon-blue accent, no decorative borders.

## Status

Train planning is the focus. KugelMaps is not yet a drop-in replacement for DB Navigator, the VRR app or Google Maps: coverage and live data depend on the upstream APIs, and the planner is still evolving. The environmental and historic layers are the part no ordinary navigation app has.

## Stack

- Next.js 16 with static export, React 19
- Tailwind 4
- MapLibre GL JS 5
- Zustand (settings and planner state, persisted to localStorage)
- Vitest
- Tile and data sources: EOX Maps, NASA GIBS, CARTO, Copernicus Data Space / Sentinel Hub, Esri, OpenStreetMap, Photon, BRouter, GBIF, Global Forest Watch, EEA, OpenHistoricalMap, Wikidata, Wikipedia

## Local development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Useful scripts:

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint
npm run test           # vitest
npm run test:coverage  # vitest with coverage
npm run build          # static export to out/
npm run check:no-emoji # guard against emoji in source
```

## Copernicus credentials

The Sentinel-2 timeline uses Copernicus Data Space. Bring your own OAuth client:

1. Register at [dataspace.copernicus.eu](https://dataspace.copernicus.eu).
2. Dashboard → User Settings → OAuth clients → **Create**.
3. Type: **Single-Page Application**, Flow: **Client Credentials**, Web origins: allow all.
4. Copy the Client ID and Secret shown once, then paste them into the app's credentials modal.

The free tier includes 30,000 Processing Units per month, which covers many timeline sessions. Credentials are stored only in your browser.

## Deploy

Pushing to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). The workflow derives the GitHub Pages base path and canonical URL from the repository name, runs `next build`, and publishes the static export in `out/` to GitHub Pages.

Renaming the repository is enough to change the deployed path. To use a custom domain or a different origin, set:

- `NEXT_PUBLIC_BASE_PATH` — the path prefix, e.g. `/kugelmaps` (empty for a root domain).
- `NEXT_PUBLIC_SITE_URL` — the canonical origin plus base path, e.g. `https://example.com/kugelmaps`.

Enable Pages in the repository: **Settings → Pages → Source: GitHub Actions**.

## Live location

The pulsing-dot live location (geolocate button in the map controls) requires a **secure context** — HTTPS or `localhost`. When hit over a plain-HTTP LAN IP (like `192.168.x.x:3000`), browsers disable `navigator.geolocation` and the geolocate button shows a "Location not available" tooltip. This is a browser security policy, not an application bug. Use `npm run dev` on `localhost`, or deploy to HTTPS for device testing.

On iOS, compass heading requires an additional permission prompt triggered by the same user tap that grants location access. If the compass prompt is denied, the pulsing dot still renders without the directional cone.

## Privacy

KugelMaps has no backend and no analytics. Settings, planner state and credentials live in `localStorage` on your device. Map tiles, routing requests and data queries go directly from your browser to the upstream providers listed above.

## Design

The interface uses the Graphite system: cool grey surfaces, a single pigeon-blue accent, no borders or shadows, and Geist sans/mono type. Tokens live in [`src/app/globals.css`](src/app/globals.css); map paint values mirror them in [`src/lib/theme.ts`](src/lib/theme.ts).

The app icon source is [`.design/AppIcon.svg`](.design/AppIcon.svg). Exported assets:

- `src/app/icon.svg` — browser favicon
- `src/app/favicon.ico` — legacy favicon
- `src/app/apple-icon.png` — iOS home screen
- `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png` — PWA icons

## License

MIT — see [LICENSE](LICENSE).
