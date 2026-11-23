# Nature Overlays: Framework, Wetterradar, DWD-Warnungen

**Datum:** 2026-11-21
**Branch:** `feat/nature-overlays`
**Betroffene Dateien:** `src/lib/overlays/**` (neu), `src/components/hud/WeatherPanel.tsx` (neu),
`src/components/hud/useOverlayLayers.ts` (neu), `src/components/hud/BiospherePanel.tsx`,
`src/components/Map.tsx` (eine Hook-Zeile), `src/components/ui/icons.tsx`,
`server/dewmap-data/**` (neu, Spiegel des VPS-Gateways), `package.json` (Test-Skript).

## 1. Ziel

1. Eine wiederverwendbare Overlay-Registry im Client, die beliebige Kartenebenen
   (Raster, Vektor, GeoJSON) deklarativ beschreibt, sie robust über Basemap-Style-
   Wechsel hinweg hält und Zeit-/Opazitäts-Zustand zentral verwaltet.
2. Zwei Ebenen, die sofort einen echten Nutzen haben und ganz oben in der
   Nature-Kategorie stehen: **Wetterradar + Nowcast** und **DWD-Warnungen**.
3. Ein VPS-Gateway, das die externen Quellen cached, normalisiert und CORS-sicher
   ausliefert, ohne offenes Proxy zu sein.
4. Eine belegte Feasibility-Matrix für die weiteren Nature-Ebenen — dokumentiert,
   nicht gebaut.

Nicht im Scope: Planner-Dateien (Agent A), Shadow-spezifische Dateien (Agent C),
eigener Raster-Build (RADOLAN-Binärdecoding, GeoTIFF-Reprojektion).

## 2. Quellen-Recherche (live geprüft am 2026-11-21, 04:50–05:20 UTC)

Alle Messungen mit `curl` von einem deutschen Host gegen die echten Endpunkte.

### 2.1 Wetterradar

| Kandidat | Befund |
| --- | --- |
| `Radar_rv_product_1x1km_ger` (DWD GeoServer WMS) | **Gewählt.** Deutsches Radarkomposit RV, 1,1 km, Analyse **und** Nowcast in einem Layer. `Dimension time` = `PT5M`, Horizont ≈ 2 h vor jetzt. BBox EPSG:3857 `162894,5729950,2085194,7602217` (= 1,4633° O … 18,7316° O, 45,6846° N … 56,2194° N). `Format=image/png`, `transparent=true`. 1200 px ≈ 97 KB, 1,2–7 s Renderzeit (stark schwankend, GeoServer rendert auf Anfrage). `Fingerprint`-Caching: nein. CORS `*`. Lizenz DL-DE-BY-2.0, Quellenangabe „Deutscher Wetterdienst (DWD)". |
| `Radar_wn-product_1x1km_ger` | Identische Geometrie/Zeitachse, anderes Komposit (WN). Kein Mehrwert gegenüber RV — nicht verwendet. |
| `Radar_wn-analysis_1x1km_ger` | Nur Analyse, ohne Vorhersage. RV deckt beides ab. |
| RADOLAN RW/RY/SF (opendata, binär) | Braucht RADOLAN-Decoder + Reprojektion → eigener Raster-Build, nicht im Rahmen. |
| WMTS-Cache (`/geoserver/gwc/service/wmts`) | Enthält nur `Radar_eucom_zeros`, **nicht** RV → keine gecachten Kacheln. |
| RainViewer (`api.rainviewer.com`) | Global, CDN-schnell, aber fremde Aggregation, kein Nowcast ohne Key, und die Radarquellen sind für DE dieselben DWD-Daten. Nur als Fallback denkbar, nicht verbaut. |

**Entscheidung:** ein **Proxy mit Disk-Cache am VPS**, der pro 5-Minuten-Slot
**ein** deutschlandweites PNG liefert (kein Tile-Proxy).

