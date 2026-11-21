# Spike: Schattenkarte — POC und Messprotokoll

Datum: 2026-11-21 · Status: Spike, nicht produktiv · Branch: `feat/shadow-map`

Begleitdokument zu
`docs/superpowers/specs/2026-11-21-shadow-map-design.md`.

## Ziel

Belegen, dass eine Schattenkarte aus DGM1 + Gebäudehöhen auf einem normalen
Rechner und im Browser schnell genug ist, und messen, was sie kostet. Kein
Produktivcode; die Rechenfunktionen sind inzwischen als Modul unter
`src/lib/shadow/**` portiert und getestet.

## Testgebiete

| Gebiet | Fenster (UTM32) | Ausdehnung | Gelände |
|---|---|---|---|
| Düsseldorf Altstadt/Carlstadt | E 343.700–345.700, N 5.676.000–5.678.000 | 2 × 2 km | 28,1–44,6 m (16,5 m Spanne) |
| Siebengebirge (Drachenfels) | E 372.200–374.200, N 5.613.100–5.615.100 | 2 × 2 km | 46,8–323,5 m (276,8 m Spanne) |

## Daten

- Gelände: Geobasis NRW DGM1, 1 m, GeoTIFF, 1-km-Kacheln.
  - Düsseldorf: 20 Kacheln (5 × 4 km), 35,4 MB.
  - Siebengebirge: 16 Kacheln (4 × 4 km), 39,2 MB.
  - Download Median 163 ms/Kachel; Dekodieren + Mosaik 2,3 s / 2,9 s.
- Gebäude: OpenStreetMap via Overpass, `way["building"]` + `out geom`.
  - Düsseldorf 5 × 4 km: 31.133 Gebäude im Overpass-Fenster (20,1 km²), davon
    29.798 im 5 × 4 km Mosaik; 28,5 MB JSON, **40,3 s**. Der POC rendert die
    29.798, die Storage-Rechnung nutzt die 31.133 (größere Fläche).
  - Siebengebirge 4 × 4 km: 8.181 Gebäude, 6,9 MB JSON, **33,0 s**.
- Höhen: `height`, sonst `building:levels × 3,2 + 1`, sonst 10 m.

## Verfahren

1. Mosaik der 1-m-DGM1-Kacheln (Float32, 20 Mio. Zellen).
2. Gebäude-Fußabdrücke nach UTM32 projiziert, Scanline-Rasterisierung,
   Maximum bei Überlappung.
3. DSM = DGM1 + Gebäudehöhe.
4. Ray-March pro Zelle zur Sonne, Abbruch beim ersten Hindernis:
   `dsm[q] > dsm[p] + d·tan(elev) + 0,35`.
5. Zweiter Pfad: konvexe Hülle aus Fußabdruck und versetztem Fußabdruck
   (Vektor), zum Vergleich.
6. Ausgabe: Gelände-Hillshade, Dächer, Schatten, 2.000² px, PNG/WebP.

Sonne: NOAA/Meeus, validiert gegen NREL SPA (siehe Design-Dokument, 8,4″).

## Messwerte

### Rechenzeit (Node 26, ein Kern, ohne WASM)

| Auflösung | Zellen | 13:00 (61,4°) | 09:00 (31,3°) | 19:00 (23,4°) |
|---|---:|---:|---:|---:|
| 1 m | 4.000.000 | 2,2 s | 5,4 s | 7,3 s |
| 4 m Ausgabe, 1-m-Schritte | 250.000 | 0,12 s | 0,32 s | 0,42 s |

Die Node-Läufe benutzen 1-m-Schritte auf dem 1-m-DSM, unabhängig von der
Ausgabezelle. Die Zeit hängt fast linear an `Höhe / tan(Elevation)`.

### Browser (Chrome 157, gleiche Maschine)

| Pfad | Auflösung | 13:00 | 09:00 | 19:00 |
|---|---|---:|---:|---:|
| Web Worker | 2 m, 1,0 Mio. | 229 ms | 665 ms | 888 ms |
| Web Worker | 4 m, 250k | 36 ms | 87 ms | 109 ms |
| Hauptthread, CPU 6× gedrosselt | 2 m | 1.427 ms | 3.093 ms | 4.422 ms |
| Hauptthread, CPU 6× gedrosselt | 4 m | 234 ms | 613 ms | 858 ms |

Die Browser-Läufe benutzen `stepM = resolutionM` (2 m bzw. 4 m), also den
Modul-Default; die 36 ms bei 4 m sind deshalb nicht mit den Node-4-m-Werten
(1-m-Schritte) zu vergleichen. `Emulation.setCPUThrottlingRate` wirkt auf den
Hauptthread, **nicht** auf Worker-Threads (die Worker-Zeiten ändern sich
zwischen 1× und 6× nicht). Die gedrosselten Hauptthread-Werte sind deshalb der
belastbare Handy-Proxy.

### Gelände-Horizont

| Zellenweite | Bau (32 Richtungen) | Lookup | Speicher |
|---|---:|---:|---:|
| 10 m | 760 ms | 0,9 ms | 5,1 MB |
| 20 m | 103 ms | 0,1 ms | 1,3 MB |
| 25 m | 51 ms | 0,04 ms | 0,8 MB |
| 50 m | 7 ms | 0,01 ms | 0,2 MB |

