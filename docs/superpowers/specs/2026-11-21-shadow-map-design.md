# Schattenkarte — Forschung, Design und Empfehlung

Datum: 2026-11-21 · Status: Design + POC, nicht produktiv · Branch: `feat/shadow-map`

## 1. Ziel

Eine Schattenkarte für dewmap: Gebäude- und Geländeschatten zu einer wählbaren
Zeit, weltweit als Produkt gedacht, zuerst für Deutschland, performant auf
Mobilgeräten, betreibbar auf dem vorhandenen VPS (4 GB RAM, 9,9 GB frei, 2
vCPU, keine GPU).

Erfolgskriterien für den POC:

1. Ein 2 × 2 km Fenster zu mindestens drei Uhrzeiten, visuell plausibel.
2. Gemessene Rechenzeit, Ausgabegröße und Qualität — keine Schätzungen als
   Fakten.
3. Eine Empfehlung, die auf dem VPS und auf einem Mittelklasse-Handy trägt.
4. Sauberer Andockpunkt an das Overlay-Framework, ohne dessen Dateien
   anzufassen.

## 2. Kurzfassung

**Empfehlung: Hybrid, clientseitig gerastert.**

- **Gebäude und Gelände** werden in einem Web Worker zu einem DSM gerastert
  und parallel zur Sonne ray-marched. Das ist der einzige Ansatz, der
  Geländeschatten, Selbstschatten und Innenhöfe korrekt behandelt und trotzdem
  ohne Server-Compute auskommt.
- **Gelände** kommt als grobes Horizont-Raster (25–30 m, 32 Richtungen) dazu.
  Ein Horizont-Raster kostet 51 ms pro 2 × 2 km und macht den Zeit-Slider
  danach praktisch kostenlos (0,04 ms Lookup).
- **Daten** kommen als Vektor-Kacheln mit Höhe (LoD2/LoD1, OSM als Fallback)
  plus öffentliche Terrain-Kacheln. Der VPS baut und liefert nur statische
  Kacheln; er rechnet nicht pro Anfrage.
- **Auflösung nach Zoom**: 4 m bis z15, 2 m bis z16, 1 m ab z17. Unter z14
  wird die Ebene ausgeblendet, weil Schatten dort subpixelgroß sind.

Damit liegt die Interaktion bei **24–110 ms** pro Zeitwechsel auf dem Desktop
und **0,23–0,86 s** auf einer auf 6× gedrosselten CPU (Mittelklasse-Handy). Der
vorberechnete Kachel-Ansatz (Variante C) scheitert an 2,6 GB pro Tag und
fehlender Rechenzeit; der reine Vektor-Ansatz (Variante A) scheitert an
Gelände und fehlenden Gebäudehöhen.

## 3. Forschungsfragen

### 3.1 Sonnenstand

Implementiert ist der NOAA/Meeus-Algorithmus (NOAA Solar Calculator,
„Solar Calculation Details", Gleichungen nach Jean Meeus, *Astronomical
Algorithms*). Validiert gegen den NREL-SPA-Referenzfall aus Reda & Andreas
(2004), NREL/TP-560-34302, Anhang A.5:

| Größe | SPA-Referenz | eigene Rechnung | Abweichung |
|---|---|---|---|
| Azimut | 194,340241° | 194,342580° | 0,00234° (8,4″) |
| Geometrische Elevation | 39,872° | 39,872070° | 0,00007° (0,27″) |
| Zenit (mit Refraktion) | 50,111622° | 50,112320° | 0,0007° |

SPA selbst gibt ±0,0003° an. Die 0,002° Azimutfehler sind die abgeschnittene
NOAA-Reihe; bei 500 m Schattenlänge sind das **2 cm** laterale Verschiebung —
zwei Größenordnungen unter einem 1-m-Pixel.

Warum nicht SPA selbst? SPA ist genauer, aber ein Vielfaches an Code und
Koeffiziententabellen. Der Fehler ist für Schatten irrelevant. Warum nicht
`suncalc`? Dessen Genauigkeit ist nicht dokumentiert; die NOAA-Formeln sind
nachvollziehbar und hier direkt gegen SPA geprüft.

