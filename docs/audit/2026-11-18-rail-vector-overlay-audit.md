# Audit: Vector-Rail-Overlay (Linien + Stationen)

**Datum:** 2026-11-18  
**Basis:** deployter `main` `55c1815`; der Rail-Code ist im aktuellen Worktree identisch, nur um ca. 86 Zeilen verschoben.  
**Umfang:** `railStyle="lines"`, also die selbst gezeichneten Bahnlinien und Stationen. Der Raster-Stil `ORM · tiles` ist nicht Gegenstand der Hauptkritik, wird aber als Vergleich herangezogen.

**Ergebnis in einem Satz:** Das Overlay lädt nicht „etwas zu langsam“, sondern es ist architektonisch falsch aufgebaut: Es lädt riesige Roh-OSM-Tiles über Overpass, rendert sie erst nach vollständiger Antwort, kann sie wegen eines Cache-Key-Bugs anschließend nicht aus dem Cache lesen und hat weder Timeout noch Fehlerzustand. Bei niedrigem Zoom können so mehrere hundert MB und Dutzende Overpass-Requests entstehen.

---

## 1. Reproduktion und Messwerte

### 1.1 Browser-Reproduktion

Auf `main` `55c1815`, Zoom 12, Köln:

1. `Map` → `Rails` einschalten, Stil `Lines`.
2. UI zeigt dauerhaft `Loading rails… (1 tile)`.
3. Nach 20–30 s zeigt die Performance-Timeline zwei Requests an `overpass-api.de` mit **22,3 s** und **11,5 s** Laufzeit, jeweils **0 Byte** übertragen.
4. Es erscheinen keine Linien und keine Stationen. Es gibt keinen sichtbaren Fehler, nur `console.warn("[rail-network]", …)`.

Das ist kein reiner Netzwerkzufall: Die Implementierung hat keinen Client-Timeout. Ein hängender Endpoint bleibt beliebig lange „in flight“, und die UI zeigt weiter „Loading“.

### 1.2 Messung mit einem funktionierenden Overpass-Server

Die App-Endpunkte waren aus der Testumgebung nicht erreichbar. Deshalb wurde dieselbe Query gegen `overpass.osm.ch` gemessen, mit einem dichten Schweizer Ausschnitt derselben Größenordnung wie ein z9-Tile (`47.2,8.3,47.6,9.0`):

| Messgröße | Wert |
|---|---:|
| HTTP | 200 |
| Antwortgröße | **7.068.698 Byte (6,74 MiB)** |
| Laufzeit | **6,85 s** |
| Elemente | **5.935** |
| Wege | **5.700** |
| Stationsknoten | **235** |
| Geometriepunkte | **68.350** |
| daraus gebaute GeoJSON-Features | 5.700 Linien, 2,2 MiB JSON |

Das ist ein **Best-Case** mit einem schnellen Server. Die Query ist exakt die Query der App (`fetchRailNetwork`), nur mit anderer Bounding Box.

### 1.3 Tile-Explosion bei niedrigem Zoom

`RAIL_TILE_ZOOM` ist fix **9**. Die Anzahl der z9-Tiles hängt aber vom aktuellen Viewport ab:

| Zoom | Viewport | z9-Tiles | Datenmenge bei 7 MB/Tile | Wellen bei `RAIL_MAX_PARALLEL=2` |
|---:|---|---:|---:|---:|
| 12 | Desktop 1440×900 | 1 | ~7 MB | 1 |
| 10 | Desktop 1440×900 | 6 | ~42 MB | 3 |
| 9 | Desktop 1440×900 | **24** | **~168 MB** | **12** |
| 9 | Mobil 390×844 | **8** | **~56 MB** | **4** |

Bei 6,85 s pro Tile und zwei parallelen Requests sind das bei z9 Desktop **mindestens ca. 82 s reine Serverzeit**, bevor Rate-Limits, mobile Bandbreite und MapLibre-Tessellierung dazukommen. Die Kommentarzeile „most viewports = 1 tile“ gilt nur für den Default-Zoom 12, nicht für den erlaubten Mindestzoom 9.