Ein Horizont bei 4 m mit 16 Richtungen kostet 9–12 s (gedrosselt 78 s) und
wurde verworfen. Der Nutzen des Horizonts: nach dem Bau ist ein Zeitwechsel
nur noch ein Vergleich pro Zelle (0,04–0,9 ms), also Slider ohne Rechnen.

### Qualität

IoU der Schattenmaske gegen die 1-m-Referenz, nur Bodenpixel:

| Variante | Düsseldorf 09:00 | 13:00 | 19:00 |
|---|---:|---:|---:|
| Vektor (Hüllen) vs. Raster | 0,820 | 0,736 | 0,913 |
| Gelände 10 m vs. 1 m (Siebengebirge, 08:00) | — | — | 0,685 |
| Gelände 20 m vs. 1 m | — | — | 0,505 |
| Gelände 25 m vs. 1 m | — | — | 0,443 |
| Terrain Tiles z14 (6,1 m) vs. DGM1 1 m | — | — | 0,394 |

Der Vektor-Fehler ist systematisch: die konvexe Hülle füllt Innenhöfe. Bei
13:00 sind 80.752 Bodenpixel „nur Vektor" und 6.660 „nur Raster" — die Hülle
ist eine Obermenge, kein Rauschen.

Siebengebirge, Vektor vs. Raster: 0,313 um 08:00, 0,705 um 13:00, 0,556 um
18:00. Der Unterschied ist reiner Geländeschatten; ein Gebäude-only-Ansatz
sieht ihn nie.

Terrain Tiles (EU-DEM, 25 m) gegen DGM1 im Siebengebirge: RMSE 10,2 m,
Maximalfehler 53,3 m. Bei 22° Sonnenhöhe verschiebt das die Schattengrenze um
mehrere Zehnermeter.

### Ausgabegrößen

| Bild | Auflösung | PNG | WebP |
|---|---|---:|---:|
| Düsseldorf 1 m | 2000² | 2,0–2,2 MB | 0,39 MB |
| Düsseldorf 4 m | 500² | 0,19 MB | 0,05 MB |
| Siebengebirge 2 m | 1000² | 0,99 MB | 0,08–0,12 MB |

Das sind volle Composites (Gelände + Dächer + Schatten). Eine reine
Schattenmaske mit flacher Farbe und Alpha ist deutlich kleiner; die
Kachelgröße für die Produktion muss separat gemessen werden.

### Overpass

Der öffentliche Endpunkt braucht 33–40 s und liefert 7–29 MB JSON pro
Stadtfenster. Für die interaktive Karte unbrauchbar, für einen nächtlichen
Build akzeptabel. Die Produktion muss Gebäude aus eigenen Vektorkacheln
beziehen, nicht aus Overpass.

## Reproduktion

Die POC-Skripte lagen unter `/tmp/opencode/shadow/` (nicht im Repo, weil sie
`geotiff` und ImageMagick brauchen). Der Ablauf:

```bash
# 1. Kachelverzeichnis laden und Namen mit Jahr übernehmen
curl -s https://www.opengeodata.nrw.de/produkte/geobasis/hm/dgm1_tiff/dgm1_tiff/ -o dgm1.jsonl

# 2. Kacheln für das Fenster herunterladen (Beispiel Düsseldorf)
# Das Jahr steht im Verzeichnis, nicht im Muster:
# Düsseldorf 2022, Siebengebirge 2021. Namen aus dgm1.jsonl ableiten.
for x in 343 344 345; do for y in 5676 5677 5678; do
  name=$(node -e "const m=require('./tile-map.json');console.log(m['${x}_${y}'])")
  curl -O "https://www.opengeodata.nrw.de/produkte/geobasis/hm/dgm1_tiff/dgm1_tiff/$name"
done; done

# 3. Gebäude
curl -A 'dewmap-shadow-research/1.0' --data-urlencode 'data@q.txt' \
  https://overpass-api.de/api/interpreter -o buildings.json

# 4. DSM bauen, ray-marchen, PNG schreiben
node poc.mjs
```

Die Rechenfunktionen sind in `src/lib/shadow/` portiert; `npm test` deckt
Sonnenstand, Geometrie, Rasterisierung, Ray-Marching, Horizont und Kachelmath
ab (78 Tests).

## Belege

- `shadow-map-duesseldorf.jpg` — 2 × 2 km, 1 m, 09:00 / 13:00 / 19:00.
- `shadow-map-siebengebirge.jpg` — 2 × 2 km, 2 m, 08:00 / 13:00 / 18:00.
- `shadow-map-vector-vs-raster.jpg` — Raster, Vektor und Differenz um 13:00.

## Grenzen

- Kein Baum-/Bewuchsschatten im Düsseldorfer Lauf (nur DGM1 + OSM). DOM1
  würde das liefern, wurde im POC nicht geladen.
- Keine Gebäude außerhalb des 5 × 4 km Arbeitsgebiets; an den Rändern fehlen
  deshalb Schatten von außen. Im Bild sichtbar an der Nordkante.
- Keine Validierung gegen Luftbilder.
- Nur zwei Gebiete, beide in NRW. Andere Bundesländer haben andere
  Kachelformate und Lizenzen.