Randbedingungen:

- **Refraktion**: NOAA korrigiert bis −0,575°. Für Schatten ist das der
  ehrliche Wert; unter 0° Elevation gibt es keine direkte Sonne.
- **Dämmerung**: Zivil (−6°), nautisch (−12°), astronomisch (−18°) sind als
  `twilightPhase()` verfügbar. Die Ebene blendet unter 0° aus.
- **Zeit**: alles in UTC; die Anzeige ist Ortszeit. Der Algorithmus ist
  zeitzonenunabhängig (Test vorhanden).

### 3.2 Daten

Alle Größen wurden am 2026-11-21 aus den offiziellen Verzeichnissen geladen und
gezählt, nicht geschätzt.

**Nordrhein-Westfalen (Geobasis NRW, OpenGeodata):**

| Produkt | Kacheln | Gesamt | Median |
|---|---:|---:|---:|
| DGM1 GeoTIFF, 1 m | 35.860 | 78,80 GB | 2,16 MB |
| DOM1 GeoTIFF, 1 m | 35.860 | 85,08 GB | 2,39 MB |
| LoD1 CityGML | 35.022 | 91,78 GB | 0,66 MB |
| LoD2 CityGML | 35.022 | 219,59 GB | 1,69 MB |

- Kachelraster: 1 km × 1 km, ETRS89/UTM32 (EPSG:25832), DHHN2016.
- **Lizenz: Datenlizenz Deutschland – Zero – Version 2.0** (`dl-de/zero-2-0`).
  Keine Namensnennung, keine Bedingungen. Wir nennen die Quelle trotzdem.
- Der Dateiname enthält das Befliegungsjahr, und das ist **nicht einheitlich**:
  Düsseldorf `…_2022.tif`, Siebengebirge `…_2021.tif`. Eine Pipeline muss das
  JSON/Atom-Verzeichnis lesen; konstruierte Namen liefen im Test auf 404.
- Download: 20 Kacheln (35,4 MB) mit Median 163 ms/Kachel, im Batch rund
  11 MB/s vom Open-Data-Server. 36 Kacheln für beide Testgebiete in unter 15 s.
- Der WCS-Endpunkt (`wcs_nw_dgm`) liefert `GetCapabilities` und
  `DescribeCoverage`, aber `GetCoverage` scheitert über den OGC-Proxy mit
  `InvalidParameterValue` (mehrere Subset-/CRS-Varianten getestet). Für die
  Pipeline sind die GeoTIFF-Kacheln der robuste Weg.