### 1.4 Cache-Key-Bug

Der entscheidende Code:

```ts
// Map.tsx, Render-Pfad
const data = railTileCache.get(`${t.x}/${t.y}`);        // main:2679

// Map.tsx, Fetch-/Store-Pfad
const key = `${RAIL_TILE_ZOOM}/${t.x}/${t.y}`;          // main:2725, 2730
railTileCache.set(key, { lines, stations });            // main:2757
```

Geschrieben wird `9/265/170`, gelesen wird `265/170`. Der Lookup trifft **nie** zu. Konsequenzen:

- Nach erfolgreichem Download bleibt die Karte leer.
- `fetchMissingTiles` sieht den Key als vorhanden und lädt nicht erneut.
- Der IndexedDB-Cache wird zwar gefüllt, aber ebenfalls nie gelesen.
- Auch ein warmer Cache beschleunigt nichts, weil der Render-Pfad ihn nicht findet.

Das ist ein deterministischer Korrektheitsfehler, kein Performance-Zufall. Er wurde mit Commit `d7120fd` eingeführt: Dort wurde der Fetch-Key von `${x}/${y}` auf `${RAIL_TILE_ZOOM}/${x}/${y}` geändert, der Render-Key aber nicht mitgezogen. Commit `4052945` hatte ursprünglich beide Seiten mit `${x}/${y}` konsistent.

---

## 2. Systematic Debugging

### Phase 1: Root Cause Investigation

**Symptom:** Rails-Lines-Overlay lädt lange und zeigt keine Daten.

**Datenfluss:**

```
Toggle "Rails" + "Lines"
  → Map.tsx Effect [railwayOn, railStyle, active]
  → ensureRailLinesLayer / ensureRailStationsLayer
  → renderFromCache()
       → railTileCache.get(`${x}/${y}`)          ← falscher Key
  → fetchMissingTiles()
       → railTileCache.has(`${9}/${x}/${y}`)     ← anderer Key
       → railTileGet(`${9}/${x}/${y}`)           ← IDB
       → fetchRailNetwork(bbox z9)
            → overpass() POST an 3 Endpunkte
            → out geom, komplette Rohgeometrie
       → railTileCache.set(`${9}/${x}/${y}`)
       → renderFromCache()                       ← liest weiter `${x}/${y}`
```

**Bestätigte Root Causes:**

1. **Cache-Key-Mismatch** zwischen Render- und Fetch-Pfad. Das Overlay kann nicht aus dem Cache rendern.
2. **Fixer z9-Tile-Zuschnitt** mit Roh-OSM statt Tile-Pyramide. Ein Tile ist bis zu ~7 MB groß; bei z9 können 8–24 Tiles gleichzeitig nötig sein.
3. **Kein Client-Timeout** in `overpass()`. Ein toter Endpoint blockiert die Kette unbegrenzt; die UI hat keinen Fehlerzustand.
4. **All-or-nothing-Rendering**: Erst wenn ein komplettes Tile inklusive aller Linien und Stationen fertig ist, wird `setData` aufgerufen. Es gibt kein progressives Tile-Rendering und keinen „alter Stand bleibt sichtbar“-Pfad.
5. **Offscreen-Requests werden nicht abgebrochen**: Beim Pannen bleiben alte Tiles in `railTileInFlight` und belegen die zwei Slots; der neue Viewport wartet auf alte, nicht mehr sichtbare Downloads.

**Nicht die Ursache:**

- MapLibre selbst ist nicht der Engpass; 5.700 Linien mit 68k Punkten sind für MapLibre handhabbar, aber nicht als wiederholtes komplettes `setData` bei jedem `moveend`.
- Die JSON-Verarbeitung im Node-Test war mit ca. 47 ms schnell; der dominante Faktor ist Netzwerk, Tile-Größe und das Warten auf vollständige Antworten.

### Phase 2: Pattern Analysis

