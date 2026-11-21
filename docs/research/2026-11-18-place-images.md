# Place Images: Street-Level, Hausfronten und Place-Fotos

**Stand:** 2026-11-18  
**Ziel:** Automatisiert und sinnvoll Bilder für viele Places in dewmap sammeln — ohne Backend, ohne offene API-Keys im Client, mit klarer Lizenz.  
**Geprüft:** Panoramax, KartaView und Wikimedia Commons live per `curl` mit Browser-UA und `Origin`; Mapillary/Google gegen die aktuelle Dokumentation.

---

## 0. Kurzfazit

Es gibt **kein offenes globales Google Street View**. Aber es gibt einen brauchbaren offenen Stack:

| Rang | Quelle | Warum |
|---|---|---|
| 1 | **Panoramax** | Föderiert, keyless, CORS-offen, stabile Bild-URLs, **Place-Suche** (`place_position`) — perfekt für Hausfronten |
| 2 | **Mapillary** | Größte globale Abdeckung, CC BY-SA, Qualitäts-/Heading-Daten, aber Token und **Thumbnail-URLs laufen nach ca. 30 Tagen ab** |
| 3 | **KartaView** | Keyless, CORS-offen, CC BY-SA, aber deutlich dünner und älter |
| 4 | **Wikimedia Commons / Wikidata / OSM-Tags** | Sehr gut für Museen, Denkmäler, Bahnhöfe; schwach bei normalen Shops |
| 5 | **Google Street View / Places Photos** | Beste Abdeckung, aber teuer, kein Caching, Key/Billing, nicht statisch-tauglich |

**Pitch:** Nicht Google nachbauen. Eine **Open-Photo-Pipeline** bauen:
Panoramax zuerst, KartaView/Commons als Fallback, Mapillary über einen kleinen serverseitigen Proxy (oder nur als „Street View“-Link), Google/Yelp/Foursquare bewusst nicht als Basis.

---

## 1. Was heißt „Hausfront“ wirklich?

Street-Level-Bilder sind **keine** Fotos des Ladens von innen. Sie zeigen die Straße und — bei richtiger Blickrichtung — die Fassade. Für einen Shop ist das oft nützlicher als ein Innenraumfoto, aber es ist kein garantiertes „Frontfoto“.

Drei Stufen:

1. **Street View near place** — nächstes Bild in < 30 m, egal wohin die Kamera schaut. Einfach, aber oft Straße statt Fassade.
2. **Facade shot** — Bild, dessen Kamera in Richtung des POI schaut (`heading error < 45°`), POI in < 25 m. Das ist die sinnvolle Standardstufe.
3. **Facade crop** — Fassade anhand OSM-Gebäudepolygon und Kamerapose ins Bild projizieren und zuschneiden. Aufwändig, aber machbar; nicht Phase 1.

Panoramax hat für Stufe 2 bereits einen eigenen API-Parameter. Mapillary braucht dafür eigene Geometrie-/Heading-Berechnung.

---

## 2. Street-Level-Anbieter im Vergleich

### 2.1 Panoramax — der beste offene Baustein

**Was:** Föderiertes, offenes Street-Level-Projekt (GeoVisio), getragen von OSM France, IGN und lokalen Initiativen. Über 100 Mio. Bilder (April 2026), > 900.000 km Straße; Schwerpunkt Frankreich, aber viele Instanzen in Europa.

**API:** STAC/OGC API, Metakatalog `https://api.panoramax.xyz/api`.

**Key:** keiner.  
**CORS:** Metakatalog spiegelt den Origin (`access-control-allow-origin: https://bitm4ncer.github.io`); Bild-Assets `*`.  
**Lizenz:** CC BY-SA 4.0 oder Licence Ouverte 2.0 (LO). Attribution + Lizenzlink; bei Bearbeitungen Share-Alike beachten.  
**Bildgrößen:** `thumb` (500 px), `sd` (2048 px), `hd` (Original).

**Der entscheidende Endpunkt:** Place-Suche, nicht nur BBox:

```http
GET https://api.panoramax.xyz/api/search
  ?place_position=2.354798,48.854787   # lon,lat
  &place_distance=3-25                  # Meter, Format "min-max"
  &place_fov_tolerance=45               # Bild muss zum Ort schauen
  &limit=5
```

