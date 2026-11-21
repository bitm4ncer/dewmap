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
- **Daten** kommen als **Vektor-Kacheln mit Höhe** (LoD2/LoD1, OSM als
  Fallback) plus **Terrain-Kacheln 25 m**. Es gibt **kein** vorproduziertes
  DSM: der Worker rastert die Vektoren bei Bedarf selbst. Der VPS baut und
  liefert nur statische Kacheln; er rechnet nicht pro Anfrage.
- **Auflösung nach Zoom**: 8 m bei z14, 4 m bei z15, 2 m bei z16, 1 m ab z17.
  Unter z14 wird die Ebene ausgeblendet, weil Schatten dort subpixelgroß sind.
- **Zeit-Slider**: der Gebäude-Ray-March läuft bei jedem Zeitwechsel neu
  (36–109 ms bei 4 m auf dem Desktop). Der grobe Gelände-Horizont ist der
  Beschleuniger für Gelände, nicht für Gebäude.

Damit liegt die Interaktion bei **36–109 ms** pro Zeitwechsel auf dem Desktop
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
  bei 61° / 31° / 23°; 4 m Ausgabe mit 1-m-Schritten (250k Zellen)
  **0,12 / 0,32 / 0,42 s**. Der POC-Schritt war 1 m auf einem 1-m-DSM,
  unabhängig von der Ausgabezelle.
- Chrome 157, Web Worker, gleiche Maschine: 2 m (1,0 Mio.) **0,23 / 0,67 /
  0,89 s**; 4 m **36 / 87 / 109 ms**.
- Chrome, Hauptthread, CPU auf 6× gedrosselt (Mittelklasse-Handy): 2 m
  **1,43 / 3,09 / 4,42 s**; 4 m **234 / 613 / 858 ms**.
- Behandelt Gelände, Gebäude, Innenhöfe und Selbstschatten in einem Pfad.

**(C) Vorberechnete Schattenkacheln pro Zeitfenster.**

- Rechnung aus den Messwerten: NRW bei 10 m sind 341 Mio. Zellen. Im
  Browser-Worker laufen 2,3–10,4 Mio. Zellen/s, in Node (dem VPS-Maßstab)
  0,55–2,1 Mio./s. Auf dem VPS sind das **2,7–10,3 min pro Zeitfenster** auf
  einem Kern; 60 Fenster pro Tag sind **2,7–10,3 h**. Das ist auf 2 vCPU
  machbar, aber es muss täglich neu laufen, weil die Deklination wandert.
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

**(E) Lazy gerechnete, gecachte Server-Kachel.** Kachel wird beim ersten
Abruf gerendert und danach statisch ausgeliefert (CDN davor).

- Rechnung aus den eigenen Messwerten: 0,12–0,42 s pro 2 × 2 km bei 4 m auf
  **einem** Kern (mit 1-m-Schritten gerechnet, also konservativ; mit
  4-m-Schritten wäre es 3–4× schneller). Eine 2,5-km-Kachel hat ~0,4 Mio.
  Zellen, also **0,2–0,7 s** Rechenzeit plus Netz.
- Vorteil: funktioniert auf **jedem** Endgerät, ohne Vektor-/Terrain-Download,
  ohne Worker, ohne 4 GB RAM. Das ist der einzige Ansatz, der auch bei
  Low-End-Hardware und ohne JavaScript trägt.
- Nachteil 1 — Cache-Key enthält die Zeit. Ein Slider erzeugt viele Varianten;
  bei 15-Minuten-Quantisierung sind es 60 Slots pro Tag und Kachel. Die
  Trefferquote ist nur in populären Gebieten hoch, der Long Tail ist kalt.
- Nachteil 2 — Kapazität. 2 vCPU × 1/0,4 s ≈ **2,9–10 Kacheln/s** kalt. Ein
  Viewport braucht 6–12 Kacheln, also **1–3 s** für einen kalten Viewport;
  zwei bis drei gleichzeitige Nutzer sättigen den Server.
- Nachteil 3 — kein Offline, kein sofortiges Pan, jeder Zeitschritt ist eine
  Netzrunde.