Der ursprüngliche Design-Spec (`docs/superpowers/specs/2026-04-19-rail-network-layer-design.md`) hat bewusst **Raster-Tiles** gewählt und Viewport-Overpass als „overkill“ verworfen:

> „true filtering would require self-hosted vector tiles or viewport-scoped Overpass queries, both considered overkill for this pass.“

Später wurde genau dieser verworfene Ansatz als „vector rail lines“ eingebaut (Commit `14e0e51`) mit der Begründung, er lade „evenly across the viewport“. Das ist durch die Messung widerlegt: Die aktuelle Implementierung lädt nicht gleichmäßig, sondern **gar nicht progressiv** und mit sehr großen Batches.

Der funktionierende Vergleich ist eine **Tile-Pyramide**:

- Raster-ORM: kleine 256-px-Tiles, Browser-Cache, progressives Erscheinen, aber nicht filterbar.
- Echte Vector-Tiles/PMTiles: kleine Tiles pro Zoom, Generalisierung, Attribute, progressive Darstellung, filterbar.
- Aktueller Ansatz: ein z9-Roh-OSM-Batch, keine Pyramide, keine Generalisierung, kein Progressiv-Rendering.

### Phase 3: Hypothesen und Prüfung

| Hypothese | Prüfung | Ergebnis |
|---|---|---|
| H1: Cache-Key verhindert Rendering | Code + Commit-Historie | **bestätigt** |
| H2: z9-Tiles sind zu groß | 7,07 MB / 5.700 Wege gemessen | **bestätigt** |
| H3: z9 bei niedrigem Zoom explodiert | 24 Tiles / 168 MB berechnet | **bestätigt** |
| H4: toter Endpoint blockiert unbegrenzt | `overpass()` ohne Timeout; Browser 22 s/11 s | **bestätigt** |
| H5: Offscreen-Downloads blockieren neue Tiles | Code: keine per-Tile-Aborts bei `moveend` | **bestätigt** |
| H6: Stationen sind separater Engpass | Stationen hängen an derselben 7-MB-Antwort | **bestätigt**, aber sekundär |

### Phase 4: Fix-Reihenfolge (noch nicht implementiert)

Kein Produktionscode wurde für dieses Audit geändert. Die erste failing test sollte der Cache-Key sein:

```ts
expect(railTileKey(9, 265, 170)).toBe("9/265/170");
expect(renderLookupKey(9, 265, 170)).toBe(railTileKey(9, 265, 170));
```

Danach muss die Architektur entschieden werden. Ein reiner Key-Fix macht das Overlay korrekt, aber nicht schnell: 7 MB und 6,85 s pro Tile bleiben.

---

## 3. Kritische Befunde

### P0-1: Cache-Key-Mismatch — Overlay rendert nie aus dem Cache

**Beleg:** `Map.tsx:2679` vs. `Map.tsx:2725/2730` (main).  
**Wirkung:** Kein Rendering nach Download; warmer IDB-Cache wirkungslos; erneutes Laden wird verhindert.  
**Schwere:** P0, Korrektheit.

### P0-2: Fixer z9-Tile-Zuschnitt — 1 bis 24 Roh-OSM-Tiles pro Viewport

**Beleg:** `RAIL_TILE_ZOOM = 9` (`Map.tsx:533`), `tilesForBounds(..., 9)` (`Map.tsx:2673`), `RAIL_MAX_PARALLEL = 2` (`Map.tsx:534`).  
**Wirkung:** 7 MB pro dichtem Tile; bei z9 Desktop bis 168 MB und 12 Wellen.  
**Schwere:** P0, Architektur.

### P0-3: Kein Timeout und kein sichtbarer Fehlerzustand

**Beleg:** `overpass()` (`src/lib/hiking/overpass.ts:31–57`) nutzt `fetch` ohne `AbortSignal.timeout`; die drei Endpunkte werden sequenziell probiert.  
**Wirkung:** Ein hängender Endpoint blockiert die gesamte Kette; UI zeigt unbegrenzt „Loading rails“, obwohl kein Fortschritt existiert.  
**Schwere:** P0, Resilienz/UX.