Getestet am 2026-11-18 in Paris:

- HTTP 200, 2 Treffer
- `view:azimuth: 25`
- `license: CC-BY-SA-4.0`
- `assets.thumb.href`, `assets.sd.href`, `assets.hd.href`
- Asset-URL: HTTP 200, `access-control-allow-origin: *`

Weitere nützliche Felder:

```json
{
  "geometry": { "type": "Point", "coordinates": [2.354798, 48.854787] },
  "properties": {
    "datetime": "2025-05-21T06:41:33Z",
    "view:azimuth": 25,
    "license": "CC-BY-SA-4.0",
    "geovisio:status": "ready",
    "geovisio:producer": "…",
    "quality:horizontal_accuracy": 5.0
  },
  "assets": {
    "thumb": { "href": "https://…/thumb.jpg" },
    "sd":    { "href": "https://…/sd.jpg" },
    "hd":    { "href": "https://…/…jpg" }
  }
}
```

**Abdeckung (Stichproben/Instanzliste):**

- OSM-FR: ~53 Mio. Bilder, weltweite Testbeiträge
- IGN: ~59 Mio. Bilder, Frankreich
- MultimodAll: ~1,05 Mio., Deutschland + Nachbarländer
- veloroute.hamburg: ~670.000, Hamburg
- Panoramax Ulm: ~376.000
- OSM Fulda: ~58.000
- Belgien, Niederlande, Spanien, Kroatien, Taiwan, Nordics u. a.

**Grenzen:**

- In Berlin war die Place-Suche im Metakatalog bei 100 m leer; erst bei 1 km kamen 360°-Bilder. Die Abdeckung ist **stark lokal**.
- Viele Instanzen sind nicht im Metakatalog oder decken nur ihre Stadt ab.
- 360°-Bilder haben teils keinen `view:azimuth`; für Fassaden lieber flache Bilder mit Heading nehmen.
- Keine SLA, keine harte Quote — höflich throtteln.

**Fazit:** Für Frankreich und deutsche Panoramax-Städte die erste Wahl. Keyless, stabile URLs, CORS, Place-Suche. Das ist der Hero-Provider.

---

### 2.2 Mapillary — größte Abdeckung, aber Token + TTL

**Was:** Meta-Projekt, weltweite crowdsourced Street-Level-Bilder. Sehr gute Abdeckung in Städten; 2026-Kampagne u. a. Berlin, München, Frankfurt, Stuttgart, Ingolstadt, Köln.

**API:** Graph API v4.

**Key:** Client- oder User-Token.  
**Lizenz:** User Content CC BY-SA 4.0; Mapillary-Logo als Attribution, Link auf Mapillary.  
**Wichtig:** Terms verbieten Nutzung „in connection with real-time navigation or route guidance“. Die App hat Navigation — Bilder während aktiver Navigation ausblenden.

**Radius-Suche (neu seit 2026-04-02):**

```http
GET https://graph.mapillary.com/images
  ?lat=52.5200
  &lng=13.4050
  &radius=50                 # max. 50 m
  &limit=10                  # max. 100
  &fields=id,geometry,computed_geometry,compass_angle,computed_compass_angle,
          captured_at,is_pano,quality_score,on_foot,width,height,sequence,thumb_1024_url
  &access_token=MLY|…
```

**Eigenschaften:**

- `quality_score` (0–1), seit Mai 2026
- `on_foot` (bool), seit Juni 2026 — für Hausfronten **Fußgänger-Sequenzen bevorzugen**
- `compass_angle` / `computed_compass_angle`
- `is_pano`
- `thumb_1024_url` / `thumb_2048_url`

**Die große Falle:** Thumbnail-URLs sind **signierte CDN-URLs mit TTL (~30 Tage)**. Man darf sie nicht dauerhaft in einen statischen Index schreiben. Man muss für jedes Bild frisch `thumb_*_url` holen — mit Token. Ein statischer Client kann den Token nicht geheim halten.

**Drei Lösungen:**

1. **Mapillary nur als Link/Embed** (`https://www.mapillary.com/embed?image_key=…&style=photo`) — kein Token, aber kein schlankes Hero-Bild.
2. **Kleiner Cloudflare Worker** als Proxy: hält den Token, holt pro Bild-ID eine frische URL und antwortet mit `302` auf das CDN. Kein Bild-Caching, Token nicht im Client. Free Tier reicht für den Anfang.
3. **Client-Token** — einfach, aber missbrauchsanfällig; nur wenn Terms/Scope das hergeben.

