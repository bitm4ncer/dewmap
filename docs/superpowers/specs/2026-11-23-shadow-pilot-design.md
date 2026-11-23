# Schattenkarte — Pilot Düsseldorf (nutzbar)

Datum: 2026-11-23 · Status: Pilot in der App · Branch: `feat/shadow-ui`

Diese Spec beschreibt das, was aus dem Design vom 2026-11-21
(`2026-11-21-shadow-map-design.md`) tatsächlich gebaut wurde: eine sichtbare,
bedienbare Schattenkarte für **Düsseldorf**, mit echten LoD1-Höhen, einem
Worker und einer ehrlichen Leermeldung überall sonst.

## 1. Ziel und Abgrenzung

In der Nature-Kategorie gibt es die Karte **Shadows**:

- Toggle, Zeit-Slider (jetzt ±12 h, 5-Minuten-Schritte), „Now"-Button,
  Opazität, Attribution.
- Ab Zoom 14 werden Gebäudeschatten zur gewählten Zeit gerendert.
- Unter z14: „Zoom in to 14". Außerhalb des Pilotgebiets: „Outside the
  Düsseldorf pilot — no building heights here yet." Ohne Gebäude im Fenster:
  „No buildings in this view." Unter dem Horizont: „Sun below the horizon — no
  cast shadows."

Bewusst **nicht** Teil des Piloten: Gelände (DGM1), Vegetation (DOM1),
Dachformen (LoD2), andere Städte, vorberechnete Zeitfenster. Die Karte sagt
„buildings only · flat terrain", weil das die Wahrheit ist.

## 2. Datenpipeline

Quelle: OpenGeodata NRW, 3D-Gebäudemodell **LoD1** (CityGML, 1-km-Kacheln),
Datenlizenz Deutschland – Zero – 2.0. Skripte unter `scripts/shadow/`,
Dokumentation in `scripts/shadow/README.md`.

| Schritt | Ergebnis |
|---|---|
| Download (nur Bbox 6.68–6.92 E / 51.14–51.34 N) | 456 von 35 022 Kacheln, 3,2 GB (statt 91,8 GB) |
| Extraktion | 339 905 Gebäude, 84,9 MB GeoJSONL, 177 s |
| Tiling (tippecanoe z12–16, `--drop-densest-as-needed`) | 33,9 MB MBTiles |
| `pmtiles convert` | **31,9 MB** PMTiles (Limit 200 MB) |
| Upload | `/srv/dewmap-tiles/shadow/buildings-duesseldorf-v1.pmtiles` |

Regeln: Fußabdruck = Polygon mit der niedrigsten mittleren z (im Blockmodell
identisch mit dem Dach-Grundriss), Höhe = `bldg:measuredHeight`, sonst
z-Spanne, auf Meter gerundet; verworfen werden < 2 m, > 300 m und < 1 m²;
Douglas-Peucker 0,5 m; WGS84 mit 7 Nachkommastellen; nur Gebäude, deren
Centroid in der Pilot-Bbox liegt. UTM32-Projektion ist implementiert
(`scripts/shadow/utm.mjs`, Snyder/USGS PP 1395), keine neue Abhängigkeit.

Kacheln: z12 16 / z13 55 / z14 177 / z15 651 / z16 2 187; größte Kachel 22 kB
auf z16, 401 kB auf z13. Der Client liest z15/z16.

Hosting-Verifikation (`04-upload.mjs`, 2026-11-23):

```
200 · accept-ranges: bytes · access-control-allow-origin: * ·
public, max-age=31536000, immutable ·
Range bytes=0-126 → 206, 127 Bytes, magic "PMTiles"
```

Caddy wurde nicht angefasst.

## 3. Client

### 3.1 Loader — `src/lib/shadow/buildings.ts`

- `PMTiles` + `FetchSource` (Byte-Ranges), MVT-Decode mit
  `@mapbox/vector-tile` und `pbf`; keine neuen Laufzeit-Abhängigkeiten.
- Liest die Layer `buildings`, Property `height` (Double) und `id` (String).
- Dedupe über `id` (ein Gebäude an einer Kachelgrenze liegt in zwei Kacheln).
- Geometrie exakt Mercator-invertiert (`tilePointToLngLat`), nicht linear
  interpoliert.
- Cache pro Kachel (LRU, 64 Einträge) im Hook; `cacheHits`/`bytes` landen in
  der Statuszeile.
- Fehlerklassen `timeout | network | http | decode | aborted`; Pro-Kachel-
  Timeout 8 s, `withTimeout` bricht auch Quellen ab, die ihr Signal ignorieren.
- Zoom-Wahl: `mapZoom + 1`, geklemmt auf 14–16, und so weit reduziert, dass
  höchstens 36 Kacheln gelesen werden.

### 3.2 Fenster — `src/lib/shadow/window.ts`

`planShadowWindow(viewport, zoom)` entscheidet vor jeder Rechnung:

1. `zoom < 14` → `zoomed-out` (Meldung, kein Layer).
2. Überdeckung mit der Pilot-Bbox ≤ 2 % → `outside`.
3. Fenster auf 6 × 6 km um die Viewport-Mitte kappen, dann mit der Pilot-Bbox
   schneiden (das Bild deckt nur echtes Datengebiet).
4. Auflösung: Zoom-Tabelle (2/4/8 m), erhöht, bis ≤ 1,2 Mio. Zellen.

Damit ist die Viewport-Fläche begrenzt und der Worker bleibt im
100–200-ms-Bereich. `partial` markiert gekappte Fenster in der Statuszeile
(„clipped to pilot").

### 3.3 Worker — `src/lib/shadow/worker.ts`, `workerTask.ts`, `png.ts`

```ts
{ type: "render", id, bbox, timeMs, resolutionM, buildings }
→ { type: "result", id, pngUrl, bbox, width, height, resolutionM, sun, stats }
| { type: "empty", id, reason: "no-buildings" | "night" | "too-large", sun }
| { type: "error", id, code: "no-canvas" | "compute" | "invalid", message }
```

- Gebäude gehen als drei TypedArrays (Höhen, Offsets, Koordinaten) mit
  Transfer über die Thread-Grenze, nicht als Objektgraph.
- `renderShadowWindow` ruft `computeShadowLayer(..., mode: "raster")`; kein
  Raymarching auf dem Main Thread.
- Maske → RGBA (Dämmerungs-Alpha 90–255 zwischen 0° und 3°) → `OffscreenCanvas`
  → PNG → Data URL. Kodierung und Kompression laufen im Worker.
- **Abbruch**: Ein laufender Worker wird beendet und neu gestartet. Ein
  synchroner Raymarch kann eine `cancel`-Nachricht nicht lesen; Terminieren ist
  der einzige ehrliche Abbruch. Ein *idler* Worker bleibt warm, weil Neustart
  pro Slider-Schritt teurer wäre als der Schritt selbst.
- Debounce 120 ms; die alte Maske bleibt sichtbar, bis die neue da ist.

### 3.4 Andocken an das Overlay-Framework

`overlay.ts` (aus Paket C) kennt jetzt zusätzlich eine **Bild-Quelle**:
`setShadowOverlayImage({ url, bbox })` setzt `kind: "raster"` und liefert eine
georeferenzierte `image`-Source mit `raster-opacity`. `setShadowOverlayData`
(GeoJSON) und `setShadowOverlayTiles` bleiben unverändert nutzbar.

Geändert in B2-Dateien:

```ts
registerShadowOverlay();                              // + 1 Zeile
const shadowVersion = useShadowOverlayVersion();      // + 2 Zeilen (Hook + Kommentar)
}, [..., shadowVersion]);                             // Dependency
```

`Map.tsx` bekommt eine Zeile: `useShadowOverlayData(mapInstance)`.

Warum PNG statt GeoJSON: Ein Fill-Layer mit Schattenpolygonen wäre bei 7 000
Gebäuden ein Multi-MB-`setData` pro Slider-Schritt und damit ein Long Task auf
dem Main Thread. Die Bild-Quelle überträgt 20–60 kB pro Schritt und wird wie
der vorhandene Radar-Layer gezeichnet. `setShadowOverlayData` bleibt als
Vektor-Pfad bestehen (Engine + Test).

### 3.5 Zustand und UI

- `useShadowSettings` (persistiert): nur `offsetMinutes` (±720, 5-min-Raster).
- `useShadowRuntime` (flüchtig): Phase, Meldung, Zoom, Sonnenstand, Statistik.
  Der Viewport-Bbox wird **nicht** vom Ergebnis überschrieben — sonst würde
  jede Antwort den Render-Effekt erneut auslösen (im Test gefunden, siehe §5).
- `ShadowCard` unter „Weather" in der Nature-Kategorie: Uhrzeit (Europe/Berlin),
  Tageskürzel bei Tageswechsel, Offset, „Now" (44 px), Slider (44 px Hit-Area,
  `aria-label="Shadow time"`, `aria-valuetext` mit Uhrzeit), Opazität, Statistik
  (`7.341 buildings · 4 m · 120 ms · sun 18°`), Hinweis „Düsseldorf pilot ·
  buildings only · LoD1 block models, flat terrain", Attribution Geobasis NRW /
  dl-de/zero-2.0 / © OpenStreetMap contributors.

## 4. Messungen (2026-11-23, Chromium headless, SwiftShader)

Aufbau: Produktionsbuild (`next build --webpack`, statisch ausgeliefert auf
:3006), 1440 × 900, Düsseldorf, Zoomstufe mit 4-m-Raster, 7 341 Gebäude im
Fenster (538 × 337 Zellen).