### P1-1: Offscreen-Tiles werden nicht abgebrochen

**Beleg:** `inflightControllers` wird nur beim Effect-Cleanup abgebrochen, nicht bei `moveend` für Tiles außerhalb des neuen Viewports (`Map.tsx:2728–2760`).  
**Wirkung:** Panning blockiert die zwei Slots mit alten Downloads; der neue Ausschnitt wartet.  
**Schwere:** P1, Latenz.

### P1-2: Rate-Limit-Behandlung ist zu primitiv

**Beleg:** `RAIL_RATE_LIMIT_BACKOFF_MS = 15_000` (`Map.tsx:535`), `isRateLimitError` per String-Match, kein `Retry-After`, kein exponentieller Backoff, kein Jitter.  
**Wirkung:** Nach 429 werden alle Tiles 15 s später erneut versucht; bei mehreren Tiles entsteht ein neuer Burst. Overpass bleibt überlastet.  
**Schwere:** P1.

### P1-3: Kein progressives Rendering, kein Stale-While-Revalidate

**Beleg:** `handleTile` setzt Daten erst nach vollständigem `fetchRailNetwork`; `renderFromCache` ersetzt die komplette FeatureCollection.  
**Wirkung:** Beim ersten Laden und an jeder Tile-Grenze ist die Karte leer, bis das größte Tile fertig ist. Es gibt keine Teilresultate.  
**Schwere:** P1, UX.

### P1-4: Stationen sind an die Linien-Antwort gekoppelt und unvollständig

**Beleg:** `fetchRailNetwork` sammelt `node[railway=station]` und `node[railway=halt]` in derselben Query (`overpass.ts:74–82`, `87–125`).  
**Wirkung:** Stationen erscheinen erst nach dem 7-MB-Linien-Download. Viele reale Stationen (Flächen, `public_transport=station`, `railway=stop_position`) fehlen. Keine Priorisierung, keine Clusterung, keine UIC-/Ref-Anzeige.  
**Schwere:** P1, Datenqualität.

### P1-5: Keine echte Vector-Tile-Pyramide, keine Generalisierung

**Beleg:** `out geom` liefert Rohgeometrie für alle `rail|light_rail|narrow_gauge|subway|tram|monorail` und Sidings in einem z9-Batch.  
**Wirkung:** Bei jedem Zoom wird dieselbe volle Geometrie gerendert; kein Weglassen von Nebenbahnen/Gleisen bei niedrigem Zoom, keine vereinfachten Linien, keine Attribute für Usage/Elektifizierung/Geschwindigkeit.  
**Schwere:** P1, Architektur.

### P1-6: Cache-Lebenszyklus und IDB-Keying sind inkonsistent

**Beleg:** `railTileStore.ts` speichert unter dem übergebenen Key; der Aufrufer nutzt seit `d7120fd` `9/x/y`, der Renderer `x/y`. DB-Version bleibt `1`, alte `${x}/${y}`-Einträge werden nicht migriert.  
**Wirkung:** Orphaned Cache-Einträge, unklare Quota-Belegung, kein „Cache leeren“-Affordance.  
**Schwere:** P1.

### P1-7: Wiederholtes vollständiges `setData` bei jedem `moveend`

**Beleg:** `onMoveEnd` ruft `renderFromCache()` und `fetchMissingTiles()`; `setRailLinesData` setzt die komplette Collection neu.  
**Wirkung:** MapLibre parst/trianguliert bei jedem Pan-Ende erneut alle sichtbaren Features. Bei 5.700 Linien und 68k Punkten ist das auf Mobilgeräten spürbar.  
**Schwere:** P1, Performance.

### P2: Weitere Befunde