- **Wann sie erste Wahl wäre:** wenn das Produkt auf Geräten ohne Worker/ohne
  GPU laufen muss, wenn serverseitig gerendert wird (Screenshot, Print, SSR)
  oder wenn ein CDN mit Request-Collapsing und vorerwärmten populären Kacheln
  vorhanden ist. Für Deutschland/global mit langem Tail ist sie der Fallback,
  nicht der Default.

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

| | A Vektor | B Raster client | C Kacheln VPS | D Hybrid | E lazy Kachel |
|---|---|---|---|---|---|
| Gelände | nein | ja | ja | ja (25 m) | ja |
| Innenhöfe/Selbstschatten | nein | ja | ja | ja | ja |
| Zeitwechsel | 60 ms | 36–109 ms (4 m) | 0 ms (Cache) | 36–109 ms | 0,2–0,7 s + Netz |
| Handy (6× gedrosselt) | 60 ms | 0,23–0,86 s | 0 ms | 0,23–0,86 s | 0 ms Client |
| Daten pro Fenster | 11,5 MB GeoJSON | Vektor + Terrain | Schattenkacheln | Vektor + Terrain | keine |
| Server-Compute | nein | nein | ja, täglich | nein | ja, pro kalter Kachel |
| Speicher | klein | klein | 2,6 GB/Tag (10 m) | klein | Cache, wächst mit Nutzung |
| Genauigkeit | 0,74–0,91 IoU | Referenz | Referenz | ≈ Referenz | Referenz |
| Aufwand | klein | mittel | groß | mittel | mittel |

**Entscheidung: D.** A ist der schnellste Einstieg und bleibt als Fallback für
Geräte ohne Worker bzw. als Sofort-Vorschau beim Ziehen. C lohnt nur für einen
späteren „Sonnenstunden"-Layer bei niedrigem Zoom. E ist der richtige Fallback
für Low-End-Geräte, SSR/Screenshot und vorerwärmte Gebiete, aber auf 2 vCPU
kein Default. B allein ist richtig, aber ohne groben Gelände-Horizont wird
jeder Zeitwechsel neu gerechnet; D macht den Gelände-Teil gratis.

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
das sind 36–109 ms auf einem Desktop-Kern und 0,23–0,86 s auf einem gedrosselten
Handy. Eine Anfrage pro Nutzer und Zeitwechsel wäre auf 2 vCPU teurer als die
Kachelauslieferung und würde bei jedem Pan neu rechnen. Der VPS baut die Daten
einmal und liefert sie statisch.

**Ein Artefakt, nicht zwei.** Phase 1 erzeugt **nur Vektor-Kacheln mit Höhe**
plus **Terrain-Kacheln 25 m**. Ein vorproduziertes DSM entfällt: der Worker
rastet die Vektoren bei Bedarf. Damit gibt es keine zwei Quellen für dieselben
Gebäude und keine 4,3-GB-Datei, die die Empfehlung selbst überflüssig macht.
Ein Vegetations-DSM aus DOM1 (Bäume, Brücken) bleibt eine **optionale zweite
Ausbaustufe**, weil DOM1 der einzige Weg zu Baumschatten ist; es wird dann
getrennt gebaut und nur für Gebiete mit DOM1 ausgeliefert.

**Datenmengen (gemessen, keine Marktforschung):**

- Düsseldorf 5 × 4 km, 31.133 Gebäude, 277.977 Stützpunkte: 8,55 MB GeoJSON,
  **1,29 MB gzip** → 64 KB gzip/km², 4,63 Byte pro Stützpunkt.
- MVT ist binär (Varint-Deltas, keine wiederholten Keys) und liegt unter dem
  gzip-GeJSON-Wert; wir nehmen gzip-GeJSON als **Obergrenze**.
- NRW bei Düsseldorfer Dichte (Obergrenze): 34.112 km² × 64 KB ≈ **2,2 GB pro
  Zoomstufe**; mit z15/z16-Wiederholung Faktor 1,5–2,5 → **3–5 GB Obergrenze**.
  Die Landesdurchschnittsdichte liegt deutlich darunter.
