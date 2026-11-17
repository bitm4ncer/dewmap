# BiosphereOne — Funktionsaudit 2026-11-17

**Scope:** Vollständiger statischer Audit des Repos `bitm4ncer/biosphere_one`
plus Laufzeitprüfung im Browser (Desktop 912×746, Mobile 390×844) und
Live-Tests der externen Endpunkte.

**Baseline (vor Änderungen):**

| Check | Ergebnis |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run build` | success (statischer Export, 7 Seiten) |
| `npm run lint` | 20 Errors / 9 Warnings |
| Browser-Konsole (Start) | keine Errors |
| Git | `node_modules` (511) + `.next` (1179) getrackt, `.git` 85 MB |

**Methodik:** Drei parallele Code-Audits (UI/Interaktion, Libs/APIs, Design
System), gezielte Live-Requests gegen BRouter, Transitous/MOTIS, Valhalla,
OSRM, GTFS.de und DELFI, sowie Browser-Screenshots aller Panels. Alle
Befunde sind mit `Datei:Zeile` belegt. Wo nur ein Browserlauf Klarheit
schaffen kann, steht `[runtime-only]`.

---

## 1. Funktionsinventar

| Oberfläche | Status | Einschränkung |
|---|---|---|
| Basemaps (Sentinel-2 2023/24, GIBS Live, Black Marble, EOX, Carto, OHM) | funktioniert | Style-Swap-Rehydrierung fragil |
| Globus/Flach-Projektion | funktioniert | MapLibre 5 |
| Suche (Photon/OSM) | funktioniert | kein Combobox-ARIA, Abort-Leck |
| Timeline · Jahr / Live / Snapshots | funktioniert | Snapshot-Race, Blob-Revoke |
| Biosphere (NDVI, Species, Forest Loss, NO₂, Natura, Land Cover) | funktioniert | NO₂ bis 56 serielle Probes |
| History (OHM-Map + Landmarks) | funktioniert | Abort vergiftet Cache, kein Zoom-Gate |
| Rails (Overpass + ORM-Tiles) | funktioniert | Requests werden nicht abgebrochen |
| Wander-/Bike-Routing (BRouter) | funktioniert | Streaming-/Selektions-Bugs |
| GPX-Export, Höhenprofil, Green-Score | funktioniert | Chart-X-Achse ignoriert Distanz |
| Live-Standort/Kompass | funktioniert | iOS-Permission-Latch |
| Mobile Bottom-Sheet | **kein Drag** | nur Tap-Cycle, Height-Animation + Blur |
| Desktop-Drawer | funktioniert | Side-Handle-Cluster, Magic Numbers |
| Auto-Routing | **fehlt** | — |
| Bahn/ÖPNV-Routing | **fehlt** | — |
| Turn-by-Turn-Navigation | **fehlt** | nur Orientierungsmodi |
| PWA/Offline | **fehlt** | Manifest vorhanden |

---

## 2. Bugs

### P0 — Datenverlust / falsche Anzeige

1. **Snapshot-Race.** `loadSnapshot` hat weder AbortController noch
   Request-Generation (`Map.tsx:3113-3141`). Klick A → B: Antwort A kann B
   überschreiben. Zusätzlich revoked `URL.revokeObjectURL(prev)` im
   State-Updater (`:3126-3130`), bevor die Map-Quelle umgestellt ist.
2. **History-Tiles werden durch Aborts vergiftet.** `Promise.allSettled`
   behandelt Abort wie „leer“ und schreibt `[]` in den Tile-Cache
   (`landmarks.ts:429-453`). Jeder Pan-Abort kann ein Tile dauerhaft leer
   cachen; alte Antworten können neuere überschreiben (`Map.tsx:2740-2755`).
3. **Kein Zoom-Gate/Cap für Landmarks.** `tilesForBounds` erzeugt bei
   Weltzoom tausende z9-Tiles; jedes Tile feuert Overpass + Wikidata
   (`landmarks.ts:384-399`), obwohl die Layer unter z4 unsichtbar sind.
4. **`setCandidates` klaut die Auswahl.** Jeder gestreamte Kandidat setzt
   `selectedCandidateId = candidates[0]` und `finalized = false`
   (`hiking/store.ts:114-119`, `HikingPanel.tsx:103,116`).
5. **Kamera springt beim Routing.** `fitBounds` läuft bei jeder
   Candidate-Änderung (`HikingPanel.tsx:142-166`), also 3–4× pro Route.
6. **Phase hängt nach „Confirm“.** `finalizeRoute` setzt `phase` nicht;
   die UI zeigt weiter „Computing…“ (`HikingPanel.tsx:480-500`).

### P1 — Funktionsfehler

7. Long-Press-Flag wird nur durch den nächsten `click` gelöscht; Touch
   erzeugt oft keinen Click → der nächste echte Tap wird geschluckt
   (`useLongPress.ts:77,114-120`).
8. Kompass: `compassStarted = true` vor `await requestCompassPermission()`;
   bei Denial nie wieder Retry (`Map.tsx:2099-2104`).
9. `orientationMode === "north"` ruft bei jedem Heading-Tick
   `easeTo({bearing:0})` (~5 Hz) (`Map.tsx:2299-2344`).
10. Rail-Requests werden beim Ausschalten nicht abgebrochen
    (`Map.tsx:2485`, Cleanup `2583-2591`).
11. `style.load`-Apply doppelt registriert (8 Stellen), z. B.
    `Map.tsx:2575-2577` → doppelte Layer-Arbeit pro Style-Swap.
12. Routen-Geometrie wird bei jedem Stream-Chunk synchron in localStorage
    serialisiert (`hiking/store.ts:135-143`) → Main-Thread-Block,
    Quota-Risiko.
13. Suche: Abort erst im nächsten Timer, `nearby` fehlt in Deps,
    Outside-Click nur `mousedown` (`SearchBox.tsx:27-73`).
14. CDSE-Token nicht an Credentials gebunden, `NaN`-Expiry, OAuth-Stampede
    (`sentinel/auth.ts:21-72`).
15. Settings-Clamping akzeptiert `NaN`, Basemap-IDs werden nicht gegen
    `BASEMAPS` validiert (`settings.ts:17,140-170,347-348`).
16. Geoziel-Pill `whitespace-nowrap` ohne `max-width` → Overflow auf
    320 px (`Map.tsx:3347-3351`).
17. Credentials-Modal ohne `max-height`/Scroll (`CredentialsModal.tsx:66`).
18. `aria-hidden` über fokussierbarem Offscreen-Drawer
    (`Map.tsx:3443-3446`).
19. `maximumScale:1, userScalable:false` → WCAG 1.4.4
    (`layout.tsx:34-35`).
20. Touch-Targets: 8×8 px Snapshot-Dots (`Map.tsx:4549`), 24×24 px
    Waypoint-Buttons (`HikingPanel.tsx:696`), 14 px Grabber
    (`globals.css:420-428`).

### P2 — Daten-/API-Robustheit

21. Über 50 Fehler im Datenlayer, u. a.:
    - Wikidata-429 löst keinen Cooldown aus (`landmarks.ts:435-437`).
    - Rail-IDB: ein transienter Fehler deaktiviert den Cache dauerhaft
      (`railTileStore.ts:32-57`); Cache-Key ohne Zoom.
    - Wikipedia cacht 429/Netzfehler als „kein Artikel“ für die Session
      (`wikipedia.ts:38-61`).
    - Catalog ignoriert `context.next` (`catalog.ts:27-30`).
    - `getAccessToken`/Catalog/Process ohne Timeout/Abort.
    - `parseOsmYear` akzeptiert negative/3-stellige Jahre
      (`landmarks.ts:112-121`).
    - `computeGreenRatio` liefert `0` statt „unbekannt“ bei leerem
      Overpass-Ergebnis (`score.ts:26-50`).
    - Round-Trip-Streaming wartet auf alle Legs (`routing.ts:197-210`);
      bei 2 Waypoints ist der „Loop“ ein Out-and-Back.
    - BRouter-Fehlerursachen werden verworfen (`routing.ts:120-123`).
    - `applyGreenRatios` mutiert Store-Objekte (`score.ts:52-59`).
    - Slippy-Math dreifach implementiert (`score.ts`, `landmarks.ts`,
      `Map.tsx`); Antimeridian nicht behandelt.

---

## 3. Performance

| Befund | Ort | Wirkung |
|---|---|---|
| `useSettings()` ohne Selector im 4.700-Zeilen-`LiveMap` | `Map.tsx:1554-1608` | jeder Slider-Tick rendert den ganzen Baum |
| `moveend → setView` | `Map.tsx:1903-1906` | Full-Re-Render bei jedem Pan/Zoom |
| NO₂-Probe: 8 Kandidaten × 7 Tage, seriell, 8 s Timeout | `Map.tsx:1148-1158` | bis 56 Requests, Minuten Latenz |
| Bottom-Sheet animiert `height` + `blur(14px)` | `globals.css:351-353` | Layout + Composite pro Frame |
| Route-Candidates in localStorage | `hiking/store.ts:135-143` | JSON-Stringify aller Koordinaten pro Chunk |
| Unbounded Caches (Rail, Landmarks, Wikipedia, Probes) | mehrere | Memory-Wachstum in langen Sessions |
| `reapply` mit stale Closure + `eslint-disable` | `Map.tsx:1989-2043` | falsche Layer nach Style-Swap |
| `style.load` doppelt | 8 Stellen | doppelte Layer-Erstellung |
| `DebugHud` scannt Style jede Sekunde | `Map.tsx:4624-4634` | O(layers) bei 1 Hz |
| 85 arbiträre Font-Sizes, 40× 9–10 px | `src/**` | Lesbarkeit, nicht CPU |

---

## 4. Mobile & Touch

- **Kein echtes Bottom-Sheet:** Der „Grabber“ ist ein `<button>` mit
  `onClick` (`Map.tsx:3417-3422`). Kein Pointer-Tracking, keine Velocity,
  kein Rubber-Banding, kein Snap. `height`-Transition ist CPU-/Layout-intensiv.
- **Snap-Punkte:** peek `82px + safe-bottom`, half `50dvh`, full
  `100dvh - 56px` (`globals.css:354-359`). Die reale Topbar ist 48–95 px
  hoch (drei Konstanten: 56/62/76) → Lücke/Overlap.
- **Safe Area:** Sheet-Body nur `pb-4` (`Map.tsx:3522`); Home-Indicator
  überdeckt Controls.
- **Keyboard:** kein `visualViewport`-Handling; iOS-Keyboard verdeckt
  Suchergebnisse im Half-Sheet.
- **Breakpoints:** nur 768 px. Landscape-Phone 932×430 bekommt den
  Desktop-Drawer; 6 gestapelte Controls (~230 px) verdecken >50 %
  der Karte.
- **Tap-Targets:** siehe P1 #20; zusätzlich 32×32 Icon-Buttons, 26–32 px
  Chips, 38 px MapLibre-Buttons.
- **Overflow:** Geo-Pill (nowrap), Topbar bei 320 px (Suche ~124 px),
  Credentials-Modal ohne Scroll.
- **Scroll/Drag:** `overscroll-contain` nur am Panel-Body; kein
  `touch-action`-Management am Grabber.

---

## 5. Design & Accessibility

- **Farben:** zwei Brand-Limes (`#d6e76b` UI vs. `#d4ff38` Logo/Marker/Rail),
  5 Near-Blacks, Tailwind-Palette neben Tokens.
- **Radien:** 9 Werte (2/4/6/12/14/16/18/24/999/9999).
- **Schatten:** 13 CSS- + 5 JSX-Stacks, inkl. No-Op
  (`--hud-accent-glow: transparent`).
- **Typo:** 85 Font-Sizes; 9 px ×13, 10 px ×27; Panel-Titel 13 vs.
  Drawer 15 vs. Modal 18.
- **Kontrast:** `--ink-mute #6c6e62` auf `#232520` ≈ 3,0:1 bei 10 px
  (inkl. Attribution) → WCAG AA Fail.
- **Fokus:** nur Modal hat `:focus-visible`; alle HUD-Buttons nicht.
- **ARIA:** Suchfelder ohne Label/Combobox; Segment-Controls ohne
  `aria-pressed`; async Status ohne `aria-live`; Drawer-`aria-hidden`
  über Fokusierbarem.
- **Reduced Motion:** globaler Kill-Switch vorhanden, aber JS-Kameraflights
  (700–900 ms) nicht gated.
- **Theme:** dark-only, kein `color-scheme: dark`; Light-Mode aktuell
  unmöglich ohne ~90 Hardcodes.

---

## 6. Repo & Tooling

- `node_modules` und `.next` sind in Git getrackt (`.gitignore` ignoriert
  sie bereits) → 85 MB `.git`, `npm ci` unnötig fragil.
- Keine Tests, keine CI.
- Lint: 20 Errors / 9 Warnings (React-Compiler-Regeln).
- Toter Code: `LedToggle.tsx`, `VariantChips`, `.hud-bottom-nav`,
  `--r-pill`, `--accent-mute`, `--hud-accent-glow`, `--hud-border-strong`,
  `useTimelapseStore`, `.hud-scanlines`.

---

## 7. Externe APIs (Live geprüft)

| Endpoint | Status | CORS | Beobachtung |
|---|---|---|---|
| `brouter.de/brouter` | 200 | `*` | 213 Punkte, 38 KB für 4 km Auto; `messages` ist eine Kosten-Tabelle, **keine** Turn-Instruktionen |
| `api.transitous.org/api/v1/plan` | 200 | `*` | Berlin→Hamburg: 2 Itineraries, 125 KB; Legs mit `realTime`, `cancelled`, `routeShortName`, `agencyName`, `intermediateStops`, Geometrie |
| `api.transitous.org/api/v1/geocode` | 200 | `*` | Haltestellen inkl. `modes`, `country`, `areas` |
| `valhalla1.openstreetmap.de/route` | 200 | `*` | echte `maneuvers` + `verbal_*`, `summary` |
| `router.project-osrm.org` | 200 | `*` | Steps vorhanden, Demo-Nutzung aber nicht production-tauglich |
| `realtime.gtfs.de/realtime-free.pb` | — | — | GTFS-RT, Updates alle 10 s, CC BY-SA 4.0 |
| DELFI/GTFS.de static | — | — | Full 264 MB, 1,8 Mio. Trips, 676k Stops, 30-Tage-Horizont |

---

## 8. Offene Runtime-Checks

- LCP/TTI/FCP und Tile-Cache-Hit-Ratio (Lighthouse/Trace folgt in Phase 7).
- Memory über 10+ Minuten (Rail + Landmark + Probe-Caches).
- Visuelle Layer-Reihenfolge gegen OHM-Symbol-Layer.
- Kontrast nach Token-Rewrite (automatisiert + manuell).
- iOS-Safari-spezifische Gesten/Permissions (nur auf Gerät).

---

## 9. Remediation-Mapping

| Phase | Inhalt |
|---|---|
| 0 | Repo-Hygiene, CI, dieses Dokument |
| 1 | Design-Tokens, Shell-Primitives, ein Akzent, A11y-Fundament |
| 2 | Echtes Bottom-Sheet, Safe-Areas, Breakpoints, Keyboard |
| 3 | P0/P1-Bugs, Request-Aborts, Caches, Render-Perf |
| 4 | Auto-/Transit-Routing, Planner-Store, Karten-Layer |
| 5 | Navigationsmodus, Off-Route, Voice, Simulation |
| 6 | Panel-Redesign, Zustände, Datenquellen-Screen |
| 7 | Tests, Lighthouse, Reviewer, Politur |