Begründung gegen Kacheln: RV liegt in 1,1-km-Native auf; ein 1000-px-Bild über
Deutschland ist bereits ~1,3 km/Bildpunkt. Ein Kachel-Proxy würde pro Frame und
Zoomstufe Dutzende GeoServer-Renderings auslösen (gemessen 1–7 s je Kachel) und
den Cache auf hunderte MB treiben. Ein Bild pro Slot ist ein Upstream-Request,
deterministisch cachebar (~70 KB), und die native Auflösung ist ohnehin erreicht.
Jenseits von z≈11 wird das Bild weichgezeichnet — das ist die Auflösungsgrenze
der Quelle, nicht des Clients.

**Auflösung:** 1000 × 974 px. 1200 px bringt nur 30 % mehr Bytes bei 1,0–4 s
Renderzeit; 800 px kostet sichtbar Schärfe. Gemessen nach dem Strippen (siehe
unten): 40 KB pro Frame.

**Nachbearbeitung der PNGs (wichtige Design-Entscheidung):** Der DWD-Style malt
zwei Dinge mit, die über einer Basemap nichts verloren haben:

- eine neutrale Graufläche `#7E7E7E` bei 30 % Alpha über der gesamten
  Radar-Abdeckung („kein Echo / keine Daten", 389 615 von 974 000 Pixeln),
- eine magentafarbene Kontur (`#FB00FF`) um den Komposit-Rand.

Über einer dunklen Karte wirkt die Graufläche als Schleier (das gesamte Land
wird entsättigt), die Magenta-Kontur als Leuchtlinie. Der Gateway dekodiert
deshalb jedes Frame (8-bit, non-interlaced, RGB/RGBA), setzt genau diese Pixel
auf transparent und kodiert neu:

- Grau: `max−min ≤ 12` und `100 < max < 160` und Alpha < 200,
- Grenzen: `maxOutputLength = height·(stride+1) + 1024` beim `inflateSync`,
  maximal 1,5 Mio. Pixel und 20 MB Rohpuffer — der 1000×974-Frame liegt bei
  0,97 Mio. Pixel, alles darüber wird unverändert durchgereicht statt dekodiert.
  Am Cap kostet ein Decode ~130 ms Event-Loop und ~36 MB; 1,5 Mpx lässt Luft für
  ein etwas größeres Komposit (DWD erweitert 2026-11-24 den Scanradius) und
  blockiert den Loop trotzdem nicht für Sekunden.
- Magenta: `g < 115`, `r > 150`, `b > 120`, `|r−b| < 45` — trifft die
  DWD-Klassen nicht (`#cc0098`, `#6600cb`, `#e5004c` haben andere Kanäle).

Ergebnis: 69 671 → 50 550 B (−27 %), 42 ms pro Frame, nur beim Cache-Miss.
Jedes andere Format (Palette, 16-bit, interlaced) wird unverändert
durchgereicht — ein Upstream-Formatwechsel degradiert also zum alten Verhalten
statt die Ebene zu brechen.

### 2.2 Warnungen

| Baustein | Befund |
| --- | --- |
| `https://www.dwd.de/DWD/warnungen/warnapp/json/warnings.json` | 379 KB, JSONP-Wrapper `warnWetter.loadWarnings({...});`, CORS `*`, `Cache-Control` fehlt. Felder: `time`, `warnings[warncellId][]`, `vorabInformation`, `copyright`. Warnung: `level` 1–4, `type` 0–6, `event`, `headline`, `description`, `instruction`, `regionName`, `state`, `stateShort`, `start`, `end`, `altitudeStart/End` (ms-Epoch). Wird im Minutentakt neu geschrieben. |
| `https://maps.dwd.de/geoserver/dwd/ows` WFS `dwd:Warngebiete_Kreise,dwd:Warngebiete_Gemeinden` | GeoJSON mit `WARNCELLID`, `NAME`, `KURZNAME`, `BL`. `CQL_FILTER=WARNCELLID IN (…)` funktioniert über beide Typen in einem Request. Alle 373 aktiven Zellen: 765 KB roh / 201 KB gzip, ~1,0 s. CORS `*`. |
| `nina.api.proxy.bund.dev` | DNS nicht auflösbar (Dienst eingestellt) — verworfen. |
| DWD CAP (`opendata.dwd.de/.../cap`) | XML pro Warnzelle, kein CORS, viele Dateien — mehr Aufwand als Nutzen gegenüber `warnings.json`. |

**Entscheidung:** Gateway normalisiert `warnings.json` **und** joint die
Geometrien der *aktuell aktiven* Warnzellen aus dem WFS zu einer
FeatureCollection. Zwei getrennte Kennzahlen: `areasUnavailable: true`, wenn der
WFS-Abruf selbst scheitert (dann gibt es gar keine Flächen), und `areasMissing`,
wenn einzelne Warnzellen keine Geometrie haben (Kombi-/Seezellen). Kein 17-MB-Komplett-Download aller Gemeinden, sondern nur die
Zellen, die gerade eine Warnung tragen (heute: 373 → 201 KB gzip).

Die Warnzellen-IDs aus `warnings.json` matchen `WARNCELLID` in beiden
WFS-Layern (Stichprobe: `106535000` → „Vogelsbergkreis").

### 2.3 Weitere Nature-Ebenen — Feasibility

Aufwand: S = ein Nachmittag, M = ein Tag, L = mehrere Tage.
Risiko bezieht sich auf Bruch/Lizenz/Last.

| Ebene | Quelle (geprüft) | Takt | CORS | Weg | Aufwand | Risiko |
| --- | --- | --- | --- | --- | --- | --- |
| **Blitzdichte** | DWD WMS `Blitzdichte` (NowCastMIX) | 5 min | `*` | identische Pipeline wie Radar (nur andere Layer-ID, 4 KB @800 px, 0,34 s) | **S** | niedrig |
| **Gewitterzellen** | DWD WMS `Gewitterzellen` | 5 min | `*` | wie oben, Vektor-Symbole im Raster | S | niedrig |
| **Wind 10 m** | DWD WMS `Icon_reg025_fd_sl_UV10M` | stündlich, +7 d | `*` | Proxy, ein Bild pro Lauf | S–M | niedrig (Windbarben statt Fläche = schlecht lesbar bei kleinen Zoomstufen) |
| **Luftdruck MSL** | DWD WMS `Icon_reg025_fd_sl_PMSL` | stündlich, +7 d | `*` | Proxy | S | niedrig |
| **Pollen** | `opendata.dwd.de/.../s31fg.json` (16 KB) | täglich 11 Uhr | **nein** | Proxy + Regionszuordnung (Teilgebiete, keine Geometrie im JSON) | M | mittel (Regionen müssen als kleine Polygonliste gepflegt werden) |
| **UV-Index** | `opendata.dwd.de/.../uvi.json` (3 KB) | täglich 07:30 | **nein** | Proxy, Punkt-/Stationsdarstellung | S | niedrig |
| **Luftqualität** | UBA `luftdaten.umweltbundesamt.de/api/air-data/v3` | stündlich | **nein** (Redirect + kein ACAO) | Proxy + Stationsaggregation zu H3/Hex | M | mittel (API-Form wechselt, viele Requests) |
| **Pegel** | PEGELONLINE `stations.json?includeCurrentMeasurement=true` | 15 min | `*` | direkt möglich, besser Proxy mit Trim (755 KB → ~90 KB) | S | niedrig |
| **Waldbrandgefahr** | kein WMS-Layer im `dwd`-Workspace; DWD liefert nur Text/CSV | täglich | – | eigener Raster-Build | L | hoch |
| **Bodenfeuchte** | kein DWD-WMS-Layer; UFZ-Dürremonitor als GeoTIFF | täglich | – | eigener Raster-Build + Reprojektion | L | hoch |
| **Schnee** | nur `snow_days_year` (Klimanormal), kein Live-Produkt | – | – | – | – | nicht machbar |
| **Blitze (Blitzortung.org)** | keine offizielle API, WebSocket, ToS unklar | – | – | – | – | verworfen; DWD `Blitzdichte` deckt den Bedarf |

Bewusst **nicht** gebaut: alles außer Radar + Warnungen. Die Tabelle ist die
Grundlage für die nächste Iteration; Blitzdichte ist der günstigste nächste Schritt
(keine neue Architektur, ~30 Zeilen).

## 3. Architektur

### 3.1 Schichten

```
DWD GeoServer WMS ─┐
DWD warnings.json ─┤   VPS-Gateway (node, keine Deps)      Client
DWD WFS ───────────┘ → normalisieren, cachen, gzipen  →  Registry → MapLibre
                        /api/weather/radar/frames            │
                        /api/weather/radar/frames/{slot}.png  ├─ Store (zustand)
                        /api/weather/warnings                 └─ WeatherPanel
```

Der Client kennt keine DWD-URLs. Er kennt `DATA_API_BASE` und drei Endpunkte.
Damit ist ein Quellenwechsel (z. B. RainViewer-Fallback) eine Server-Änderung.

### 3.2 Client-Registry

`src/lib/overlays/types.ts`

```ts
type OverlayGroup = "weather" | "water" | "air" | "biology" | (string & {});
type OverlayKind = "raster" | "vector" | "geojson";

interface OverlayDefinition {
  id: string;                 // stabil, wird Source-/Layer-Präfix
  label: string;
  group: OverlayGroup;
  kind: OverlayKind;
  description: string;        // Panel-Caption
  attribution: { label: string; url?: string };
  opacity: number;            // Default
  minzoom?: number;
  maxzoom?: number;
  timeAware: boolean;
  order: number;              // Stapelreihenfolge, größer = weiter oben
  popup?: (props) => string;  // optional: Tap-Popup-HTML
  resolve(ctx): ResolvedOverlay | null;
}
```

`resolve(ctx)` ist der einzige dynamische Teil. `ctx` enthält `opacity`, den
Radar-Zustand (Frames + Index) und die Warnungs-Features. Rückgabe ist eine
`OverlaySourceSpec` (`image` | `raster` | `geojson`) plus eine Liste von
`OverlayLayerSpec` (Typ, paint, layout, filter, min/maxzoom).

`src/lib/overlays/index.ts` hält die Registry:

```ts
registerOverlay(def)   // idempotent, überschreibt gleiche id
getOverlay(id)
listOverlays(group?)   // sortiert nach order
```

Andockpunkt für weitere Module: `registerShadowOverlay()` (Agent C) ruft später
nur `registerOverlay({ ... group: "shadow" ... })` auf — es gibt bewusst keine
shadow-spezifische Datei und keine Sonderlogik in der Registry.

Radar-Ebene: `maxzoom: 12`. Das Komposit liegt bei ~1,3 km pro Quellpixel;
darüber hinaus wäre nur noch ein weicher Fleck zu sehen, also endet die Ebene
dort (Caption und Design sagen dasselbe). Warnungsflächen haben kein
Zoom-Limit — Polygone skalieren verlustfrei.

`src/lib/overlays/apply.ts` ist die **eine** Stelle, die MapLibre mutiert:

- Source-ID = `overlay:{id}`, Layer-IDs = `overlay:{id}:{n}`.
- `reconcileOverlays(map, resolved[], beforeId)` fügt fehlende Sources/Layer hinzu,
  aktualisiert `geojson.setData`, `image.updateImage` (Frame-Wechsel ohne
  Layer-Neubau) und entfernt alles, was nicht mehr aktiv ist.
- `beforeId` wird einmal pro Durchlauf bestimmt: erster existierender Layer aus
  `poi-mini-dots` → `live-vehicles-halo` → erster Symbol-Layer des Styles.
  Damit liegt das Radar über Flächen/Linien, aber **unter** Beschriftungen und POIs.
- Attributions-Hinweis: MapLibre akzeptiert `attribution` nur an `raster`- und
  `geojson`-Sources — eine `image`-Source mit `attribution` lehnt der
  Style-Validator komplett ab (Quelle wird nicht angelegt). Deshalb gibt es für
  Image-Ebenen einen eigenen `MapLibre`-Control (`MapCredit`) im Bottom-Right-
  Stack: er nennt jede aktive Image-Ebene („Rain radar: DWD", später „Shadows:
  Geobasis NRW"), erbt die bestehenden Panel-/Mobile-Positionierungsregeln und
  listet nur Ebenen, die sich nicht selbst creditten können — keine Dopplung
  mit dem Attributionscontrol. Die Warnungen (GeoJSON) bleiben dort.
- Wechselt eine Definition den Quelltyp (`geojson` ↔ `image` ↔ `raster`), wird
  die Source neu aufgebaut — MapLibre kann eine Source nicht umtypisieren, und
  `setData` auf einer Image-Source ist ein stummer No-op.
- Robustheit gegen Style-Wechsel: der Hook hört auf `style.load` **und** `idle`
  (ein `style.load` kann vor dem Effekt gefeuert haben) und reconciliert erneut.

### 3.3 Zeitdimension

Der Server berechnet die Frames, nicht der Client:

- `anchor` = auf 5 Minuten abgerundetes `now − 10 min` (DWD-Lag gemessen 6 min).
- Analyse: `anchor − 55 min … anchor`, 5-Minuten-Schritt → 12 Frames.
- Nowcast: `anchor + 15 … anchor + 90 min`, 15-Minuten-Schritt → 6 Frames.
- 18 Frames gesamt. `?time=` existiert nur serverseitig im WMS-Request; der Client
  bekommt fertige URLs (`/api/weather/radar/frames/20261121T0450.png`).

Slots, die DWD noch nicht hat, antworten mit `502 frame_unavailable`
(GeoServer liefert dann `ServiceException code="InvalidDimensionValue"`, HTTP 200
mit XML — der Proxy prüft den Content-Type, nicht die Größe).

### 3.4 Client-Zustand

`src/lib/overlays/store.ts` (zustand + persist, Key `dewmap:overlays`, Version 1):

```
enabled: Record<id, boolean>      persistiert
opacity: Record<id, number>       persistiert
radarIndex, radarPlaying          nicht persistiert
radarFrames/meta/status/error     Laufzeit
warnings/payload/status/error     Laufzeit
```

Getrennt von `useSettings`, weil die Registry erweiterbar ist: ein neues Overlay
braucht keinen Migrationsschritt in `settings.ts` (und kollidiert nicht mit den
parallel arbeitenden Agenten).

Datenhooks:

- `useRadarFrames()` — lädt `/frames` beim Einschalten und danach alle 5 min;
  hält den Index auf „jetzt", solange der Nutzer nicht scrubbt.
- `useRadarPlayback()` — 600 ms/Frame, Looping, pausiert bei verstecktem Tab.
- `useWarnings()` — lädt `/warnings` beim Einschalten und alle 5 min.

### 3.5 UI

`WeatherPanel` sitzt **oben** in `BiospherePanel`, vor „Land Cover". Zwei Karten
im gleichen `HudPanel`-Muster wie die bestehenden:

1. **Rain radar** — Schalter, Opazität, Zeit-Slider mit Frame-Label
   (`04:50 · vor 10 Min` / `Nowcast +15`), Play/Pause (44 × 44 px), Legende
   (DWD-Palette als CSS-Gradient, Klassen 0,1 / 1 / 5 / 20 / 150 mm/h),
   Statuszeile, Attribution. Der Slider läuft auf **Minuten**, nicht auf
   Frame-Indizes: die Frame-Folge ist ungleichmäßig (5-Minuten-Analyse,
   15-Minuten-Nowcast), und eine Index-Achse würde „Jetzt" an die falsche
   Stelle setzen (65 % statt 38 %).
2. **Weather warnings** — Schalter, Zähler je Stufe, Liste der aktiven Warnungen
   (Stufe, Ereignis, Gebiet, Gültigkeit), Attribution.

Beide Karten zeigen bei fehlgeschlagener Aktualisierung weiter ihre Daten
(„… · refresh failed") statt eines reinen Fehlers — Status-Vorrang liegt in
`src/lib/overlays/status.ts` und ist unit-getestet.

Zeitangaben laufen bewusst in `Europe/Berlin`: DWD-Zeitstempel und
Warnfenster („bis 09:00") meinen deutsche Ortszeit, unabhängig davon, wo der
Besucher sitzt.

Kein Emoji, Graphite-Tokens (`--ink`, `--ink-dim`, `--warn`, `--danger`), Slider
und Buttons mit ≥ 44 px Trefferfläche. Bestehende Karten bleiben unverändert.

## 4. Gateway

### 4.1 Endpunkte

| Methode | Pfad | Cache | Antwort |
| --- | --- | --- | --- |
| GET | `/health` | – | unverändert + `cache`, `upstreams` (zusätzliche Felder) |
| GET | `/api/status` | – | unverändert + gleiche Zusatzfelder |
| GET | `/api/weather/radar/frames` | 60 s | Frame-Liste, Anchor, Bildmaße, Attribution |
| GET | `/api/weather/radar/frames/{slot}.png` | `immutable` | PNG, `X-Cache: hit\|miss`, `ETag` |
| GET | `/api/weather/warnings` | 300 s | normalisierte Warnungen + Warngebiets-Geometrien |

`{slot}` = `YYYYMMDDTHHMM` (UTC). Nur Werte auf dem 5-Minuten-Raster im Fenster
`now − 6 h … now + 3 h` werden angenommen — alles andere ist `400`. Damit kann
der Cache nicht durch beliebige Zeitstempel aufgebläht werden.

Trailing Slashes werden **in** der Routing-Tabelle (`lib.normalizePath`)
normalisiert, nicht in der HTTP-Schicht: `/health/`, `/api/weather/radar/frames/`
und `/…/20261121T1410.png/` sind dieselben Endpunkte wie ohne Slash. Die Regel
liegt damit im getesteten Code, nicht in einer ungetesteten Zeile davor.

### 4.2 Upstream-Allowlist

Es gibt **keinen** Parameter, der eine URL bestimmt. Die drei Upstream-Hosts sind
im Code fest verdrahtet:

```
https://maps.dwd.de/geoserver/dwd/wms   (Radar)
https://www.dwd.de/DWD/warnungen/...    (Warnungen)
https://maps.dwd.de/geoserver/dwd/ows   (WFS Warngebiete)
```

Jeder Request: `AbortSignal.timeout(12000)`, Größenlimit 5 MB — **beim Lesen
gezählt** (Stream, `controller.abort()` beim Überschreiten), nicht am
`content-length`, weil chunked-Antworten keinen Header haben und gzip die
komprimierte Größe meldet. `isPng` verlangt Magic Bytes **und** einen
PNG-Content-Type; eine falsch deklarierte Antwort wird nie als `immutable`
gecacht.
`User-Agent: dewmap-data/0.2 (+https://dewmap.app)`.

### 4.3 Cache

- Disk: `/app/cache/radar/{slot}.png`, `/app/cache/warnings/{idhash}.json`
  (rw-Bind-Mount `/opt/dewmap-data/cache`).
- Memory: `Map` mit LRU-Kappe (radar 64 Einträge, warnings 4) für die
  heißen Pfade; Disk ist die Wahrheit über Neustarts.
- Radar-Frames sind unveränderlich (`immutable`, 1 Jahr). Cleanup beim Schreiben:
  alle `radar/*.png` mit Slot älter als 6 h löschen; harte Obergrenze 400
  Dateien. Bei ~40 KB pro Frame sind das worst case ~28 MB — deutlich unter dem
  1-GB-Budget.
- Warnungen: 5 min frisch, danach `stale-while-revalidate`: bei Upstream-Fehler
  wird die letzte Fassung bis 30 min weiter ausgeliefert (`X-Cache: stale`).
- **Inflight-Dedupe + Render-Cap:** identische Slots teilen sich ein Promise
  (`X-Cache: coalesced`); hoechstens 3 Upstream-Renderings laufen gleichzeitig,
  bis zu 12 warten in der Queue, alles darüber bekommt `503` mit
  `Retry-After: 3`. Ohne das kostete ein kalter Frame ~7 MB RSS und ~90 ms
  Event-Loop — bei 128 MB Limit reichten wenige Dutzend parallele Requests für
  ein OOM. Gemessen mit 8 parallelen kalten Slots: Peak 48,9 MB RSS,
  Latenzen gestaffelt 0,15–10 s, kein OOM.
- **Warmer:** `/frames` stößt sofort einen Warm-Lauf an, danach prüft ein 60-s-Tick
  den neuesten Analyse-Slot. Ein bis zwei DWD-Requests pro 5 Minuten — der
  Grund, warum echte Nutzer selten kalt treffen. Gemessen: `/frames` 84 ms,
  danach Frame-Abruf warm 114 ms, während der kalte GeoServer-Render 1,6–10 s
  braucht.
- **Client-Prefetch:** die erste Wiedergabe lädt alle Frame-URLs einmal in den
  Browser-Cache (18 × ~40 KB), damit die Animation nicht ruckelt. Ohne Play
  wird genau ein Frame geladen. Die URLs laufen dabei durch `dataApiUrl()`
  (Gateway-Origin), nie gegen die App-Origin.
- **Zeitbudgets (gemessen):** kaltes Radar-Rendering 1,6–10,1 s (Maximum aus
  Review und eigener Messung: 10,15 s), kalter Warnungsaufbau 0,6–9,6 s
  (`warnings.json` + WFS). Deshalb: Upstream-Timeout 15 s je Quelle,
  Client-Budget 15 s für `/frames` (rein berechnet) und 40 s für `/warnings`
  (2 × 15 s + Verarbeitung). Warnungen liefern nach Ablauf der 5-Minuten-TTL
  **sofort** die letzte Fassung (`X-Cache: stale`) und bauen im Hintergrund neu;
  nur die allererste Anfrage wartet.
- **Radar-Bildfehler:** MapLibre schluckt fehlgeschlagene Image-Tiles still. Ein
  `<img>`-Preload des gewählten Frames liefert ein eindeutiges Signal und wärmt
  zugleich den Cache; bei Fehler (z. B. Gateway-504) zeigt die Karte
  „Radar image could not be loaded for this frame." plus die Frame-Info.
- **Sprache:** UI-Copy ist Englisch (die App ist `lang="en"`); DWD-Ereignis- und
  Gebietsnamen bleiben deutsch, weil sie Daten sind. Uhrzeiten bleiben
  `Europe/Berlin`.

### 4.4 Fehler-Normalisierung

```json
{ "ok": false, "error": "frame_unavailable", "message": "...", "upstream": "dwd-radar" }
```

Status: `400` ungültiger Slot, `502` Upstream-Fehler, `504` Timeout,
`503` Cache nicht beschreibbar (nur bei Radar-Frame, Warnungen laufen aus dem
Memory-Cache weiter).

## 5. Deployment (Guardrails)

1. Backups: `server.js`, `docker-compose.yml` → `*.bak-YYYYMMDD-HHMM`.
2. `mkdir -p /opt/dewmap-data/cache/{radar,warnings}`.
3. Compose: zusätzlicher Bind-Mount `./cache:/app/cache:rw` (nur dieser Service).
4. `docker compose -f /opt/dewmap-data/docker-compose.yml up -d` — nur
   `dewmap-data-api` wird neu erstellt.
5. Verifikation: `/health`, `/api/status`, `/api/weather/radar/frames`,
   ein Frame, `/api/weather/warnings`, `curl -fsSI .../tiles/transit-lines-v7.pmtiles`.
6. Rollback: `cp *.bak-… zurück`, `docker compose up -d`, Cache-Verzeichnis
   liegen lassen (schadet nicht) oder `rm -rf /opt/dewmap-data/cache`.

Caddy bleibt unverändert: `data.dewmap.app` reicht schon alles außer `/tiles/*`
an `dewmap-data-api:8787` weiter.

## 6. Tests

- **Vitest** (`src/lib/overlays/*.test.ts`): Registry-Registrierung/Überschreiben,
  Sortierung, `resolve`-Verträge, Radar-Frame-Labels, Warnungs-Normalisierung
  (Stufen, Zeitfenster, Dedupe), `apply`-ID-Bildung, Fehlerpfade der API
  (Timeout, 502, kaputter JSON).
- **node:test** (`server/dewmap-data/lib.test.mjs`): Slot-Validierung, Frame-Fenster,
  JSONP-Strip, Warnungs-Normalisierung + Zell-Join, Cache-Key, gzip.
- `npm run typecheck`, `npm run lint`, `npm run test`, `npm run check:no-emoji`.
- Browser (Port 3003): Radar sichtbar, Slider, Play/Pause, Warnungen + Popup,
  Attribution, Style-Wechsel (Vektor ↔ Foto), Zoom-Grenzen.
- Latenz: kalt/warm je Endpoint, Zahlen im Report.