**Baden-Württemberg (LGL):** DGM1 1 m, LoD2 CityGML, 2-km-Kacheln,
**dl-de/by-2-0** (Namensnennung „Datenquelle: LGL, www.lgl-bw.de,
dl-de/by-2-0"). WCS mit 650 Mio. Pixel Limit und 10-min-Timeout.

**Bayern (BVV):** DGM1 1 m, LoD2 CityGML, 1-km-Kacheln, **CC BY 4.0**
(Namensnennung „Geobasisdaten: Bayerische Vermessungsverwaltung –
www.geodaten.bayern.de, Lizenz: CC BY 4.0"). Seit 2023 kostenfrei.

**Global / Europa:**

| Quelle | Auflösung | Lizenz | Bewertung |
|---|---|---|---|
| Copernicus DEM GLO-30 | 30 m | frei, Copernicus-DEM-Lizenz, Quellenvermerk | DSM (mit Gebäuden/Bewuchs), global |
| Copernicus DEM GLO-90 | 90 m | frei | zu grob für Schatten |
| EU-DEM via Mapzen Terrain Tiles | 25 m | Attributionsliste (EU-DEM, SRTM, GMTED2010, …) | frei, z0–z15, EU-DEM geglättet |
| SRTM 30 m | 30 m | public domain (NASA/USGS) | nur bis 60° N/S, veraltete Oberfläche |
| ALOS World 3D 30 m | 30 m | JAXA, frei mit Registrierung | Alternative zu SRTM |

Gemessen im Siebengebirge (2 × 2 km, 47–324 m): Mapzen/EU-DEM bei z14 (6,1 m
pro Pixel) gegen DGM1 1 m ergibt **RMSE 10,2 m, Maximalfehler 53,3 m**. Bei
22° Sonnenhöhe fällt die IoU der Geländeschatten zwischen beiden Quellen auf
**0,39**. Das ist der quantitative Beleg dafür, dass 25–30 m Gelände für
präzise Schatten nicht reicht — und warum die Landes-DGM der Premium-Pfad
sind.

### 3.3 Gebäudehöhen

Gemessen in den Testgebieten (OSM, Stand 2026-11-21):

| Gebiet | Gebäude | `height` | `building:levels` | ohne beides |
|---|---:|---:|---:|---:|
| Düsseldorf 2 × 2 km | 7.222 | 0,6 % | 8,1 % | 91,3 % |
| Düsseldorf 5 × 4 km | 29.798 | 0,45 % | 9,7 % | 89,9 % |
| Siebengebirge 4 × 4 km | 8.181 | 0,05 % | 12,6 % | 87,4 % |

Global (Taginfo, Datenstand 2026-11-20):

- 712.454.636 Gebäude-Ways.
- 25.957.949 Ways mit `height` (3,6 %).
- 43.666.262 Ways mit `building:levels` (6,1 %).

**Konsequenz:** OSM allein trägt keine glaubwürdige Schattenkarte. Der Fallback
`levels × 3,2 m + 1 m` ist dokumentiert und getestet, aber für 90 % der
Gebäude ist er eine Annahme. Deshalb:

- **Deutschland:** LoD2 (Dachform + Höhe) bzw. LoD1 (mittlere Dachhöhe) der
  Länder. NRW LoD2 sind 219,6 GB CityGML — als Rohdaten unbrauchbar für ein
  Frontend, als abgeleitete Vektorkachel mit Fußabdruck + Höhe klein.
- **Alternativ ohne Vektor:** DOM1 (85,1 GB NRW) enthält Gebäude, Brücken und
  Bewuchs bereits als Oberfläche. Ein normalisiertes DSM (DOM1 − DGM1) ist die
  direkteste Rasterquelle und braucht kein CityGML-Parsing.
- **Global:** OSM-Fußabdrücke + Höhen-Fallback, sichtbar als „geschätzt"
  kennzeichnen. Google Open Buildings 2.5D (CC BY 4.0, 4 m Höhenraster) deckt
  nur den Globalen Süden ab, nicht Europa. GlobalBuildingAtlas (3 m, RMSE
  1,5–8,9 m) ist **CC BY-NC 4.0** und damit für ein kommerzielles Produkt
  nicht verwendbar.

### 3.4 Berechnung

Verglichen wurden vier echte Verfahren, alle im POC implementiert oder
gemessen.

**(A) Vektor-Schatttenpolygone.** Fußabdruck und um `h / tan(elev)` versetzter
Fußabdruck, konvexe Hülle, ein Fill-Layer.

- Gemessen: 29.798 Gebäude → **60–92 ms**, 230.519 Stützpunkte,
  **11,5 MB GeoJSON** für 5 × 4 km.
- Qualität gegen Raster (IoU, nur Bodenpixel): **0,82** bei 31°,
  **0,74** bei 61°, **0,91** bei 23°. Der Fehler sind Innenhöfe: die Hülle
  füllt Konkavitäten.
- Kein Gelände, kein Selbstschatten, keine Dachschatten. Im Siebengebirge
  fällt die IoU auf **0,31**, weil das Gelände dominiert.
- 11,5 MB pro Pan sind als Netzlast unbrauchbar; nur sinnvoll, wenn die
  Gebäude ohnehin als Vektorkachel geladen sind.

**(B) Raster-DSM-Ray-Marching.** DSM aus DGM1 + Gebäudehöhen, Strahl zur Sonne,
Abbruch beim ersten Hindernis.

- Node, 1 Kern, 2 × 2 km: 1 m (4,0 Mio. Zellen) **2,2 s / 5,4 s / 7,3 s**
  bei 61° / 31° / 23°; 4 m (250k Zellen) **0,12 / 0,32 / 0,42 s**.
- Chrome 157, Web Worker, gleiche Maschine: 2 m (1,0 Mio.) **0,23 / 0,67 /
  0,89 s**; 4 m **24 / 87 / 109 ms**.
- Chrome, Hauptthread, CPU auf 6× gedrosselt (Mittelklasse-Handy): 2 m
  **1,43 / 3,09 / 4,42 s**; 4 m **234 / 613 / 858 ms**.
- Behandelt Gelände, Gebäude, Innenhöfe und Selbstschatten in einem Pfad.

**(C) Vorberechnete Schattenkacheln pro Zeitfenster.**

- Rechnung aus den Messwerten: NRW bei 10 m sind 341 Mio. Zellen. Bei
  2,3–10,4 Mio. Zellen/s (gemessen) sind das **33 s bis 2,5 min pro
  Zeitfenster** auf einem Kern; 60 Fenster pro Tag sind **0,5–2,5 h**. Das ist
  auf 2 vCPU machbar, aber es muss täglich neu laufen, weil die Deklination
  wandert.
- Speicher: 1 Bit pro Zelle → **42,6 MB pro Fenster**, 60 Fenster =
  **2,6 GB pro Tag** bei 10 m. Bei 4 m das 6,25-fache, also 16 GB pro Tag —
  passt nicht auf 9,9 GB frei.
- Vorteil: null Client-Compute, funktioniert auf jedem Gerät.
- Nachteil: riesiger Cache, täglicher Rebuild, keine freie Zeitwahl zwischen
  den Fenstern, keine Interaktion mit dem Zoom.

**(D) Hybrid: grober Gelände-Horizont + feines Gebäude-Raster.**

- Gelände-Horizont bei 25 m, 32 Richtungen, 2 × 2 km: **51 ms Build,
  0,04 ms Lookup**. Bei 10 m: 760 ms. Bei 50 m: 7 ms.
- Danach ist ein Zeitwechsel nur ein Vergleich pro Zelle — der Slider ist
  sofort.
- Gebäude bleiben im feinen Raster (B), weil ein Horizont bei 4 m mit 16
  Richtungen **9–12 s** kostet (gedrosselt 78 s) und damit im Browser nicht
  trägt.
- Gelände-Qualität gegen 1-m-Referenz im Siebengebirge: 10 m IoU 0,685;
  20 m 0,505; 25 m 0,443; 50 m 0,271. Für die Geländeform reicht 10–20 m,
  für die letzte Kante nicht.

### 3.5 Auslieferung

Gemessen an den POC-Bildern (voller Composite aus Gelände, Dächern und
Schatten — eine reine Schattenmaske mit flacher Farbe und Alpha ist kleiner):

| Fenster | Auflösung | PNG | WebP |
|---|---|---:|---:|
| 2 × 2 km | 1 m (2000²) | 2,0–2,2 MB | 0,39 MB |
| 2 × 2 km | 4 m (500²) | 0,19 MB | 0,05 MB |

- **Raster-Tiles** sind der richtige Auslieferweg für vorberechnete Daten:
  statisch, cachebar, CDN-fähig, kein Server-Compute.
- **Vektor** ist nur sinnvoll, wenn die Gebäude ohnehin als Kachel vorliegen;
  11,5 MB GeoJSON pro Stadtfenster sind keine Option.
- **MapLibre-Hillshade** kann die Beleuchtungsrichtung und seit GL JS 5.5 auch
  die Höhe (`hillshade-illumination-altitude`, 0–90°) nachführen. Das ist eine
  *Lokalschattierung* (Hangneigung), kein geworfener Schatten. Als billiger
  Gelände-Fallback für z<13 brauchbar, als Schattenkarte falsch.
- **Zeit-Slider:** on-demand, gedrosselt (120 ms Debounce), mit Cache pro
  (Viewport, 5-Minuten-Slot). Vorberechnete Slots nur, wenn man später einen
  „Stunden Sonne"-Layer will — der Horizont liefert das ohne zusätzliche
  Ray-Marching-Kosten.

## 4. Alternativen im Vergleich

| | A Vektor | B Raster client | C Kacheln VPS | D Hybrid |
|---|---|---|---|---|
| Gelände | nein | ja | ja | ja (25 m) |
| Innenhöfe/Selbstschatten | nein | ja | ja | ja |
| Zeitwechsel | 60 ms | 24–110 ms (4 m) | 0 ms | 24–110 ms |
| Handy (6× gedrosselt) | 60 ms | 0,23–0,86 s | 0 ms | 0,23–0,86 s |
| Daten pro Fenster | 11,5 MB GeoJSON | DSM-Kacheln | Schattenkacheln | DSM + Vektor |
| Server-Compute | nein | nein | ja, täglich | nein |
| Speicher | klein | mittel | 2,6 GB/Tag (10 m) | mittel |
| Genauigkeit | 0,74–0,91 IoU | Referenz | Referenz | ≈ Referenz |
| Aufwand | klein | mittel | groß | mittel |

**Entscheidung: D.** A ist der schnellste Einstieg und bleibt als Fallback für
Geräte ohne Worker bzw. als Sofort-Vorschau beim Ziehen. C lohnt nur für einen
späteren „Sonnenstunden"-Layer bei niedrigem Zoom. B allein ist richtig, aber
ohne groben Gelände-Horizont wird jeder Zeitwechsel neu gerechnet; D macht den
Slider gratis.

## 5. Architektur der Empfehlung

```
                       ┌──────────────────────────────┐
  LoD2 / LoD1 / OSM ──▶│ Build-Pipeline (offline)     │
  DGM1 / DOM1      ──▶│  → Vektor-Kacheln mit Höhe   │──▶ Object Storage / CDN
                       │  → Terrain-Kacheln (raster)  │
                       └──────────────────────────────┘
                                     │ statisch, cachebar
                                     ▼
  Browser: MapLibre ──▶ Web Worker ──▶ DSM (4 m / 2 m / 1 m)
                                     ├─ Gebäude rastern
                                     ├─ Gelände-Horizont (25 m, 32 Richtungen)
                                     └─ Ray-March zur Sonne
                                     ▼
                              Fill-/Raster-Layer
```

**Warum der VPS nicht rechnet:** Ein 2 × 2 km Fenster bei 4 m sind 250k Zellen;
das sind 24–110 ms auf einem Desktop-Kern und 0,23–0,86 s auf einem gedrosselten
Handy. Eine Anfrage pro Nutzer und Zeitwechsel wäre auf 2 vCPU teurer als die
Kachelauslieferung und würde bei jedem Pan neu rechnen. Der VPS baut die Daten
einmal und liefert sie statisch.

**Datenmengen (Arithmetik aus den Messwerten, keine Marktforschung):**

- NRW bei 4 m: 34.112 km² × 62.500 Zellen/km² = 2,13 Mrd. Zellen →
  4,3 GB als int16-Rohraster, mit WebP-Kompression deutlich weniger.
- NRW bei 2 m: 8,53 Mrd. Zellen → 17,1 GB roh.
- Deutschland bei 4 m: 357.596 km² → 22,4 Mrd. Zellen → 44,7 GB roh.
  Passt **nicht** auf die 9,9 GB freien VPS-Platte.
- Deshalb: NRW als erster Datenraum (passt), Deutschland über Vektor-Kacheln
  mit Höhe (viel kleiner) plus öffentliche Terrain-Kacheln, global über
  OSM + Copernicus/Terrain Tiles.

## 6. POC-Messprotokoll

Aufbau: 5 × 4 km Arbeitsgebiet, 2 × 2 km Ausgabefenster, DGM1 1 m als
Gelände, OSM-Fußabdrücke mit Höhen-Fallback, Ray-March im DSM.

| Messung | Wert |
|---|---|
| DGM1-Kacheln geladen | 20 (35,4 MB), Median 163 ms/Kachel |
| GeoTIFF dekodieren + mosaikieren | 2,3 s (20 Mio. Zellen) |
| OSM Overpass 5 × 4 km | 29.798 Gebäude, 28,5 MB JSON, 40,3 s |
| Gebäude rastern (1 m) | 91 ms |
| Schatten 1 m, 4,0 Mio. Zellen | 2,2 s / 5,4 s / 7,3 s (61° / 31° / 23°) |
| Schatten 4 m, 250k Zellen | 0,12 / 0,32 / 0,42 s |
| Vektor-Polygone | 60–92 ms, 11,5 MB GeoJSON |
| IoU Vektor vs. Raster | 0,82 / 0,74 / 0,91 |
| Bild 1 m PNG / WebP | 2,0–2,2 MB / 0,39 MB |
| Bild 4 m PNG / WebP | 0,19 MB / 0,05 MB |
| Browser-Worker 2 m, 1,0 Mio. | 0,23 / 0,67 / 0,89 s |
| Browser-Worker 4 m, 250k | 24 / 87 / 109 ms |
| Hauptthread 6× gedrosselt, 4 m | 234 / 613 / 858 ms |
| Gelände-Horizont 25 m, 32 Richtungen | 51 ms Build, 0,04 ms Lookup |
| Gelände-Horizont 4 m, 16 Richtungen | 9,0–12,0 s (gedrosselt 78 s) — verworfen |

Belege: `docs/spikes/shadow-map-duesseldorf.jpg`,
`docs/spikes/shadow-map-siebengebirge.jpg`,
`docs/spikes/shadow-map-vector-vs-raster.jpg`,
Protokoll: `docs/spikes/2026-11-21-shadow-map-poc.md`.

**Visuelle Prüfung:** Düsseldorf zeigt bei 09:00 Schatten nach Westen, bei
13:00 kurze Schatten nach Nordnordwest, bei 19:00 lange Schatten nach Osten.
Das Siebengebirge zeigt bei 08:00 die Westhänge im Schatten, bei 13:00 fast
nichts, bei 18:00 die Osthänge. Die Rheinaue bleibt flach und schattenarm —
konsistent mit 16,5 m Geländespanne im Düsseldorfer Fenster.

## 7. Integration

Das Modul liegt self-contained unter `src/lib/shadow/**` und importiert nichts
aus `src/lib/overlays/**`. Der Andockpunkt ist `src/lib/shadow/overlay.ts`:

```ts
import { registerOverlay } from "@/lib/overlays";
import { shadowOverlayDefinition } from "@/lib/shadow/overlay";

registerOverlay(shadowOverlayDefinition());
```

`shadowOverlayDefinition()` ist strukturell kompatibel zu `OverlayDefinition`
(`id`, `label`, `group: "nature"`, `kind: "geojson" | "raster"`,
`attribution`, `opacity`, `minzoom`, `timeAware`, `order`, `resolve`). Die
Daten kommen aus `setShadowOverlayData(geojson)` bzw.
`setShadowOverlayTiles(urls)`; das Panel schreibt nur in diesen kleinen Store.
Damit braucht es **keine** Änderung an `BiospherePanel.tsx` oder an den
Registry-Dateien — nur den einen `registerOverlay`-Aufruf und später ein
Zeit-Bedienelement.

API:

```ts
computeShadowLayer({ bbox, time, mode: "raster", resolutionM: 4, buildings, terrain })
  → { sun, mask, stats }

computeShadowLayer({ bbox, time, mode: "vector", buildings })
  → { sun, geojson, stats }
```

Reine Funktionen ohne DOM, ohne Netz, ohne Uhr — lauffähig im Worker, in Tests
und auf einem Build-Server.

## 8. Umsetzungsplan

### Phase 0 — Datenvertrag (1–2 Tage)

- `ShadowSource`-Metadaten pro Bundesland (Lizenz, Attribution, Kachelschema,
  Auflösung). Drei Länder sind verifiziert (NRW, BW, Bayern); die übrigen 13
  brauchen eine Prüfliste, keine Annahme.
- Lizenztexte als Pflichtfeld in die Kachel-Metadaten, damit das Panel die
  richtige Zeile zeigt (NRW: keine Pflicht; BW/BY: exakter Wortlaut).

### Phase 1 — NRW-Pipeline (3–5 Tage)

1. Verzeichnis-JSON je Produkt laden, Kachelnamen mit Jahr übernehmen.
2. DGM1 + DOM1 (oder LoD1) je 1-km-Kachel zu normalisiertem DSM verrechnen:
   `dsm = DOM1`, `dtm = DGM1`, `height = max(0, dsm − dtm)`.
3. DSM auf 4 m mitteln (Mittelwert, nicht Punktabtastung — Punktabtastung
   verliert Kanten, siehe Gelände-Messung), als int16 mit 0,1 m Auflösung
   speichern; Terrain separat bei 25 m für den Horizont.
4. Gebäude aus LoD1/LoD2 als Vektorkachel (Fußabdruck + `height`, `min_height`)
   für z13–z16; OSM nur als Lückenfüller.
5. Qualitätscheck: Stichprobe gegen Orthofoto, Schattenlänge bei bekannter
   Sonnenhöhe, Plausibilität der Höhen (Ausreißer > 300 m verwerfen).

### Phase 2 — Client-Layer (3–5 Tage)

1. Worker: DSM-Kacheln laden (MapLibre `raster-dem`-Format oder eigenes
   int16-Format), Gebäude-Vektorkacheln rastern, Ray-March.
2. Auflösung nach Zoom (`resolutionForZoom`), harte Zellgrenze
   (`MAX_RASTER_CELLS = 16 Mio.`).
3. Zeit-Slider: Debounce 120 ms, letzte Maske stehen lassen, während die neue
   rechnet; Cache pro (Viewport, 5 min).
4. Gelände-Horizont (25 m, 32 Richtungen) einmal pro Viewport; danach nur
   Vergleiche.
5. Dämmerung: unter 0° ausblenden, 0–3° mit reduzierter Deckkraft.
6. Weiche Kanten: 1-Zellen-Box-Blur kostet nichts und entspricht der
   Penumbra (bei 500 m Entfernung ~4,6 m durch die 0,53° Sonnenscheibe).

### Phase 3 — Deutschland (1–2 Wochen)

- Pro Bundesland: Quelle, Lizenz, Kachelschema, Attributionspflicht.
- Vektor-Kacheln statt DSM bevorzugen, weil sie um Größenordnungen kleiner
  sind und die Höhe direkt mitbringen.
- Fallback-Kaskade: LoD2 → LoD1 → OSM `height` → OSM `levels` → 10 m, mit
  `estimated: true` im Feature.

### Phase 4 — Europa / global (offen)

- Terrain: Copernicus GLO-30 (frei) oder Mapzen Terrain Tiles (EU-DEM 25 m).
- Gebäude: OSM + Fallback; in Ländern mit offenen 3D-Modellen (NL, CH, AT,
  Nordics) deren Daten.
- Kennzeichnung „geschätzt" ist Pflicht, sobald der Höhen-Fallback greift.

### Betrieb auf dem VPS

- Caddy liefert die Kacheln statisch aus; `Cache-Control: public, max-age=
  31536000, immutable` für Jahres-Kacheln, kurze TTL für Zeit-Slots.
- Build läuft als nächtlicher Job (systemd timer), nicht im Webserver.
- RAM: eine 1-km-Kachel DGM1 + DOM1 sind ~4 MB float32; mit 4 parallelen
  Workern < 200 MB. Der 4-GB-VPS reicht für den Build, wenn kachelweise
  gearbeitet wird und nicht die ganze Stadt gleichzeitig im Speicher liegt.
- Monitoring: Kachelgröße, Decode-Fehler, 404-Rate.

## 9. Risiken und offene Punkte

1. **OSM-Höhen fehlen** (gemessen 89,9 %). Ohne LoD2/LoD1 ist die Karte eine
   Schätzung. Muss im UI stehen.
2. **LoD2 ist nicht überall offen.** Drei Länder sind verifiziert; die anderen
   brauchen eine Prüfung. Keine pauschale Aussage „alle 16 Länder".
3. **DOM1 enthält Bewuchs.** Im Winter (Laub ab) ist das DSM zu hoch; die
   Schatten sind dann zu lang. Entweder LoD2 (nur Gebäude) oder einen
   Vegetationszuschlag getrennt führen.
4. **Gelände unter 25 m** verliert Kanten (IoU 0,44 gegenüber 1 m). Für
   Mittelgebirge sichtbar, für die norddeutsche Tiefebene irrelevant.
5. **Handy-Thermik.** 2 m ist gedrosselt 1,4–4,4 s; 4 m ist der Default, 1 m
   nur auf ausdrücklichen Zoom und nach Leerlauf.
6. **Speicher.** Deutschland bei 4 m sind 44,7 GB roh — nicht auf dem VPS.
   Vektor-Kacheln oder Object Storage einplanen.
7. **Lizenz-Share-Alike.** ODbL verlangt Share-Alike für abgeleitete
   *Datenbanken*. Ein gerendertes Schattenbild ist ein Produced Work; wer
   jedoch die Gebäude-Vektorkacheln weiterverbreitet, muss die ODbL-Bedingungen
   einhalten. NRW Zero hat dieses Problem nicht.
8. **Keine photogrammetrische Validierung.** Die Plausibilität ist visuell und
   geometrisch geprüft, nicht gegen Luftbilder. Ein Abgleich mit einem
   Orthofoto an einem wolkenlosen Tag wäre der nächste Beleg.
9. **Zeit vor 2011 / nach 2100.** NOAA ist laut Dokumentation außerhalb
   1800–2100 ungenauer. Für eine Karte irrelevant, für eine Historienfunktion
   nicht.

## 10. Quellen

- Reda, I.; Andreas, A.: *Solar Position Algorithm for Solar Radiation
  Applications*. NREL/TP-560-34302, Revised 2008.
  https://www.nrel.gov/docs/fy08osti/34302.pdf
- NOAA Global Monitoring Laboratory: *Solar Calculation Details*.
  https://gml.noaa.gov/grad/solcalc/calcdetails.html
- Geobasis NRW: *Digitales Geländemodell*.
  https://www.bezreg-koeln.nrw.de/geobasis-nrw/produkte-und-dienste/hoehenmodelle/digitale-gelaendemodelle/digitales-gelaendemodell
- OpenGeodata NRW, DGM1/DOM1/LoD1/LoD2-Verzeichnisse.
  https://www.opengeodata.nrw.de/produkte/geobasis/
- Open.NRW Datensatz DGM1 (Lizenz dl-de/zero-2-0).
  https://open.nrw/dataset/0c6796e5-9eca-4ae6-8b32-1fcc5ae5c481
- LGL Baden-Württemberg: *Open GeoData Portal*.
  https://opengeodata.lgl-bw.de/
- Bayerische Vermessungsverwaltung: *OpenData*.
  https://geodaten.bayern.de/opengeodata/
- Copernicus DEM.
  https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
- Mapzen Terrain Tiles, Registry of Open Data on AWS.
  https://registry.opendata.aws/terrain-tiles/
- Mapzen/Joerd Attributions.
  https://github.com/tilezen/joerd/blob/master/docs/attribution.md
- OpenStreetMap Taginfo, `building`, `height`, `building:levels`, Datenstand
  2026-11-20. https://taginfo.openstreetmap.org/
- MapLibre Style Spec, Hillshade (`hillshade-illumination-altitude`).
  https://maplibre.org/maplibre-style-spec/layers/
- Zhu, X. X. et al.: *GlobalBuildingAtlas*. ESSD 17, 6647 (2025).
  https://essd.copernicus.org/articles/17/6647/2025/
- Google Research: *Open Buildings 2.5D Temporal*.
  https://sites.research.google/gr/open-buildings/temporal/
- ShadeMap (Referenzimplementierung, clientseitiges Ray-Tracing).
  https://shademap.app/help/