**Weitere Limits:**

- `bbox` < 0,01° × 0,01°
- Search-API: 10.000 Requests/Minute/App
- Entity-API: 60.000/Minute
- Vector Tiles: 50.000/Tag
- Kein Bulk-Download; Terms erlauben kein Scraping.

**Fazit:** Beste globale Abdeckung, aber für eine statische App nur mit Proxy oder als Embed/Link sinnvoll. Nicht als alleinige Hero-Quelle.

---

### 2.3 KartaView — einfach, keyless, dünn

**Was:** Offene Street-Level-Plattform (früher OpenStreetCam), Beiträge per App.

**API:** `https://api.kartaview.org/2.0/photo/`.

**Key:** keiner für die Foto-Suche.  
**CORS:** spiegelt den Origin.  
**Lizenz:** CC BY-SA.

**Getestet 2026-11-18 in Berlin:**

```http
GET https://api.kartaview.org/2.0/photo/?lat=52.52&lng=13.405&radius=50
```

- HTTP 200, Treffer in 9,13 m
- `heading`, `lat`, `lng`, `shotDate`, `sequenceId`, `width`, `height`
- `imageLthUrl`, `imageThUrl`, `fileurlLth`
- CDN-Bild: HTTP 200, `access-control-allow-origin: *`

**Grenzen:**

- Deutlich dünner als Mapillary; oft ältere Aufnahmen (Beispiel 2017).
- Keine garantierte Aktualität.
- API-Doku-Website ist JS-lastig; Endpunkt funktioniert aber.
- Eher Fallback als Hauptquelle.

**Fazit:** Keyless und sofort nutzbar; als dritte Stimme und für Orte ohne Panoramax/Mapillary.

---

### 2.4 Mapilio — Watchlist, nicht Phase 1

**Was:** Türkisches Street-Level-Projekt, iD-Integration, CC BY-SA, wachsende Community.

**Status:**

- Mobile Apps seit 2026 open source (Apache-2.0)
- API-Doku aktuell nicht stabil erreichbar (`docs.mapilio.com` → 404)
- Terms erlauben OSM-Nutzung, verbieten aber ebenfalls Navigation
- Keine verlässliche keyless API gefunden

**Fazit:** Beobachten, nicht darauf bauen. Wenn sich die API stabilisiert, als weitere Mapillary-Alternative aufnehmen.

---

### 2.5 Wikimedia Commons / Wikidata / OSM — die unterschätzte Präzisionsquelle

**Commons Geosearch:**

```http
GET https://commons.wikimedia.org/w/api.php
  ?action=query
  &format=json
  &origin=*
  &generator=geosearch
  &ggscoord=52.5200|13.4050
  &ggsradius=500
  &ggsnamespace=6
  &ggslimit=50
  &prop=imageinfo
  &iiprop=url|extmetadata|size
  &iiurlwidth=1024
```

**Getestet:** HTTP 200, `access-control-allow-origin: *`, File-Seiten mit `imageinfo`.

**Wichtig:**

- `ggsnamespace=6` (File-Namespace), sonst kommen Artikel statt Bilder.
- Max. Radius 10.000 m, max. 500 Ergebnisse.
- Ergebnisse sind **irgendetwas in der Nähe** — kein Garant, dass es das Gebäude zeigt.
- Lizenz aus `extmetadata` filtern: CC0, Public Domain, CC BY, CC BY-SA; unbekannte Lizenzen verwerfen.
- Attribution: `Artist`, `Credit`, `LicenseShortName`, `LicenseUrl`; Link auf `descriptionurl`.

**Wikidata:**

- `P18` (Image) für Museen, Bahnhöfe, Denkmäler, Rathäuser.
- `wbgetclaims&property=P18&entity=Q…` oder SPARQL.
- Bild liegt auf Commons; Lizenz dort prüfen.

**OSM-Tags:**