- `tilesForBounds` clampt x/y nicht; Dateline-/Pol-Regionen können ungültige BBoxen erzeugen.
- Stationslabels haben kein `symbol-sort-key`; große Bahnhöfe können zugunsten kleiner Halte verdrängt werden.
- Stationsklick fügt direkt einen Waypoint hinzu; kein Popup, keine Detailansicht, keine Tastaturbedienung.
- Kein Preconnect/DNS-Prefetch zu Overpass.
- Kein Fortschritt (Bytes/Tiles), nur ein Spinner und ein Tile-Zähler.
- Keine Tests für `railTileKey`, `tilesForBounds`, Query-Builder, Cache-Hit und Offscreen-Abbruch. Der Key-Regressionsfall wäre mit einem Test sofort aufgefallen.
- Die UI-Bezeichnung „Vector“ ist irreführend: Es sind GeoJSON-Linien aus Overpass, keine Vector-Tiles.

---

## 4. Stations- und Routen-Datenmodell

### Linien

`fetchRailNetwork` übernimmt nur:

```ts
id, kind, service, tunnel
```

Es fehlen unter anderem:

- `usage` (main/branch/highspeed)
- `highspeed`, `maxspeed`
- `electrified`, `voltage`, `frequency`
- `gauge`
- `bridge`, `layer`
- `operator`, `ref`, `name`
- route relations (`route=train`, `route=light_rail`, …)

Damit ist keine echte Unterscheidung von Haupt-, Neben-, Hochgeschwindigkeits- und Güterstrecken möglich. Die aktuelle Darstellung unterscheidet nur `rail`, `light_rail`, `subway`, `tram`, `narrow_gauge` und Tunnel.

### Stationen

- Nur Knoten, keine Flächen oder `public_transport=station`.
- Keine Verknüpfung zu Linien/Routen.
- Keine Wichtigkeit/Priorität (Hauptbahnhof vs. Haltepunkt).
- Keine Clusterung bei niedrigem Zoom.
- Labels konkurrieren ohne Sortierschlüssel.
- Keine Suche/Filter, obwohl Stationen als Waypoints dienen.

Das ist für eine „täglich nutzbare“ Bahnansicht zu wenig.

---

## 5. Zielarchitektur

### Empfehlung: PMTiles-Vector-Tiles, kein Overpass zur Laufzeit

Ein statisches Rail-Paket, das aus OSM/Geofabrik gebaut und als PMTiles auf CDN/GitHub Pages/R2 gehostet wird:

**Layer `rail_lines`**

- `kind`, `usage`, `service`, `highspeed`, `electrified`, `gauge`, `bridge`, `tunnel`, `operator`, `ref`
- Generalisierung pro Zoom:
  - z2–6: nur Hauptstrecken
  - z7–9: Haupt- und wichtige Nebenstrecken
  - z10–12: alle Bahnstrecken
  - z13+: Sidings, Gleisdetails, Tunnel/Brücken
- Vereinfachte Geometrie pro Zoomstufe.

**Layer `rail_stations`**

- `name`, `ref`, `uic`, `wikidata`, `importance`, `platforms`
- Ab z6 nur Hauptbahnhöfe, ab z9 wichtige Stationen, ab z11 alle
- `symbol-sort-key` nach `importance`
- Cluster oder Ausblenden bei Kollision
- Separates Laden, damit Stationen sofort erscheinen, unabhängig von Linien.

**MapLibre**

- `vector`-Source mit PMTiles-URL oder `pmtiles://…`
- `source-layer` für Linien und Stationen
- `minzoom`/`maxzoom` pro Layer
- Kein `setData` mit Riesencollections; MapLibre lädt nur sichtbare Tiles.
- Optional: Raster-ORM als Fallback für z<9, Vector ab z9.

**Build**

- Geofabrik-Extrakt (z. B. Deutschland/Europa) → `osmium`/`tippecanoe` → PMTiles.
- Versioniertes Artefakt, z. B. `rail-de-2026-11.pmtiles`.
- Metadaten: Datenstand, Lizenz, Attribution.
- Update monatlich oder quartalsweise; kein Live-Overpass.

**Vorteile**

