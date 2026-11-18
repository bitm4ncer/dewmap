# Rail Overlay: OpenFreeMap Vector-Tile Rewrite

**Datum:** 2026-11-18
**Basis:** `origin/main` `fa1643d`
**Status:** implementiert, verifiziert, deploybar.

## Problem

Der bisherige Rail-Lines-Pfad lud Roh-OSM über Overpass in z9-Tiles. Ein dichtes Tile war bis zu ~7 MB groß; bei Zoom 9 konnten 8–24 Tiles gleichzeitig nötig sein. Zusätzlich las der Render-Pfad einen anderen Cache-Key als der Fetch-Pfad (`x/y` statt `z/x/y`), sodass nach dem Download gar nichts gerendert wurde. Es gab keinen Client-Timeout und keinen sichtbaren Fehlerzustand.

Die erste Vector-Variante nutzte CARTO/Protomaps und darunter ORM-Raster. Das Raster war bei niedrigen Zooms sehr grob und passte nicht zum Vektor-Look.

## Lösung

- **Datenquelle:** OpenFreeMap-Vector-Tiles über TileJSON
  `https://tiles.openfreemap.org/planet` (OpenMapTiles-Schema, CORS `*`).
  Die TileJSON-URL liefert automatisch den aktuellen Planet-Build; es ist keine
  Tile-Version im App-Code gepinnt.
- **Kein Overpass** mehr für Linien oder Stationen.
- **Kein ORM-Raster mehr.** Der Lines-Pfad ist die einzige Rail-Quelle; die
  Vektor-Tiles enthalten Bahnstrecken bereits bei niedrigen Zooms und werden
  von MapLibre pro Zoom generalisiert.
- **Lazy + lokal gecacht:** MapLibre fordert nur sichtbare Tiles an. Über
  `transformRequest` bekommen alle versionierten OpenFreeMap-`.pbf`-Tiles
  `cache: "force-cache"`; sie bleiben im persistenten Browser-HTTP-Cache und
  werden beim nächsten Besuch nicht neu geladen.
- **Linien:** `transportation`-Layer, `class=rail` und `class=transit`.
  `transit` wird nach `subclass` eingefärbt (Tram, Narrow Gauge, Monorail,
  Light Rail); Tunnel (`brunnel=tunnel`) werden gestrichelt.
- **Stationen:** `poi`-Layer, `class=railway`, `subclass=station|halt`.
  Namen und `rank` kommen direkt aus den Tiles; Klick setzt einen Waypoint.
- **Eigene Layer:**
  - `rail-vector-casing`
  - `rail-vector-main`
  - `rail-vector-station-hit`
  - `rail-vector-station-dot`
  - `rail-vector-station-label`
- **Sofortiges Anwenden:** Der Layer wird direkt beim Aktivieren aufgebaut,
  nicht erst wenn `isStyleLoaded()` true ist. Das war eine latente Lücke, weil
  dieser Wert bei streamenden Basemap-Tiles lange false bleiben kann. Zusätzlich
  wird bei `style.load` und `idle` erneut angewendet.
- **Opacity** wirkt auf Linien, Stationen und Labels.
- Entfernt: `fetchRailNetwork`, `railTileStore`, `railTileGet/Set/Purge`,
  `railTileCache`, `tilesForBounds`, `railTileBbox`, `useRailNetworkStatus`,
  Lade-Pille, Overpass-Captions und der Raster-Fallback im Lines-Pfad.

## Verifikation

Headless Chromium mit echten OpenFreeMap-Tiles, App auf `localhost:3009`:

- z9 (Düsseldorf): **25 Rail-Features**, 0 Stationen (POI-Layer ist dort noch
  nicht vorhanden), keine Rasterkachel.
- z12 (Düsseldorf): **38 Rail-Features**, **119 Stationen**.
- z14 (Köln): **68 Rail-Features**, **6 Stationen**, inklusive Köln Hbf.
- Toggle off → on: Layer und Source werden entfernt und wieder aufgebaut;
  danach wieder 38 Rails / 119 Stationen.
- Screenshots: `app-z9.png`, `app-z12.png`, `app-z14.png` (lokal).
- `npm test`: **342 Tests / 48 Dateien** grün.
- `npm run lint`, `npm run typecheck`, `npm run check:no-emoji`: clean.
- `npm run build` mit `NEXT_PUBLIC_BASE_PATH`: erfolgreich.

## Bewusste Grenzen

- OpenFreeMap liefert Infrastruktur, keine Live-Betriebsdaten.
- Die Stationsabdeckung entspricht der OpenMapTiles-POI-Auswahl, nicht jedem
  OSM-Haltepunkt.
- ORM-Raster und der Style-Umschalter sind entfernt; Rail ist immer Vektor.
- OpenFreeMap liefert Tiles bis z14; darüber overzoomt MapLibre die z14-
  Geometrie. Für mehr Detail jenseits z14 wäre ein anderer Vektor-Anbieter
  nötig.
- Bei einem Anbieterwechsel muss nur `RAIL_VECTOR_TILEJSON_URL` in
  `src/lib/railway.ts` angepasst werden.

## Relevante Dateien

- `src/lib/railway.ts`
- `src/components/Map.tsx`
- `src/lib/railway.test.ts`
- `src/components/rail-source.test.ts`