| Messung | Wert |
|---|---|
| Kalte Aktivierung (Cache geleert) | **810 ms** bis zur fertigen Maske |
| Kachel-Transfer kalt | 27 Range-Requests, **227 kB**, alle `206` |
| Kachel-Transfer warm (Slider) | **0 Requests**, 0 Byte (Kachel-Cache) |
| Slider-Schritt warm, Ende-zu-Ende | **402–463 ms** (120 ms Debounce + 100–131 ms Raymarch + PNG/Upload) |
| Worker-Raymarch (18° Sonne) | 100–135 ms |
| Worker-Raymarch (8° Sonne) | 148–166 ms |
| PNG-Kodierung im Worker | 30–144 ms |
| Long Tasks, Baseline 8 s ohne Schatten | **0** |
| Long Tasks, erste Aktivierung | **1 × 96–203 ms** (Shader-Kompilierung + erste Textur unter SwiftShader; Streuung über mehrere Läufe) |
| Long Tasks, 6 Slider-Schritte danach | **0** |
| Long Tasks, Opazität/Style/Zoom/Now | **0** |
| Console-Errors | 1, davon **0 aus dieser Änderung**: `404` auf ein Protomaps-Basemap-Glyph (`basemaps-assets/fonts/Open Sans Regular,…/0-255.pbf`), tritt beim Laden der Karte vor jeder Schatten-Interaktion auf |
| Sichtbarkeit (Pixeldiff, 2-px-Raster) | Schatten aus → an: **14,0 %** der Bildpunkte; +1 h → +3 h: **7,7 %**; Opazität 50 → 100 %: **19,7 %**; Vector → Hybrid: **52,2 %** (Basemap) bei weiterhin aktivem Layer |

Die 96–203 ms beim ersten Einschalten sind MapLibre-Initialisierung des
Raster-Programms und der Textur in einer Software-GL-Umgebung; sie treten
einmalig auf, nicht pro Interaktion. Auf echter GPU-Hardware ist dieser Anteil
nicht messbar.

## 5. Gefundene Fehler und Korrekturen

1. **Render-Schleife.** `ready()` schrieb die Ergebnis-Bbox in das
   Viewport-Feld. Neue Array-Identität → Effekt erneut → neuer Worker → neues
   Ergebnis, endlos (im Browser als wiederholte Worker-Chunk-Requests sichtbar,
   Status blieb „resolving"). Behoben: `ready()` setzt keinen Viewport mehr;
   Regressionstest in `state.test.ts`.
2. **Worker-Neustart pro Schritt.** `cancel()` terminierte auch den idlen
   Worker. Jetzt bleibt er warm; nur ein *laufender* Worker wird beendet.
3. **MVT-Ringe.** Der Decoder entfernt den wiederholten Schlusspunkt des
   Rings, bevor er an den Worker geht.
4. **`withTimeout`** verließ sich darauf, dass die Aufgabe das Abort-Signal
   beachtet; eine hängende Quelle blockierte den Aufrufer. Jetzt raced die
   Timeout-Promise selbst und wirft `timeout`.
5. **`--use-attribute-for-id`** funktioniert nur mit numerischen IDs; LoD1-IDs
   sind Strings (`DENW20AL…`). Die ID ist deshalb normale Property, Dedupe
   läuft darüber.

## 6. Grenzen und Rollout

- **Nur Gebäude, kein Gelände.** Düsseldorf ist flach (16,5 m Spanne im
  POC-Fenster); in Mittelgebirgen wäre die Karte falsch. DGM1-Terrain ist der
  nächste Schritt, nicht Teil dieses Piloten.
- **LoD1 = Blockmodell.** Keine Dachformen, keine Arkaden, keine Bäume. Bei
  4 m Raster ist das der richtige Detailgrad; LoD2 lohnt erst unter 2 m.
- **Eine Stadt.** Der Loader kennt genau eine PMTiles-Datei. Weitere Städte
  brauchen je ein Archiv plus eine Bbox-Tabelle (siehe `pilot.ts`).
- **Hohe Sonne, wenig Schatten.** Bei 60° ist der Pixeldiff klein; das ist
  Physik, nicht ein Fehler.
- **Software-GL.** Die Long-Task-Messung oben stammt aus einer
  SwiftShader-Umgebung; auf einem Gerät mit GPU sind Upload und Repaint
  deutlich kürzer. Der JS-Anteil des Layers liegt laut CPU-Profil bei ~10 ms pro
  Schritt.
- **PNG-Data-URLs** kosten pro Schritt 20–60 kB Heap und einen Decode. Ein
  `ImageBitmap`-Transfer würde den Decode sparen, verlangt aber eine Erweiterung
  von `lib/overlays/apply.ts` (B2) über die vereinbarten Andockzeilen hinaus.
- **Attribution.** dl-de/zero-2.0 verlangt keine Namensnennung; die Karte nennt
  Geobasis NRW trotzdem, plus OSM für die Basemap.