- Terrain 25 m NRW: 34.112 km² × 1.600 Zellen/km² × 2 B = **109 MB roh**,
  komprimiert 50–80 MB.
- Deutschland bei Düsseldorfer Dichte: Faktor 10,5 → 23–52 GB Obergrenze. Real
  weniger, aber **nicht auf 9,9 GB**. Deshalb Object Storage oder eine
  bundesweite Verdichtung (nur Gebäude ab einer Grundfläche, z14–z16).
- Global: OSM + Copernicus/Terrain Tiles, Vektor-Kacheln nur für Gebiete mit
  brauchbaren Höhen; alles andere wird als „geschätzt" gekennzeichnet.

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
| Schatten 4 m Ausgabe, 1-m-Schritte, 250k | 0,12 / 0,32 / 0,42 s |
| Vektor-Polygone | 60–92 ms, 11,5 MB GeoJSON |
| IoU Vektor vs. Raster | 0,82 / 0,74 / 0,91 |
| Bild 1 m PNG / WebP | 2,0–2,2 MB / 0,39 MB |
| Bild 4 m PNG / WebP | 0,19 MB / 0,05 MB |
| Browser-Worker 2 m, 1,0 Mio. | 0,23 / 0,67 / 0,89 s |
| Browser-Worker 4 m, 4-m-Schritte, 250k | 36 / 87 / 109 ms |
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
(`id`, `label`, `group: "nature"`, `kind`, `attribution`, `opacity`, `minzoom`,
`timeAware`, `order`, `resolve`). Daten kommen aus
`setShadowOverlayData(geojson)` bzw. `setShadowOverlayTiles(urls)`.

**Der Re-Render-Trigger.** `useOverlayLayers` memoisiert auf
`[enabled, opacity, radarFrames, radarIndex, warnings]`. Ein Worker-Ergebnis
ändert keine dieser Größen, also reicht ein Modulobjekt allein **nicht**. Der
Store führt deshalb eine monotone `version`, die bei jedem Datenwechsel
hochzählt; `subscribeShadowData`/`getShadowVersion` sind
`useSyncExternalStore`-konform. Der exakte Eingriff in B2s Hook (zwei Zeilen,
keine Datei wird hier geändert):

```ts
const shadowVersion = useShadowOverlayVersion();   // neu, aus @/lib/shadow/useShadowOverlay
// ...
}, [enabled, opacity, radarFrames, radarIndex, warnings, shadowVersion]);  // Dep ergänzen
```

Für Nicht-React-Code gibt es den imperativen Weg:
`applyShadowLayer(map, result)` in `layer.ts` setzt die Quelle sofort.

API:

```ts
computeShadowLayer({ bbox, time, mode: "raster", resolutionM: 4, buildings, terrain })
  → { sun, mask, stats }

computeShadowLayer({ bbox, time, mode: "vector", buildings })
  → { sun, geojson, stats }
```

Reine Rechenfunktionen ohne DOM und ohne Netz. `stats.computeMs` kommt aus
`performance.now()` und ist damit nicht reproduzierbar; alles andere ist es.

## 8. Umsetzungsplan

### Phase 0 — Datenvertrag (1–2 Tage)

- `ShadowSource`-Metadaten pro Bundesland (Lizenz, Attribution, Kachelschema,
  Auflösung). Drei Länder sind verifiziert (NRW, BW, Bayern); die übrigen 13
  brauchen eine Prüfliste, keine Annahme.
- Lizenztexte als Pflichtfeld in die Kachel-Metadaten, damit das Panel die
  richtige Zeile zeigt (NRW: keine Pflicht; BW/BY: exakter Wortlaut).

### Phase 1 — NRW-Pipeline (3–5 Tage)

1. Verzeichnis-JSON je Produkt laden, Kachelnamen mit Jahr übernehmen (das
   Jahr ist je Kachel verschieden: Düsseldorf 2022, Siebengebirge 2021).