- `image=*` — direkter Bildlink; Lizenz oft unklar → nur mit bekannter freier Lizenz nutzen.
- `wikimedia_commons=File:…` — präzise, freie Lizenz.
- `mapillary=*` — exakte Bild-ID.
- `panoramax=*` — exakte Bild-ID.
- `kartaview=*`, `flickr=*` — exakte IDs.
- `wikidata=*` → P18.
- `brand:wikidata=*` → Markenbild, aber nicht Filiale.

**Fazit:** Für Landmarks und markante Orte sehr gut, für normale Shops zu dünn. Aber ideal als **exakte** Quelle, wenn ein OSM-Tag existiert.

---

## 3. Place-Foto-APIs für Businesses

Das ist der Teil, der bei „Geschäfte, Restaurants, Museen“ oft gemeint ist — und der teuer/rechtlich komplex ist.

### 3.1 Google Places Photos

- Bis zu 10 Fotos pro Place.
- **$7 / 1.000 Foto-Requests** (nach 10.000 kostenlosen Events/Monat).
- Place Details mit Fotos: weitere SKU (Essentials/Pro/Enterprise; Atmosphere bis $25/1k).
- **Kein Prefetching, Caching oder Speichern** von Fotos; nur Place-IDs dürfen unbegrenzt gespeichert werden.
- Autor-Attribution (Avatar/Name/Profil), direkter Link zum Foto auf Google Maps, `flagContentUri`.
- API-Key + Billing; Client-Key muss geschützt werden.
- Fotos sind keine offenen Daten; nichts für einen vorberechneten statischen Index.

**Fazit:** Für einzelne Premium-Orte möglich, aber nicht als Massenquelle. Schon gar nicht mit „alle Shops in DACH vorab bebildern“.

### 3.2 Yelp

- Bis zu 12 Fotos pro Business.
- Fusion/Places API ist kommerziell; Pläne deutlich teurer als Google Photos (Größenordnung hunderte Dollar/Monat, je nach Plan).
- Strenge Attribution-, Link- und Caching-Regeln.
- Keine offene Lizenz.

**Fazit:** Nein für den offenen Layer. Höchstens Partner-/Premium-Feature.

### 3.3 Foursquare

- Places API mit Fotos als Premium-Endpoint.
- Fotos ~$18,75/1k (Staffelpreise), kein nennenswertes Free-Tier für Photos.
- Kommerzielle Terms, Attribution.

**Fazit:** Nein für den Start.

### 3.4 TripAdvisor / Facebook / Instagram

- TripAdvisor: Partnerprogramm, keine offene API.
- Facebook/Instagram: keine öffentliche Place-Photo-API; Scraping verboten.
- Keine belastbare automatische Quelle.

---

## 4. Kommerzielle Street-Level-Anbieter

| Anbieter | Zugang | Für dewmap? |
|---|---|---|
| **Google Street View** | Key + Billing; Static API $7/1k; kein Caching/Bulk | Nur Premium/Fallback, nicht statisch |
| **HERE Street Level** | Enterprise/API-Key | Nein, kommerziell |
| **Bing Streetside** | Key, OSM-Editor-Sonderzugang, unklare Zukunft | Nein |
| **Apple Look Around** | Keine öffentliche API | Nein |
| **Yandex Panoramas** | Key, regionale Abdeckung | Nein |
| **Cyclomedia / NavVis** | Enterprise, hochauflösend | Nein |
| **TomTom** | Kein offenes Street-Level für diesen Zweck | Nein |

**Google-Details:**

- Street View Static: 10.000 kostenlose Events/Monat, danach **$7/1k**; max. 640×640.
- Metadata: kostenlos.
- Panorama-ID darf gespeichert werden; Bild selbst nicht.
- Kein Prefetching/Indexing/Caching; keine Bulk-Downloads.
- Attribution „Google Maps“; bei Fotos zusätzlich Autor + Link.
- EEA-spezifische Terms beachten.

**Fazit:** Google ist die einzige Quelle, die „fast überall“ liefert. Aber sie passt nicht zu „statisch, keyless, vorberechnet“. Wenn überhaupt: serverseitiger Proxy, On-Demand, mit Billing-Limit — nicht als Standard-Hero.

---

## 5. Abdeckung realistisch einschätzen