- Erster Frame in <1 s statt 7–80 s.
- Nur sichtbare Kacheln, wenige hundert KB statt 7 MB pro Batch.
- Browser-/CDN-Cache, Range-Requests, Offline-Fähigkeit.
- Echte Filter und Zoom-Generaliserung.
- Keine Overpass-429-Abhängigkeit im Betrieb.

**Kosten**

- Build-Pipeline und Hosting müssen betrieben werden.
- Datenstand ist nicht minutengenau; für Bahninfrastruktur ist das unkritisch.
- PMTiles-Dependency und Source-Styling.

### Übergangslösung, falls PMTiles nicht sofort kommt

1. **Cache-Key sofort vereinheitlichen** (`railTileKey(z,x,y)` an einer Stelle).
2. **Keine z9-Batches mehr**: aktuellen Viewport + 10–15 % Padding verwenden, Fläche hart begrenzen.
3. **Zoom-Gate** auf z10/11; darunter ORM-Raster oder gar keine Vector-Linien.
4. **Kleinere Queries**: bei niedrigem Zoom nur `railway=rail`/`usage=main`, Sidings/Tram erst ab z12.
5. **Client-Timeout** 8–10 s pro Endpoint; `AbortSignal.timeout` plus manueller Abort.
6. **Retry-After** auswerten, exponentieller Backoff mit Jitter.
7. **Offscreen-Tiles abbrechen** bei `moveend`.
8. **Stationen separat** und kleiner abfragen; Linien und Stationen getrennt rendern.
9. **Progressives Rendering**: jede fertige Tile sofort in die Source mischen, alte Daten bis zum Ersatz stehen lassen.
10. **Fehlerzustand** in der UI: „Rails konnten nicht geladen werden“ plus Retry, nicht endloses „Loading“.

Das ist eine Brücke, keine Zielarchitektur. Die 7-MB-Rohdaten und die fehlende Generalisierung bleiben.

---

## 6. Verifikationsplan für die Überarbeitung

### Regressionstests

- `railTileKey(9, 265, 170)` ist in Store, Lookup und IDB identisch.
- `tilesForBounds` liefert für z9 Desktop nicht mehr als das definierte Budget (z. B. ≤4 Tiles) oder wird gar nicht mehr verwendet.
- `fetchRailNetwork` bricht nach Timeout ab und liefert einen typisierten Fehler.
- Offscreen-Tile wird bei `moveend` abgebrochen.
- Stationen werden auch ohne Linien-Response gerendert.
- Ein kalter Cache mit einem 7-MB-Fixture rendert in definierter Zeit; ein warmer Cache macht null Netzwerk-Requests.
- `renderFromCache` und `fetchMissingTiles` verwenden nachweislich denselben Key.

### Messziele

| Metrik | Ziel |
|---|---|
| Erster sichtbarer Rail-Layer (kalt, z12) | < 1,5 s |
| Erster sichtbarer Rail-Layer (warm) | < 100 ms |
| Netzwerk pro Viewport (z12) | < 300 KB |
| Netzwerk pro Viewport (z9) | < 1 MB |
| Requests pro Nutzeraktion | 1–4, nicht 2–24 |
| Fehlerzustand bei Endpoint-Ausfall | sichtbar nach ≤10 s |
| Kein UI-Hänger | nie > 10 s ohne Status/Retry |

### Abnahmeszenarien

- Köln z12 kalt/warm.
- Zürich z12 kalt/warm.
- Deutschland z9 (Übersicht) mit Budget.
- Pan über eine Tile-Grenze: alte Linien bleiben sichtbar, neue erscheinen progressiv.
- Offline/Reload: warmer Cache rendert ohne Netz.
- Overpass/PMTiles 429/500: Retry und sichtbarer Fehler.
- Mobil 390×844, 4G-Drosselung: erster Frame < 2 s.

---

## 7. Empfehlung

**Nicht** nur den Cache-Key fixen und weiter Overpass im Viewport abfragen. Das repariert die Korrektheit, lässt aber die 7-MB-/24-Tile-Architektur und die fehlende Resilienz bestehen.