2. **Streaming, nicht Sammeln.** Die Quellen sind 78,8 GB DGM1 + 91,8 GB LoD1
   = 170,6 GB, die Zielplatte hat 9,9 GB frei. Verarbeitet wird immer genau
   ein Kachelpaar:
   - Kachelpaar laden (2 × ~2,2–2,6 MB), im Speicher halten, verarbeiten,
   - Quelldatei sofort löschen,
   - Fortschritt in einer `progress.json` (Kachel-ID, Zeitstempel, Prüfsumme)
     markieren, damit ein Abbruch wiederaufsetzbar ist.
   Spitzenbedarf: zwei Kacheln + Puffer < 50 MB. Kein `rsync` des ganzen
   Bestands, kein „erst alles herunterladen".
3. **Terrain 25 m** aus DGM1: pro 1-km-Kachel auf 40 × 40 mitteln, in globale
   25-m-Kacheln schreiben (109 MB roh für NRW).
4. **Gebäude aus LoD1** (nicht LoD2) als Vektorkachel: Fußabdruck + mittlere
   Dachhöhe + `min_height` für z13–z16. LoD1 reicht bei 4 m Raster; LoD2
   (219,6 GB, Dachformen 1–3 m) bringt erst bei 1 m einen sichtbaren
   Unterschied und ist eine spätere Option. OSM nur als Lückenfüller.
5. **Runtime-Rechnung** aus den Messwerten: 35.860 DGM1-Kacheln × (163 ms
   Download + ~115 ms Dekodieren) ≈ 2,8 h; 35.022 LoD1-Kacheln (91,8 GB) bei
   ~11 MB/s ≈ 2,3 h plus CityGML-Parsing. Ein Kern: **6–8 h**, mit zwei
   Workern **3–5 h**. Das ist ein nächtlicher Job, kein Dauerbetrieb.
6. Qualitätscheck: Stichprobe gegen Orthofoto, Schattenlänge bei bekannter
   Sonnenhöhe, Plausibilität der Höhen (Ausreißer > 300 m verwerfen,
   `min_height > height` korrigieren).
7. **Kein DSM-Artefakt in Phase 1.** Der Worker rastert die Vektoren. DOM1
   (85,1 GB) wird nur geladen, wenn später Baumschatten dazukommen; dann als
   eigenes, optionales 4-m-DSM (4,3 GB NRW), nicht als Voraussetzung.

### Phase 2 — Client-Layer (3–5 Tage)

1. Worker: Gebäude-Vektorkacheln laden und rastern, Terrain 25 m laden,
   DSM bauen, Ray-March.
2. Auflösung nach Zoom (`resolutionForZoom`: 8/4/2/1 m), harte Zellgrenze
   (`MAX_RASTER_CELLS = 16 Mio.`).
3. Zeit-Slider: Debounce 120 ms, letzte Maske stehen lassen, während die neue
   rechnet; Cache pro (Viewport, 5 min).
4. Gelände-Horizont (25 m, 32 Richtungen) einmal pro Viewport; danach nur
   Vergleiche. Die Gebäude bleiben pro Zeitwechsel im Ray-March.
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
6. **Speicher.** Deutschland als Vektor-Kacheln liegt bei Düsseldorfer Dichte
   in der Obergrenze bei 23–52 GB, nicht auf den 9,9 GB. NRW passt
   (3–5 GB Obergrenze + 0,1 GB Terrain). Für Deutschland Object Storage oder
   eine Verdichtung einplanen; die tatsächliche Kachelgröße in Phase 1 messen.
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
10. **Handy-Beweis fehlt.** `Emulation.setCPUThrottlingRate` wirkt nicht auf
    Worker. Die 0,23–0,86 s sind vom gedrosselten Hauptthread extrapoliert;
    bei 1 m (z17) sind es auf dem Desktop 2,2–7,3 s, auf dem Handy
    realistisch mehr. Vor dem Produktivsetzen ein echtes Gerät messen.
11. **Ray-Marching-Alias.** Ein Schritt pro Zelle trifft dünne Okkluder
    diagonal nicht immer (IoU 0,90 gegen eine dichte Referenz bei
    Schrittweite 1). Bei 4 m Ausgabe ist das geglättet; wer 1 m genau braucht,
    nimmt einen DDA oder Schrittweite < Zelle.

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

## 11. Fix-Runde 2026-11-21 (Review I-1 bis I-5)