| Region | Beste offene Quelle | Realität |
|---|---|---|
| Frankreich | Panoramax (IGN/OSM-FR) | Sehr gut, oft Fassadenbilder |
| Deutschland Stadt | Panoramax-Instanzen + Mapillary | Gut in Hamburg/Ulm/Fulda/Berlin/München etc., lückenhaft |
| Deutschland Land | Mapillary | Große Lücken; viele Weiler ohne Sequenz |
| Österreich/Schweiz | Mapillary + KartaView | Städte okay, Alpenländer lückenhaft |
| Niederlande/Belgien | Panoramax-Instanzen + Mapillary | Gut bis sehr gut |
| UK | Mapillary/KartaView + Geograph | Geograph stark, aber UK-only und API-Key |
| USA | Mapillary/KartaView | Städte okay, ländlich dünn |
| Asien | Mapillary/KartaView | Sehr unterschiedlich |
| Landmarks weltweit | Commons/Wikidata | Oft sehr gut, aber kein Shop-Front-Ersatz |

**Wichtig:** Es gibt keine belastbare globale „Hit-Rate“. Vor dem Rollout pro Stadt messen: Wie viele POIs haben ein Bild mit `score >= 0.7`? Die Pipeline soll diese Statistik automatisch ausgeben.

---

## 6. Empfohlene Architektur für dewmap

### 6.1 Prinzip

**Bilder werden nicht im Client gesucht, sondern vorberechnet.**  
Die App ist statisch; API-Keys und Rate-Limits gehören in eine Build-Pipeline, nicht in JavaScript.

```
OSM/OpenFreeMap POIs
        │
        ▼
GitHub Action / lokaler Build
  ├─ Panoramax  (keyless, place search)
  ├─ KartaView  (keyless, radius)
  ├─ Commons   (keyless, geosearch)
  ├─ OSM-Tags  (exakt)
  └─ Mapillary (Token als Secret, optional)
        │
        ▼
Score + Lizenz + Attribution + Confidence
        │
        ▼
JSON-Shards (nach Land/Geohash)
        │
        ▼
App: Place-Card lädt Shard, zeigt Top-Bild oder nichts
```

### 6.2 Warum vorberechnen?

- Kein API-Key im Client.
- Keine Latenz beim Öffnen der Karte.
- Keine Rate-Limit-Probleme durch viele Nutzer.
- Lizenzen/Attributionen können zentral geprüft werden.
- „Kein Bild“ ist ein gültiger Zustand; kein leeres Hero.

### 6.3 Provider-Reihenfolge

1. **Exakter OSM-/Wikidata-Tag** (höchste Präzision)
2. **Panoramax Place Search** (`place_position`, `place_distance=3-25`, `place_fov_tolerance<=45`)
3. **Mapillary** (falls Proxy/Index vorhanden; `on_foot`, `quality_score`, Heading)
4. **KartaView** (keyless Fallback)
5. **Commons Geosearch** (nur mit Namens-/Kategorie-Match, sonst zu unpräzise)
6. **Kein Bild** (nichts anzeigen)

### 6.4 Scoring

Beispiel:

```ts
function scoreCandidate(c: Candidate, poi: Poi): number {
  const headingScore =
    c.heading == null
      ? 1
      : Math.max(0, 1 - angleDiff(c.heading, bearing(c, poi)) / 90);
  const distanceScore = Math.max(0, 1 - c.distance / 40);
  const quality = c.quality ?? 0.5;
  const ageYears = (Date.now() - +new Date(c.capturedAt)) / 31_557_600_000;
  const recency = Math.exp(-ageYears / 6);
  const resolution = Math.min(1, Math.min(c.width, c.height) / 1080);
  const panoPenalty = c.isPano ? 0.12 : 0;

  return (
    0.40 * headingScore +
    0.25 * distanceScore +
    0.15 * quality +
    0.10 * recency +
    0.10 * resolution -
    panoPenalty
  );
}
```

Schwellen:

- `>= 0.75`: Hero-Bild
- `0.55–0.75`: kleines „Street View nearby“-Thumbnail
- `< 0.55`: kein Bild

Zusätzlich:

- Exakter OSM-Tag → `confidence: "exact"`, Score-Override.
- Kein Heading (360°) → nur als Kontext, nicht als Fassade.
- `distance > 40 m` → verwerfen.
- `heading error > 60°` → verwerfen.
- `width < 800` → verwerfen.
- Eine Bild-ID pro Sequenz.