**Empfohlene Reihenfolge:**

1. **P0 sofort:** Cache-Key vereinheitlichen, damit der bestehende Cache überhaupt wirkt.
2. **P0 kurzfristig:** z9-Batches entfernen, Zoom-Gate und Flächenbudget einführen, Timeout und Fehlerzustand ergänzen.
3. **P1:** Offscreen-Aborts, Retry-After/Backoff, getrennte Stationen, progressives Rendering.
4. **Ziel:** PMTiles-Vector-Pyramide für Linien und Stationen; Raster-ORM nur als Fallback für niedrige Zoomstufen.

Die aktuelle Implementierung ist aus meiner Sicht **nicht grundsanierbar**, ohne die Datenquelle zu wechseln. Der Overpass-Ansatz kann als Debug-/Fallback-Pfad bleiben, aber nicht als primäre Karte für tägliche Nutzung.

---

## 8. Evidenz-Anhang

### Gemessene Query

```overpass
[out:json][timeout:25];
(
  way[railway~"^(rail|light_rail|narrow_gauge|subway|tram|monorail)$"][service!~"."](47.2,8.3,47.6,9.0);
  way[railway~"^(rail|light_rail|narrow_gauge|subway|tram|monorail)$"][service=siding](47.2,8.3,47.6,9.0);
  node[railway=station](47.2,8.3,47.6,9.0);
  node[railway=halt](47.2,8.3,47.6,9.0);
);
out geom;
```

### Browser-Performance

```text
https://overpass-api.de/api/interpreter   start 11.377 s   duration 22.286 s   transferSize 0
https://overpass-api.de/api/interpreter   start 33.765 s   duration 11.531 s   transferSize 0
```

### Relevante Commits

- `4052945` — ursprünglicher Tile-Cache, Key konsistent `${x}/${y}`.
- `14e0e51` — Wechsel auf Overpass-Vector-Lines; Begründung „loads evenly“.
- `d7120fd` — Key-Umstellung im Fetch-Pfad auf `${z}/${x}/${y}`, Lookup nicht angepasst.
- `162477a` — IndexedDB-Persistenz; ursprünglicher Key `${x}/${y}` dokumentiert.

### Relevante Dateien

- `src/components/Map.tsx`
- `src/lib/hiking/overpass.ts`
- `src/lib/hiking/railTileStore.ts`
- `docs/superpowers/specs/2026-04-19-rail-network-layer-design.md`

---

## 9. Grenzen des Audits

- Die App-Endpunkte `overpass-api.de`, `overpass.kumi.systems` und `overpass.private.coffee` waren aus der Testumgebung nicht erreichbar. Die 7-MB-Messung stammt von einem funktionierenden Overpass-Server mit derselben Query und vergleichbarer Dichte.
- Die Tile-Anzahl-Tabelle ist eine geometrische Berechnung für einen 1440×900-Viewport bei 51° Nord; die tatsächliche Zahl hängt von Viewport und Breitengrad ab.
- Es wurde kein Produktionscode geändert. Die Empfehlungen sind ein Audit-/Umbauplan, keine bereits verifizierte Implementierung.

---

## Status 2026-11-18 — umgesetzt

Der Rail-Lines-Pfad wurde auf CARTO/Protomaps-Vector-Tiles umgestellt. Der
Overpass-Batch, der z9-Tile-Cache und der Cache-Key-Mismatch sind entfernt.
Unter z12 liefert ORM-Raster die Übersicht, ab z12 übernehmen Vector-Tiles
Linien und Stationen.

Details und Messwerte:
`docs/audit/2026-11-18-rail-vector-tiles-implementation.md`

Verifikation: 236 Tests, Lint, Typecheck, Build; headless Chromium mit echten
CARTO-Tiles: 121 Rail-Features bei z12, 68 bei z14, ORM-Fallback bei z9.
Deploy: https://bitm4ncer.github.io/kugelmaps/