Unabhängiges Review: `needs work` bei zwei Important-Befunden. Beide sind
behoben, dazu die Datenartefakt-Entscheidung und die globale Kachelrechnung.

**I-1 — `stepM` war ein Zellen- statt Meter-Schritt.** In
`castShadowMask` kürzte sich `distance * invStep` zu `s`, der Strahl rückte
eine Zelle vor, während die Höhe mit `s * stepM` rechnete. Bei `stepM = 2`
und 1-m-Zellen war die Wandschattenlänge halbiert (17 m statt 34,6 m). Fix:
`Math.floor(col + (ux * distance) / resolutionM)`, analog `sy`. Neuer Test
misst die Schattenlänge einer 20-m-Wand bei 30° für `stepM` 0,5 / 1 / 2 und
fordert 33–36 m (Soll 34,6 m). Die Option ist jetzt dokumentiert als
„Schritt in Metern, ≤ Zellenweite".

**I-2 — Andockpunkt ohne Re-Render.** Der Store führt eine monotone
`version`; `subscribeShadowData` / `getShadowVersion` /
`getShadowOverlaySnapshot` sind `useSyncExternalStore`-konform, und
`resolve()` liest den Store bei jedem Aufruf. B2s `useOverlayLayers` braucht
genau zwei Zeilen (Hook + Dependency, §7). Test: Datenwechsel erhöht die
Version, benachrichtigt Abonnenten und liefert ein neues `source.data`-Objekt.

**I-5 — Antimeridian und Pole.** `localFrame` klemmt die Breite auf
±85,051°, rechnet Längengrade modulo 360 und trägt eine Bbox über den
Antimeridian; `bboxSpanM` misst den kurzen Weg und lehnt Bboxen > 180° mit
`RangeError` ab; `tilesForBbox` läuft bei `west > east` einmal um die Welt
und wiederholt am Weltrand nicht die erste Spalte. Tests: Bbox
`[179.9, -1, -179.9, 1]` → 4 Kacheln, x ∈ {0, 31}; Welt-Bbox z2 → 16
Kacheln, x ∈ {0,1,2,3}; Frame-Roundtrip über den Antimeridian.

**I-4 — ein Artefakt.** Phase 1 erzeugt nur Vektor-Kacheln mit Höhe plus
25-m-Terrain. Das DSM entsteht im Worker; DOM1 ist eine optionale spätere
Vegetationsstufe. Die Storage-Rechnung steht in §5 und stützt sich nicht mehr
auf ein 4,3-GB-DSM.

**I-3 — NRW-Build gestreamt.** 170,6 GB Input (DGM1 78,8 + LoD1 91,8) gegen
9,9 GB frei: ein Kachelpaar im Speicher (< 50 MB Spitze), Quelle nach der
Verarbeitung löschen, Fortschritt in `progress.json`. 6–8 h auf einem Kern,
3–5 h mit zwei Workern.

**Variante E (lazy gecachte Server-Kachel)** ist in §3.4 bewertet: 0,2–0,7 s
pro 2,5-km-Kachel, 2,9–10 Kacheln/s auf 2 vCPU, Cache-Key mit Zeit. Sie ist
der Fallback für Low-End/SSR/vorerwärmte Gebiete, nicht der Default.

**Mitgenommene Minor-Punkte:** Zoom-Tabelle (8 m bei z14) korrigiert,
4-m-Worker-Wert auf 36 ms vereinheitlicht, Variante-C-Durchsatz auf
Node-Raten umgestellt, Attributionszeile aus `SHADOW_SOURCES`, `kind` folgt
dem aktiven Quelltyp, Vektor-/Raster-Legende ergänzt, Gelände-Test prüft
jetzt die Wirkung statt nur die Existenz.

**Bewusst offen:** Nodata-Füllung (`M-2`), zellenweite `maxHeight`-Schranke
(`M-3`), exakte Rasterzellgröße (`M-10`), Dachform im Typ (`M-11`),
`performance.now()` in `computeShadowLayer` (`M-12`). Sie ändern die
Empfehlung nicht und gehören in die Phase-1-Härtung.