### 6.5 Index-Format

```json
{
  "version": 1,
  "generatedAt": "2026-11-18T18:00:00Z",
  "places": {
    "osm:node:123456": {
      "images": [
        {
          "provider": "panoramax",
          "id": "37f6c5a0-…",
          "thumb": "https://…/thumb.jpg",
          "full": "https://…/sd.jpg",
          "width": 2048,
          "height": 1365,
          "lat": 48.854798,
          "lon": 2.354798,
          "heading": 25,
          "distance": 8.2,
          "headingError": 12,
          "capturedAt": "2025-05-21",
          "license": "CC-BY-SA-4.0",
          "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
          "attribution": "© Britzz / Panoramax",
          "sourceUrl": "https://…",
          "score": 0.93,
          "confidence": "facade"
        }
      ]
    }
  }
}
```

- Nach Land/Geohash sharden; nicht eine 100-MB-Datei.
- Bilder nur hotlinken, nicht rehosten (außer Lizenz erlaubt es ausdrücklich).
- Mapillary: keine Thumb-URL speichern (TTL); nur ID + Metadaten, URL zur Laufzeit über Proxy/Embed.

### 6.6 Runtime

- Beim Öffnen der Place-Card: Shard per `placeId` oder Geohash laden.
- Top-Bild anzeigen, Attribution + Lizenz + Provider-Link.
- Button „Street View öffnen“ → Panoramax/Mapillary/KartaView-Viewer.
- Kein Bild → Hero komplett weglassen (bereits umgesetzt).
- Während aktiver Navigation: keine Mapillary/Mapilio-Bilder (Terms).

---

## 7. Automatisierung: konkreter Ablauf

1. **POI-Liste** aus OSM-Extrakt/OpenFreeMap erzeugen; nur benannte Places mit Kategorie.
2. **Provider-Abfragen** pro POI oder pro 100-m-Raster:
   - Panoramax: `place_position`, 1 Request; Fallback BBox.
   - KartaView: `photo/?lat&lng&radius=50`.
   - Commons: 1 Request pro 500-m-Zelle, dann nearest match.
   - Mapillary: 1 Request pro POI (Token, Secret), wenn Proxy/Index gewünscht.
3. **Filtern**: Lizenz, Auflösung, Distanz, Heading, Status.
4. **Scoren** und pro POI max. 1–3 Bilder behalten.
5. **Index schreiben** (JSON, geshardet), Coverage-Report erzeugen.
6. **App** lädt Shards; bei fehlendem Bild bleibt der Hero leer.
7. **Wöchentlich** neu laufen; nur neue/geänderte POIs; Mapillary-Thumbs nicht cachen.

**Kosten:**

- Panoramax/KartaView/Commons: 0 €.
- Mapillary: 0 € API, aber Token/Proxy.
- GitHub Actions: wenige Minuten pro Region.
- Google: $7/1k; nicht für Massenlauf.

---

## 8. Recht & Produkt

- **Attribution ist Pflicht** bei allen offenen Quellen. Lizenz + Urheber + Link sichtbar.
- **CC BY-SA**: Bearbeitungen (z. B. Crops) müssen Share-Alike erfüllen; nicht als „eigenes“ Bild ausgeben.
- **Mapillary/Mapilio**: keine Nutzung in Echtzeit-Navigation; Logo-Attribution.
- **Google**: kein Caching/Bulk; Author-Attribution; Google-Maps-Link; Key schützen.
- **Datenschutz**: Gesichter/Kennzeichen sind provider-seitig geblurrt; nicht de-blurren. Keine privaten Wohnhäuser als „Sehenswürdigkeit“ bebildern. Report-/Entfernen-Link anbieten.
- **Kein Bild ist besser als ein falsches Bild.** Confidence-Schwelle und „Street view nearby“-Label statt „Foto von X“.

---

## 9. Optionen-Pitch

### Option A — „Open Photo Layer“ (Empfehlung)

Panoramax + KartaView + Commons/OSM, build-time Index, keyless.

- **Kosten:** 0 € marginal
- **Backend:** keins
- **Abdeckung:** FR sehr gut, DACH-Städte gut, ländlich lückenhaft
- **Recht:** sauber mit Attribution
- **Aufwand:** Phase 1 in 1–2 Tagen

