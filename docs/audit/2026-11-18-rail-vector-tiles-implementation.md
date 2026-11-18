# Rail Overlay: Vector-Tile Rewrite

**Datum:** 2026-11-18  
**Basis:** `origin/main` `c999661`  
**Status:** implementiert, verifiziert, deploybar.

## Problem

Der bisherige Rail-Lines-Pfad lud Roh-OSM über Overpass in z9-Tiles. Ein dichtes Tile war bis zu ~7 MB groß; bei Zoom 9 konnten 8–24 Tiles gleichzeitig nötig sein. Zusätzlich las der Render-Pfad einen anderen Cache-Key als der Fetch-Pfad (`x/y` statt `z/x/y`), sodass nach dem Download gar nichts gerendert wurde. Es gab keinen Client-Timeout und keinen sichtbaren Fehlerzustand.

## Lösung

- **Datenquelle gewechselt:** CARTO/Protomaps-Vector-Tiles mit `roads` (`kind=rail`) und `pois` (`kind=station`).
- **Kein Overpass** mehr für Linien oder Stationen.
- **Kein z9-Batch, kein Cache-Key, kein Tile-Payload** mehr im App-Code.
- **Zoom-Generaliserung kommt aus den Tiles:** unten nur Hauptstrecken, ab z12 alle Bahnstrecken; Stationen ab z12.
- **Fallback unter z12:** ORM-Raster-Tiles. CARTO/Protomaps enthält Bahnlinien erst ab z12; die Raster-Kacheln liefern die Übersicht.
- **Eigene Layer:**
  - `rail-vector-casing`
  - `rail-vector-main`
  - `rail-vector-station-hit`
  - `rail-vector-station-dot`
  - `rail-vector-station-label`
  - `rail-vector-fallback-layer`
- **Stationen** kommen aus dem `pois`-Layer, haben Namen und werden als Waypoint gesetzt.
- **Opacity** wirkt auf Linien, Stationen, Labels und den Raster-Fallback.
- Entfernt: `fetchRailNetwork`, `railTileStore`, `railTileGet/Set/Purge`, `railTileCache`, `tilesForBounds`, `railTileBbox`, `useRailNetworkStatus`, Lade-Pille und Overpass-Captions.

## Verifikation

- Headless Chromium, echte CARTO-Tiles, App auf `localhost`:
  - z12: **121 Rail-Features**, **1 Station** (Düsseldorf Hbf), Labels sichtbar.
  - z14: **68 Rail-Features**, **2 Stationen**.
  - z9: **ORM-Raster-Fallback sichtbar** (Screenshot), keine leere Karte.
  - Rail-Toggle off → on: erster gerenderter Rail-Feature nach **~2,1 s** im Headless-Software-Renderer.
  - Keine Overpass-Requests mehr im Rail-Pfad.
- `npm test`: **236 Tests / 32 Dateien** grün.
- `npm run lint`, `npm run typecheck`, `npm run check:no-emoji`: clean.
- `npm run build`: statischer Export erfolgreich.

## Bewusste Grenzen

- Die CARTO-Tile-URL ist versioniert (`/v/20261026-01/...`). Bei einem CARTO-Update muss `RAIL_VECTOR_TILE_URL` in `src/lib/railway.ts` mitgezogen werden.
- Unter z12 bleibt ORM-Raster die Datenquelle; das ist bewusst, weil die Vector-Tiles dort keine Bahnlinien enthalten.
- Die Stationsabdeckung entspricht der Protomaps-POI-Auswahl, nicht jedem OSM-Haltepunkt.
- Keine Live-Betriebsdaten; es geht um Infrastruktur, nicht um fahrende Züge.

## Relevante Dateien

- `src/lib/railway.ts`
- `src/components/Map.tsx`
- `src/lib/hiking/overpass.ts`
- `src/lib/railway.test.ts`
- `src/components/rail-source.test.ts`