### Option B — „Open + Mapillary Proxy“

Option A + Cloudflare Worker für frische Mapillary-Thumbnails (Token versteckt).

- **Kosten:** Worker-Free-Tier, Mapillary 0 €
- **Backend:** ein kleiner Worker
- **Abdeckung:** deutlich besser global
- **Recht:** Mapillary-Logo, keine Navigation
- **Aufwand:** +2–3 Tage

### Option C — „Google Premium“

Google Street View/Places Photos on demand über Proxy.

- **Kosten:** $7/1k, Billing, Limits
- **Backend:** Proxy zwingend
- **Abdeckung:** beste
- **Recht:** kein Caching, Attribution, EEA-Terms
- **Aufwand:** hoch; nicht für alle Places

**Empfehlung:** A jetzt, B als Ausbau, C nur für einzelne Premium-Orte.

---

## 10. Nächste Schritte (Phase 1)

1. `PlaceImage`-Typ + Provider-Interface.
2. Panoramax-Adapter (`/api/search?place_position=…`).
3. KartaView-Adapter (`/2.0/photo/`).
4. Commons-Adapter (Geosearch + Lizenzfilter).
5. OSM-Tag-Adapter (`wikimedia_commons`, `panoramax`, `mapillary`).
6. Scoring + Confidence + „kein Bild“-Fallback.
7. Build-Skript + JSON-Shards + Coverage-Report.
8. Place-Card: Hero, Attribution, „Street View öffnen“.
9. Mapillary erst in Phase 2 über Proxy/Embed.

---

## 11. Verifikationslog (2026-11-18)

| Test | Ergebnis |
|---|---|
| `GET https://api.panoramax.xyz/api/search?place_position=2.354798,48.854787&place_distance=3-50&place_fov_tolerance=60&limit=2` | 200, 2 Features, `view:azimuth=25`, CC-BY-SA-4.0 |
| Panoramax Asset `sd.jpg` | 200, `access-control-allow-origin: *`, image/jpeg |
| `GET https://api.kartaview.org/2.0/photo/?lat=52.52&lng=13.405&radius=50` | 200, Treffer 9,13 m, `heading`, `imageLthUrl` |
| KartaView CDN-Bild | 200, `access-control-allow-origin: *` |
| Commons `generator=geosearch&ggsnamespace=6` | 200, `access-control-allow-origin: *`, File-Seiten mit `imageinfo` |
| Mapillary API-Doku | Radius max. 50 m, limit max. 100, bbox < 0,01°, `on_foot`, `quality_score` |
| Mapillary Thumbnail-TTL | bestätigt: URLs sind signiert und laufen nach ca. 30 Tagen ab |
| Google Street View Static | $7/1k nach 10k frei, max. 640×640, kein Caching/Bulk |
| Google Places Photos | $7/1k, max. 10 Fotos/Place, kein Caching, Autor-Attribution |

---

## 12. Quellen

- Panoramax API / Metakatalog: https://api.panoramax.xyz/api
- Panoramax Federation/Lizenzen: https://docs.panoramax.fr/federated-catalog
- Panoramax Instanzen: https://api.panoramax.xyz/instances
- Mapillary API: https://mapillary.com/developer/api-documentation
- Mapillary Terms: https://mapillary.com/terms
- Mapillary API v4 Thumbnail-TTL: https://blog.mapillary.com/update/2021/06/23/getting-started-with-the-new-mapillary-api-v4.html
- KartaView API: https://kartaview.org/doc/photos
- Mapilio: https://mapilio.com/developer
- OSM Street-level imagery services: https://wiki.openstreetmap.org/wiki/Street-level_imagery_services
- OSM photo linking: https://wiki.openstreetmap.org/wiki/Photo_linking
- Wikimedia Commons Geosearch: https://www.mediawiki.org/wiki/API:Geosearch
- Commons search by location: https://commons.wikimedia.org/wiki/Commons:Search_by_location
- Google Street View Static policies: https://developers.google.com/maps/documentation/streetview/policies
- Google Maps pricing: https://developers.google.com/maps/billing-and-pricing/pricing
- Google Places policies: https://developers.google.com/maps/documentation/places/web-service/policies
- Geograph API: https://www.geograph.org.uk/help/api
