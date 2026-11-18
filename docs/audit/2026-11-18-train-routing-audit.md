# Kritisches Audit: Train-/ÖPNV-Routing (TransitPanel)

**Datum:** 2026-11-18  
**Gegenstand:** `Train`-Modus in `RoutesPanel` (`src/components/planner/TransitPanel.tsx`), MOTIS-Provider, Transit-Store, Karten-Layer und Transit-Navigation.  
**Methode:** Statische Codeprüfung mit `Datei:Zeile`-Belegen, Live-Requests gegen `api.transitous.org` (MOTIS-2) und Abgleich mit den vorhandenen Audit-/Implementierungsdokumenten. Kein vollständiger Browser-QA-Lauf; reine UI-Wirkungen sind als solche gekennzeichnet.

**Baseline, verifiziert:**

| Check | Ergebnis |
|---|---|
| `npm test` | 63 Tests, 7 Dateien, alle grün |
| `npm run lint` | sauber |
| MOTIS `/plan` live | 200, `itineraries`, `direct`, `previousPageCursor`, `nextPageCursor`, `itinerary.id`, `stop.tz`, `routeColor`, `wheelchairAccessible`, `bikesAllowed`, `reservation` vorhanden |
| MOTIS `pageCursor` live | funktioniert; liefert die nächste Verbindungsseite |
| MOTIS `fromPlace=<stopId>` live | funktioniert; liefert den exakten Stop statt einer Koordinaten-Snappung |

---

## 1. Kurzfazit

Die Transit-Anbindung ist technisch sauber angefangen: abortbare Requests, normalisierte Fehler, Polyline-Dekodierung, Realzeit-/Cancel-Flags und ein eigener Store. Für **tägliche Nutzung** ist sie aber noch kein verlässliches Produkt. Die größten Probleme sind nicht fehlende Extras, sondern **falsche oder irreführende Informationen**:

1. **Zeitzonen werden ignoriert.** Alle Zeiten werden in der Browser-Zeitzone formatiert, obwohl MOTIS pro Stop eine `tz` liefert. Fahrten über Zeitzonengrenzen oder Nutzer außerhalb der Zielzeitzone sehen falsche Abfahrten.
2. **Die Eingabe kann veralten.** Wer nach der Auswahl den Text im From/To-Feld ändert, ohne einen neuen Vorschlag zu wählen, sucht weiter mit den **alten** Koordinaten.
3. **Asynchrone Rennen.** Eine laufende Suche wird beim Ändern von From/To nicht abgebrochen; die Nearest-Station-Suche kann eine neuere Auswahl überschreiben.
4. **„Nearest station“ ist oft falsch und für das Routing irrelevant.** Die Anzeige entsteht aus einer Textsuche, während MOTIS mit den Adresskoordinaten selbst einen anderen Zustieg wählt.
5. **„Stadt filtern“ filtert keine Verbindungen.** Das Feld beeinflusst nur die Haltestellensuche.
6. **Angezeigte Zeit ≠ gesuchte Zeit.** Bei leerem Zeitfeld wird die Anzeige bei jedem Render neu berechnet, die Suche ruft `defaultWhen()` erneut auf; zusätzlich wird auf die nächste 5-Minuten-Marke **aufgerundet**. Der 2-Minuten-Zug wird verpasst.
7. **Transit-Navigation führt nicht zum Ausstieg.** Sie zeigt das Endziel des Zuges (Headsign), nicht die Ausstiegsstation; der nächste Leg-Abstand wird berechnet, aber nicht angezeigt; die aktuelle Leg wird nach Wanduhr statt nach Position bestimmt.
8. **Off-Route-Hinweis verweist auf eine nicht existierende Funktion.** „Return to the highlighted line or recalculate“ — es gibt keinen Recalculate-Button.

Dazu kommt eine lange Liste fehlender Daily-Use-Features: Favoriten/Home/Work, „mein Standort“, Kartenklick, frühere/spätere Verbindungen, Plattformwechsel, Umstiegswarnungen, Live-Aktualisierung, Linienfarben, Barrierefreiheit, Fahrradmitnahme, Reservierung, Teilen und Offline-Cache.

---

## 2. P0 — falsche oder irreführende Ergebnisse

### P0-1: Zeitzonen werden komplett ignoriert

**Beleg:** `src/lib/routing/format.ts:26-43` formatiert mit `Intl.DateTimeFormat` ohne `timeZone`. `TransitStopRef` (`src/lib/routing/types.ts:59-67`) hat kein `tz`-Feld; `parseStop` (`src/lib/routing/providers/motis.ts:125-139`) liest `tz` nicht. MOTIS liefert `tz` pro Stop (live verifiziert, z. B. `Europe/Berlin`, `Europe/Zurich`).

**Wirkung:** Eine Fahrt Basel → Berlin wird in der Browser-Zeitzone angezeigt. Ein Nutzer in Deutschland sieht die Basler Abfahrt eine Stunde falsch; ein Nutzer in den USA sieht alle Zeiten falsch. Auch das `datetime-local`-Feld ist Browser-Zeit, nicht Zeit der Abfahrtsstation. Bei Fahrten über Zeitzonengrenzen ist die Anzeige damit sachlich falsch.

**Fix:** `tz` in `TransitStopRef` und `TransitLeg` aufnehmen; pro Leg/Stop mit `Intl.DateTimeFormat(..., { timeZone: stop.tz })` formatieren; im UI „Ortszeit“ kennzeichnen; für das Eingabefeld entweder die Zeitzone der Origin zeigen oder klar als „deine Zeit“ beschriften.

---

### P0-2: Editieren des From/To-Feldes lässt die alte Auswahl stehen

**Beleg:** `PlacePicker` ändert bei `onChange` nur `q` (`src/components/planner/PlacePicker.tsx:229-256`); `onPick(null)` gibt es nicht. `TransitPanel.search` verwendet ausschließlich `from.lat/lon` (`src/components/planner/TransitPanel.tsx:80-92`).

**Wirkung:** Nutzer wählt „Mannheim Hbf“, tippt dann „Heidelberg Hbf“, sieht Vorschläge, drückt aber direkt „Find connections“ ohne einen Vorschlag zu wählen. Die Suche läuft mit **Mannheim**. Das ist ein klassischer Daily-Use-Fehler und schwer zu bemerken, weil das Feld den neuen Text zeigt.

**Fix:** Bei jeder Texteingabe die Auswahl invalidieren (`onPick(null)` bzw. `setFrom(null)`) und den Suchbutton deaktivieren, solange Text ≠ ausgewählter Ort. Zusätzlich Clear-Button und „Auswahl“-Chip.

---

### P0-3: Laufende Requests werden nicht abgebrochen; mehrere Races

**Beleg:**
- `search` abortet nur den vorherigen Search-Request (`TransitPanel.tsx:74-76`). `setFrom`/`setTo`/`swap` (`src/lib/planner/transitStore.ts:80-91`) aborten nichts.
- Kein `useEffect`-Cleanup in `TransitPanel`, d. h. beim Moduswechsel/Unmount läuft die Suche weiter und schreibt in den Store.
- `findNearestStation` wird ohne `AbortSignal` aufgerufen (`PlacePicker.tsx:203-221`); `choose` hat keine Request-Generation. Eine langsame Station-Suche für Auswahl A kann nach Auswahl B `onPick(A)` ausführen.

**Wirkung:** Ergebnisse für eine alte Origin/Destination erscheinen unter der neuen Eingabe; eine neuere Auswahl wird durch eine ältere überschrieben. Besonders ärgerlich auf Mobile mit langsamer Verbindung.

**Fix:** `AbortController` in `setFrom`/`setTo`/`swap` und im Unmount-Cleanup aborten; pro `choose` eine Generation/ID vergeben und nur die letzte Antwort anwenden; `findNearestStation` mit Signal und Timeout ausstatten.

---

### P0-4: „Nearest station“ ist eine Textsuche und für das Routing nicht maßgeblich

**Beleg:** `findNearestStation` (`src/lib/planner/nearestStation.ts:49-107`) fragt `geocodeStops` mit dem Adressnamen/dem Stadtnamen ab und wählt aus den Texttreffern den geografisch nächsten. `TransitPanel` routet aber mit den Adresskoordinaten (`TransitPanel.tsx:82-85`), nicht mit `from.station`. MOTIS berechnet den Zustieg selbst.

**Wirkung:** Angezeigt wird z. B. „Nearest station: Heidelberg Hbf (350 m)“, während die tatsächlich geplante Journey zu „Bismarckplatz“ läuft. Die Anzeige ist dann keine Eigenschaft der Verbindung, sondern eine unabhängige, oft falsche Schätzung. Bei fehlenden Texttreffern wird aus den ersten 40 Stadt-Stops der nächste gewählt — das kann Kilometer daneben liegen. Der Hinweis „No station found nearby; routing from the address“ suggeriert einen Fallback, obwohl MOTIS ohnehin immer von der Adresse routet.

**Fix:** Entweder die Anzeige entfernen und nur die echte erste/letzte Leg der Journey zeigen, oder `findNearestStation` räumlich (Overpass/Stop-Index) lösen und die **tatsächlich verwendete** Station aus der Journey ableiten. Wenn die Station das Routing bestimmen soll, `fromPlace=<stopId>` senden.

---

### P0-5: „Stadt filtern“ filtert die Verbindungen nicht

**Beleg:** `cityFilter` wird nur an die beiden `PlacePicker` übergeben (`TransitPanel.tsx:149-178`). Die Ergebnisliste (`:341-349`) filtert nicht danach. Das Label lautet aber „Stadt filtern (optional)“ (`:196`).

**Wirkung:** Nutzer tippt „Berlin“, erwartet gefilterte Verbindungen, bekommt aber unverändert alle Ergebnisse. Das Feld ändert nur, welche Haltestellen/Adressen im Dropdown erscheinen — und löst dort bei jedem Tastendruck neue Geocode-Requests aus.

**Fix:** Entweder umbenennen („Stadt für Haltestellensuche“) oder tatsächlich auf `journeys` anwenden (z. B. alle Legs/Stops in der Stadt) und das Ergebnis sichtbar aktualisieren.

---

### P0-6: Angezeigte Zeit, gesuchte Zeit und 5-Minuten-Rundung passen nicht zusammen

**Beleg:** Das Eingabefeld hat `value={when || defaultWhen()}` (`TransitPanel.tsx:275-281`), die Suche berechnet `new Date(when || defaultWhen())` erneut (`:86`). `defaultWhen` rundet auf die nächste 5-Minuten-Marke **auf** (`transitStore.ts:56-63`).

**Wirkung:**
- Bei leerem `when` zeigt das Feld 10:05, die Suche um 10:06 verwendet 10:10. Anzeige und Anfrage divergieren.
- Um 10:01 wird 10:05 gesucht; der Zug um 10:02 fehlt. Für Pendler ist das ein direkter Fehler.
- Ein bereits vergangener Zeitpunkt kann eingegeben werden; es gibt keine Validierung und keinen Hinweis.
- Ein explizites „Jetzt“ gibt es nicht.

**Fix:** Beim ersten Rendern `when` einmalig setzen (oder `now` als eigenen Zustand), Anzeige und Request aus derselben Quelle speisen, „Jetzt“-Button, `min`-Attribut, optional Kulanzfenster von 1–2 Minuten in der Vergangenheit.

---

### P0-7: Transit-Navigation zeigt nicht, wo man aussteigen muss

**Beleg:** `NavigationOverlay` wählt die aktuelle Leg nach Wanduhr (`src/components/navigation/NavigationOverlay.tsx:64-74`). Der Top-Titel zeigt `${line} to ${headsign ?? to.name}` (`:107-108`) — also das **Endziel des Zuges**, nicht die Ausstiegsstation. `nextDistanceM` wird in `progress.ts` berechnet (`:95-97`), im Transit-Overlay aber nicht angezeigt. Der Fortschritt wird bei vorhandenem GPS aus der Route, sonst aus der Wanduhr berechnet (`:86-92`).

**Wirkung:** Bei „ICE 374 to S+U Berlin Hauptbahnhof“ steigt der Nutzer in Mannheim aus; die App sagt aber weiter „to Berlin“. Es gibt keinen Countdown „noch 2 Stationen / 8 min bis Mannheim“, keinen Hinweis auf den Umstieg und keine Ausstiegserinnerung. Nach Ende der Journey fällt `currentLeg` auf `legs[0]` zurück und zeigt ewig die erste Leg.

**Fix:** Aktuelle Leg aus GPS/Progress (nicht nur Uhr) bestimmen; „Aussteigen in <to.name>“ als primäre Zeile; `nextDistanceM`/Restzeit bis Leg-Ende anzeigen; „Umstieg in X, Gleis Y“; nach Arrival einen Endzustand statt `legs[0]`.

---

### P0-8: „Start journey“ ist für vergangene/abgesagte Verbindungen aktiv, und der Off-Route-Hinweis hat keine Aktion

**Beleg:** `JourneyDetail` bietet „Start journey“ ohne Prüfung von `departure`/`cancelled` (`TransitPanel.tsx:465-479`). `NavigationOverlay` sagt „Return to the highlighted line or recalculate“ (`:117-118`), aber es gibt keinen Recalculate-Handler. `NavigationOverlay` hat nur Mute/Follow/End (`:150-177`).

**Wirkung:** Ein bereits abgefahrener oder annullierter Zug kann „gestartet“ werden; die App zeigt dann eine vergangene Leg. Bei Off-Route (z. B. falscher Zug, Umleitung, parallele Trasse) gibt es keinen Ausweg außer „End“ und manueller Neusuche.

**Fix:** Start bei `departure < now` und bei `cancelled` sperren bzw. warnen; „Neu berechnen“ im Overlay, das `planRoutes` mit aktueller Position/Zeit aufruft; Off-Route-Text nur zeigen, wenn die Aktion existiert.

---

## 3. P1 — funktionale Fehler und falsche Detailtreue

| ID | Befund | Beleg | Wirkung / Fix |
|---|---|---|---|
| P1-1 | **`START`/`END` erscheinen in der Detailansicht** | `JourneyDetail` zeigt `leg.from.name` / `leg.to.name` (`TransitPanel.tsx:524-535`); MOTIS nennt Koordinaten-Origins live `START`/`END` | Der Nutzer sieht „START“ statt seiner Adresse. Ersetzen durch `from.name`/`to.name` des Pickers oder die Leg-Endpunkte humanisieren. |
| P1-2 | **Headsign wird doppelt angezeigt** | `to {leg.to.name} · {platform} · {headsign}` (`TransitPanel.tsx:529-535`); live: `to.name = "Mannheim, Hauptbahnhof"`, `headsign = "Mannheim, Hauptbahnhof"` | „to Mannheim, Hauptbahnhof · 9 · Mannheim, Hauptbahnhof“. Headsign nur zeigen, wenn er sich vom Ziel unterscheidet; als „Richtung …“ labeln. |
| P1-3 | **Kein Tageswechsel/kein Datum** | Karten und Detail zeigen nur `formatClock` (`TransitPanel.tsx:409-414`, `:486-491`); `formatClock` liefert nur HH:MM (`format.ts:26-43`) | 23:00 → 01:00 sieht aus wie eine 2-Stunden-Fahrt ohne „+1“. Bei Suche für morgen ist nicht erkennbar, welcher Tag gilt. Datum/+1-Tag ergänzen. |
| P1-4 | **ODM (On-Demand) wird als Fußweg klassifiziert** | `normalizeLegMode`: `WALK || ODM → "walk"` (`motis.ts:141-147`) | On-Demand-Verkehr erscheint als „walk“, zählt nicht als Transit-Leg, Transfers stimmen nicht, Ansage sagt „Walk to …“. Eigenen Modus/`transit` mit Rohmode ODM einführen. |
| P1-5 | **Verspätung nur beim Abfahren, nie beim Ankommen; früher als geplant wird verschluckt** | `delayMinutes` vergleicht nur `departure` vs. `scheduledDeparture` (`TransitPanel.tsx:374-379`); Anzeige nur `delay > 0` (`:517-519`) | Ankunftsverspätung und Verfrühung sind unsichtbar. Beide Zeitpunkte prüfen, Vorzeichen anzeigen, Verspätung entlang der Legs propagieren. |
| P1-6 | **„Live“ kann durch einen Fußweg ausgelöst werden** | `t.legs.some(l => l.realTime)` (`TransitPanel.tsx:448-450`); live haben auch WALK-Legs `realTime` | „Live“-Badge ohne echte Echtzeitdaten der Bahn. Nur Transit-Legs zählen; zusätzlich „keine Echtzeitdaten“ anzeigen. |
| P1-7 | **Alte Ergebnisse bleiben bei Fehler/neuer Suche stehen** | `search` leert `journeys` nicht (`TransitPanel.tsx:69-113`); bei Fehler nur `phase = error` (`:96-101`) | Nach Zeit-/Filteränderung und Fehler sieht der Nutzer alte Verbindungen, als wären sie aktuell. Ergebnisse leeren oder klar als „veraltet“ markieren. |
| P1-8 | **Stale Notice bleibt nach Eingabeänderung** | `setFrom`/`setTo`/`swap` setzen `notice` nicht zurück (`transitStore.ts:80-91`) | „No connections found for this time.“ bleibt stehen, obwohl eine neue Destination gewählt wurde. Bei jeder Eingabe `notice = null`. |
| P1-9 | **Kein Auto-Refresh, kein „zuletzt aktualisiert“** | Kein Polling/Visibility-Refresh in `TransitPanel` | Realzeitdaten veralten nach der Suche. Bei einer 5-Stunden-Fahrt ist die Ankunft nach 30 Minuten nicht mehr aktuell. Refresh-Intervall + Zeitstempel. |
| P1-10 | **„3+“ bedeutet exakt 3** | UI-Label `n === 3 ? "3+" : n` (`TransitPanel.tsx:294`), setzt aber `maxTransfers = 3` (`:292`); Store erlaubt 0–5 (`transitStore.ts:94-95`) | Label lügt. Entweder „3“ nennen oder 4/5/unbegrenzt anbieten. |
| P1-11 | **„Best“ ist nur Index 0** | `index === 0 && <span>Best</span>` (`TransitPanel.tsx:443`) | Keine berechnete Empfehlung; nach Sortierung/Filterung beliebig. Entweder echte Heuristik (Dauer/Umstiege/Gehweg) oder Label entfernen. |
| P1-12 | **Keine Plattformwechsel-/Umstiegswarnung** | Detail zeigt Plattform nur als `· 2` (`TransitPanel.tsx:524-535`); keine Transferzeit | 0-Minuten-Umstiege (live: Walk 09:10 → Zug 09:10) werden nicht markiert. „Gleis 2 → Gleis 9, 0 min“ mit Warnung bei < 5 min. |
| P1-13 | **Fußwegdauer fehlt** | Karte zeigt nur „walk“ (`TransitPanel.tsx:419-421`); Detail „Walk 0.3 km“ ohne Dauer (`:508-510`) | 3 min vs. 15 min Gehweg ist der wichtigste Unterschied. Dauer aus Leg-Zeiten berechnen und anzeigen. |
| P1-14 | **Keine Linienfarben/-typen** | `transitFeatures` nutzt eine Farbe (`usePlannerLayers.ts:17,171`); `routeColor`/`routeType` werden nicht gelesen | Alle Linien sehen gleich aus; S-Bahn/ICE/Bus/Tram nicht unterscheidbar. `routeColor` + Icons verwenden. |
| P1-15 | **Barrierefreiheit wird versteckt** | `wheelchairAccessible` wird nicht geparst (live: `NOT_ACCESSIBLE` pro Leg); UI sagt nur „Prefer accessible“ (`TransitPanel.tsx:299-315`) | Der Nutzer erfährt nicht, dass die konkrete Verbindung nicht barrierefrei ist. Pro Leg anzeigen und hart filtern (`requireWheelchairAccessible`). |
| P1-16 | **Fahrradmitnahme/Reservierung fehlen** | `bikesAllowed`, `reservation` live vorhanden, nicht im Typ/UI | Für Pendler mit Rad und für ICE/EC relevant. Anzeigen und filtern. |
| P1-17 | **Keine früheren/späteren Verbindungen** | `previousPageCursor`/`nextPageCursor` werden ignoriert (`motis.ts:449-464`); live verifiziert, `pageCursor` funktioniert | Nur 4 Ergebnisse, kein „später“. Pagination-Buttons ergänzen. |
| P1-18 | **Stop-ID wird nicht verwendet** | `TransitPlace.id` existiert (`transitStore.ts:8-25`), `planMotis` bekommt nur `lat/lon` (`TransitPanel.tsx:82-85`); `fromPlace=<stopId>` live verifiziert | MOTIS snappt Koordinaten; bei großen Bahnhöfen kann der falsche Eingang/Stop gewählt werden. Bei Stops die ID senden. |
| P1-19 | **Keine Modus-/Gehwegfilter** | `planMotis` sendet weder `transitModes`, `maxPreTransitTime`, `maxPostTransitTime`, `requireBikesAllowed` noch `requireWheelchairAccessible` (`motis.ts:419-437`) | 25-Minuten-Fußweg zum Bahnhof ist nicht vermeidbar; Bus/Bahn nicht filterbar. Filterleiste ergänzen. |
| P1-20 | **Rohe Providerfehler, `retryAfterS` ungenutzt** | `search` zeigt `err.message` (`TransitPanel.tsx:98-101`); `retryAfterS` wird geparst (`http.ts:74`), aber nirgends angezeigt | „HTTP 429: …“ statt „Zu viele Anfragen, in 30 s erneut“. Freundliche Fehlertexte + Retry. |
| P1-21 | **Kein Cache, kein Request-Budget** | Jede Suche/Refresh ist ein `/plan`-Call; keine Cache-Schicht | Dokumentiertes Limit: 720 `/plan`/24 h/IP (`docs/audit/2026-11-17-implementation-summary.md:86`). Ein Vielnutzer kann das an einem Tag ausschöpfen. Identische Suchen cachen, Refresh drosseln, Hinweis anzeigen. |
| P1-22 | **Keine UI-/Navigations-Tests** | Testliste: `format`, `http`, `engine`, `brouter`, `valhalla`, `motis`, `hiking`; kein `TransitPanel`, `transitStore`, `nearestStation`, `progress` mit Transit, `NavigationOverlay` | Die oben genannten Fehler sind alle ungetestet. Mindestens: Zeitformatierung mit `tz`, From/To-Invalidierung, Race-Abbruch, `ODM`, `delay`, `currentLeg`. |

---

## 4. Quality-of-Life-Lücken für tägliche Nutzung

### 4.1 Eingabe und Orte

- **Keine Favoriten / Home / Work.** Jeden Tag dieselben zwei Orte neu suchen.
- **Keine letzten Suchen / Recent Places.** Der Store persistiert nur die aktuelle Auswahl.
- **Kein „Mein Standort“ als Origin.** Die App hat bereits Live-Location/Geolocation; der Transit-Modus nutzt sie nicht.
- **Kein Kartenklick/Long-Press zum Setzen von From/To.** Bei Wander-/Auto-Routing gibt es Karteninteraktion; hier nicht.
- **Kein Clear-Button** für From/To; nach einer Auswahl ist Löschen nur durch Überschreiben möglich.
- **Kein „Keine Treffer“- und kein Fehlerzustand** im Dropdown: `Promise.allSettled` schluckt Fehler (`PlacePicker.tsx:99-124`), das Dropdown bleibt leer.
- **Kein „Swap und suchen“**: `swap` leert die Ergebnisse (`transitStore.ts:84-91`), statt automatisch neu zu suchen.
- **Keine Datums-Schnellwahl** (Heute, Morgen, +1 h, „Jetzt“); nur der native `datetime-local`-Picker.
- **Kein „via“-Halt.** MOTIS kann nur From/To; die UI bietet keine Zwischenstation.
- **Stadtfilter ist kein echter Filter** (siehe P0-5) und wird als Freitext ohne Autocomplete eingegeben.
- **Keine Vorschlags-Gruppierung** (Bahnhof vs. Adresse ist nur ein Textlabel; keine Icons, keine Entfernung).
- **Keine Anzeige der Gehzeit zur Haltestelle** bereits bei der Auswahl.

### 4.2 Ergebnisse

- **Keine Sortierung/Filter:** schnellste, wenigste Umstiege, direkt, wenigste Gehwege, barrierefrei, Fahrrad.
- **Keine „früher/später“-Buttons** trotz vorhandener Cursors.
- **Keine Plattform in der Kartenübersicht.** Der Nutzer muss die Detailansicht öffnen.
- **Keine Umstiegsstationen in der Karte.** Nur „1 change“; nicht „in Mannheim“.
- **Keine Gehzeit/-distanz pro Verbindung** in der Übersicht.
- **Keine Verspätungs-/Ausfall-Alternative:** Bei „Cancelled“ bleibt nur manuelle Neusuche.
- **Keine Live-Aktualisierung** und kein „zuletzt aktualisiert“.
- **Kein Teilen/Link** auf eine konkrete Verbindung.
- **Kein „Zum Kalender hinzufügen“.**
- **Keine Preis-/CO2-/Auslastungsinfo** (falls die Feeds es liefern; Fares sind regional oft nicht vorhanden, dann klar als „unbekannt“ kennzeichnen).
- **Keine Anzeige von „reservation required“ / „bikes allowed“ / „wheelchair accessible“** (siehe P1-15/16).
- **Keine Zwischenhalte** trotz geparster `intermediateStops` (`motis.ts:177-186`, `:257-258`); der Nutzer kann nicht prüfen, ob sein Ziel angefahren wird.
- **Keine Leg-Dauer und keine Wartezeit** in der Detailansicht.

### 4.3 Karte

- **Alle Bahnlinien in einer Farbe** (`usePlannerLayers.ts:17`), obwohl `routeColor`/`routeTextColor` geliefert werden.
- **Keine Linien-/Haltestellen-Labels**; nur namenlose Punkte (`usePlannerLayers.ts:78-84`, `:188-198`).
- **Keine Klick-Popups** auf Haltestellen (Name, Zeit, Gleis).
- **Keine Hervorhebung der aktuell gewählten Leg**; die ganze Journey ist eine Linie.
- **Keine Richtungspfeile**; bei Ringlinien/Umstiegen ist die Fahrtrichtung nicht erkennbar.
- **Keine gestrichelte/rote Darstellung für cancelled Legs.**
- **Keine Legende** für Ride/Walk/Transfer.
- **`fitBounds` bricht ab, wenn die Karte gerade bewegt wird** (`TransitPanel.tsx:119-120`) und versucht es nie erneut; bei einer einzelnen Verbindung bleibt die Karte dann falsch.
- **Feste 280-px-Unterkante auf Mobile** (`:138`) passt weder zu Peek (56 px) noch zu Full (~100dvh); die Route liegt hinter dem Sheet.

### 4.4 Navigation

- **Kein Ausstiegsalarm / „noch 2 Stationen“** (siehe P0-7).
- **Kein Umstiegshinweis** („Umstieg in Mannheim, Gleis 9, 4 min“).
- **Keine Plattform** im Overlay.
- **Keine Live-Verspätung** während der Fahrt; die Planzeiten sind eingefroren.
- **Keine Auswahl „nach Fahrplan“ vs. „nach GPS“.** In Tunneln/Zügen ist GPS unzuverlässig; die App hat keinen Schedule-Follow-Modus.
- **Kein „Start at departure time“**; „Start journey“ aktiviert GPS/Wake-Lock sofort, auch wenn die Fahrt erst in 3 Stunden beginnt.
- **Kein Battery-Saver**: `enableHighAccuracy: true`, `maximumAge: 0` und Wake-Lock (`useNavigation.ts:72-94`, `:207-223`) sind für eine lange Bahnfahrt teuer.
- **Kein „Journey anzeigen“ während der Navigation**: `[data-navigating="true"] .hud-bottom-sheet { display:none }` (`globals.css:1236`); der Nutzer kann die Umstiegsliste nicht mehr öffnen.
- **Kein Recalculate** (siehe P0-8).
- **Preview ist für Fernverkehr unbrauchbar**: `simSpeed` für Transit = 25 m/s (`useNavigation.ts:22-33`); eine 600-km-Fahrt dauert in der Vorschau 6,7 Stunden. Zeitraffer (z. B. 60x) oder leg-basierte Simulation.
- **Kamera folgt mit `zoom: max(15, current)`** (`useNavigation.ts:184-204`); bei einer Fernfahrt gibt es keine Übersicht.
- **Walk-only-Itineraries werden als Transit behandelt**: `isTransit = plan.mode === "transit" && transitLeg != null` (`NavigationOverlay.tsx:75`); bei einem reinen Fußweg-Itinerary zeigt die App ein Train-Glyph und „WALK to …“.
- **Erste Leg-Ansage wird übersprungen**: `progress.next` sucht `startIndex > best.index + 1` (`progress.ts:90-93`); beim Start wird die erste Leg (z. B. „Walk to station“) nie angesagt, stattdessen direkt der Zug.
- **Wake-Lock wird nach Visibility-Wechsel nicht neu angefordert**; Browser geben ihn beim Verstecken frei.

### 4.5 Robustheit und Zustand

- **Kein Offline-/Last-Journey-Cache**; die PWA cached nur die Shell (`docs/audit/2026-11-17-implementation-summary.md:100-106`).
- **Kein „stale“-Marker**, wenn Zeit/Filter/Origin geändert werden, ohne neu zu suchen.
- **Kein Skeleton/`aria-busy`**; während „Searching…“ bleiben alte Ergebnisse sichtbar.
- **Kein Abbruch-Button** für eine laufende Suche (max. 20 s).
- **Keine Fehler-Zustände pro Feld** (Geocode fehlgeschlagen vs. keine Treffer).
- **Keine Persistenz der letzten Ergebnisse** (nur From/To/Filter); nach Reload ist alles weg.
- **Keine Validierung rehydrierter Werte** aus `localStorage` (z. B. `maxTransfers`, `arriveBy`); die Store-Setter laufen beim Rehydrieren nicht.

### 4.6 Accessibility und Mobile

- **Kein `aria-live`** für Ergebnisanzahl, Fehler, Notice (`TransitPanel.tsx:327-363`).
- **Journey-Karten haben kein `aria-pressed`/`aria-current`**, nur `data-active` (`:397-406`).
- **PlacePicker ist keine vollständige Combobox**: kein `aria-expanded`, `aria-controls`, `aria-activedescendant` (`PlacePicker.tsx:260-295`).
- **„Refresh“ ist ein 11,5-px-Textlink** (`TransitPanel.tsx:332-339`), kein 44-px-Target.
- **Stadt-Input ist 40 px** (`:198`), unter dem 44-px-Ziel.
- **Primäre Aktion „Find connections“ liegt unter Filtern/Zeit** (`:316-323`); im Half-Sheet und mit Tastatur ist sie oft nicht sichtbar.
- **Kein Auto-Scroll zu Ergebnissen/Detail** nach der Suche.
- **Sheet wird nach der Suche nicht eingeklappt**; die Karte bleibt halb verdeckt.
- **Sprachmix**: „Stadt“, „Stadt filtern“ vs. sonst englisches UI („From station or address“, „Find connections“, „Journey detail“). Entweder konsistent Deutsch oder Englisch.

---

## 5. Datenmodell und API-Ausbeute

MOTIS liefert deutlich mehr, als normalisiert und angezeigt wird. Die folgende Tabelle ist live gegen `api.transitous.org` verifiziert.

| Feld | Live vorhanden | Genutzt? | Folge |
|---|---|---|---|
| `itineraries[].id` | ja | nein; eigene ID aus Index/Zeit (`motis.ts:358`) | Auswahl springt bei Refresh/Reihenfolgeänderung |
| `stop.tz` | ja | nein | falsche Zeiten über Zeitzonen (P0-1) |
| `stop.description` | ja („Gleis 2, Gleis 3“) | nein | kein Plattformkontext |
| `intermediateStops` (mit Zeiten/Gleis) | ja | geparst, nie angezeigt | keine Zwischenhalte (P1 / QoL) |
| `leg.steps` (relativeDirection, streetName) | ja | nein | keine Fußweg-Navigation |
| `routeColor` / `routeTextColor` | ja | nein | alle Linien gleich (P1-14) |
| `routeType` | ja (100 = Bahn) | nein | keine Modus-Icons |
| `wheelchairAccessible` | ja (`NOT_ACCESSIBLE`) | nein | Barrierefreiheit versteckt (P1-15) |
| `bikesAllowed` | ja | nein | Fahrradinfo fehlt (P1-16) |
| `reservation` | ja | nein | Reservierungspflicht fehlt (P1-16) |
| `pickupType` / `dropoffType` | ja | nein | Randfälle (kein Zustieg) |
| `agencyUrl` / `agencyFareUrl` | ja (leer) | nein | kein Betreiber-/Tariflink |
| `tripShortName` | ja | nein | keine Zugnummer |
| `previousPageCursor` / `nextPageCursor` | ja | nein | kein „früher/später“ (P1-17) |
| `retryAfterS` | ja (HTTP-Header) | geparst, nicht angezeigt | rohe 429-Fehler (P1-20) |
| `realTime` | ja | teilweise | „Live“ auch durch Walk-Leg (P1-6) |
| `cancelled` | ja | ja (Badge) | keine Alternativsuche |
| `headsign` | ja | ja, aber doppelt | P1-2 |
| `track` / `scheduledTrack` | ja | ja, aber unlabeled | „Gleis“ fehlt (P1-12) |
| `distance` | ja | ja | nur im Detail, keine Dauer (P1-13) |
| `duration` pro Leg | ja | nein | keine Leg-Dauer (P1-13) |

Zusätzlich: `planMotis` sendet keine Stop-IDs, keine Modusfilter, keine Gehweglimits und kein `pageCursor` (P1-18/19/17). `direct` wird nur als Fallback genutzt, wenn `itineraries` leer ist (`motis.ts:449-452`) — das ist in Ordnung, aber `direct`-Verbindungen werden nicht als „direkt“ gelabelt.

---

## 6. Navigationsmodus im Detail

Der Transit-Navigationsmodus ist derzeit eine **Überlagerung des Auto-/Fuß-Navigationsmodus** mit einigen Sonderfällen, keine echte ÖPNV-Navigation.

**Aktueller Ablauf:**

1. `JourneyDetail` ruft `startNavigation(journey)` (`TransitPanel.tsx:465-479`).
2. `useNavigation` startet GPS-Watch (`useNavigation.ts:66-94`) und optional Simulation (`:96-140`).
3. `NavigationOverlay` bestimmt die aktuelle Leg über `Date.now()` (`NavigationOverlay.tsx:64-74`).
4. Der Top-Titel zeigt Linie + Headsign (`:107-108`); der Rest des Overlays ist für alle Modi gleich.
5. `data-navigating` blendet das Sheet aus (`Map.tsx:3309`, `globals.css:1236`).

**Was fehlt, um „Navigation“ zu verdienen:**

- Positionsbasierte Leg-Erkennung (nicht Uhrzeit), mit Fallback auf Fahrplan.
- Ausstiegsstation als primäre Information, plus „noch X Stationen / Y min“.
- Umstiegshinweis mit Gleis und Umstiegszeit, inkl. „zu knapp“-Warnung.
- Live-Refresh der Journey (Verspätung/Ausfall) während der Fahrt.
- Plattformanzeige, especially bei Umstieg.
- Ausstiegsalarm (Vibration/Ton) und optional „Wecker“.
- „Nach Fahrplan“-Modus für Tunnel/Zug ohne GPS.
- Battery-Saver (kein High-Accuracy/Wake-Lock standardmäßig).
- „Journey anzeigen“ / Sheet wieder öffnen.
- Recalculate bei Off-Route oder verpasstem Anschluss.
- Bei Walk-only: normaler Fuß-Navigationsmodus statt Train-Glyph.
- Erste Leg ansagen (progress.ts Off-by-One).
- Kein „Start“ für vergangene/annullierte Fahrten.

---

## 7. Was bereits gut ist

- **Saubere Provider-Kapselung:** `RoutePlan` normalisiert MOTIS, BRouter und Valhalla; UI kennt keine Provider-JSON.
- **Abort/Timeout:** `fetchJson` kombiniert Caller-Signal und Timeout, unterscheidet `aborted`, `rate-limit`, `no-route`, `network`, `bad-response` (`http.ts`, `types.ts:172-209`).
- **Polyline-Dekodierung** mit Precision-Fallback und Endpunktprüfung (`motis.ts:62-100`).
- **Realzeit-/Cancel-Flags, Plattformen, Linie, Agency, Headsign** werden normalisiert.
- **Wheelchair-Parameter** wird an MOTIS gesendet (`motis.ts:431`), auch wenn die Anzeige fehlt.
- **Persistenz** von From/To/Filter (`transitStore.ts:123-135`) ist vorhanden.
- **Grundlegende Tastaturbedienung** im PlacePicker (Arrow/Enter/Escape) und 44-px-Ziele bei den meisten Controls.
- **Tests** für Provider, Format, HTTP, Engine; 63 grün.

---

## 8. Empfohlene Reihenfolge

### Quick Wins (1–2 Tage, hoher Hebel)

1. **Zeitzone:** `tz` durchreichen und `formatClock` mit `timeZone` aufrufen; Tests mit `Europe/Berlin` vs. `Europe/London`.
2. **From/To invalidieren:** Bei Texteingabe `setFrom(null)`/`setTo(null)`, Suchbutton deaktivieren; Clear-Button.
3. **Abort-Races:** Search bei From/To/Swap/Unmount aborten; Nearest-Station mit Generation/Abort.
4. **Zeit:** `when` beim Mount einmalig setzen; „Jetzt“-Button; nicht aufrunden (oder Kulanzfenster); `min`-Attribut.
5. **Stadtfilter** umbenennen oder echt auf Ergebnisse anwenden.
6. **Nearest-Station-Anzeige** entfernen oder aus der tatsächlichen Journey ableiten.
7. **`START`/`END`** durch die Picker-Namen ersetzen; Headsign nur bei Abweichung.
8. **Datum/+1** in Karten und Detail.
9. **Alte Ergebnisse** bei neuer Suche/Fehler leeren oder als „veraltet“ markieren; `notice` zurücksetzen.
10. **`3+`** korrigieren; „Best“ entfernen oder berechnen.

### Strukturell (1–2 Wochen)

1. **Transit-Navigationsmodell:** positionsbasierte Leg-Erkennung, Ausstieg/Umstieg/Plattform, Live-Refresh, Recalculate, Schedule-Modus.
2. **Ergebnis-UI:** früher/später (Cursor), Sortierung/Filter, Gehzeit, Umstiegsstationen, Plattform, Delay/Announcements, Linienfarben/Icons.
3. **Barrierefreiheit/Fahrrad/Reservierung** aus den vorhandenen Feldern anzeigen und filtern.
4. **Karte:** Stop-Labels/Popups, Leg-Highlight, Richtungspfeile, `routeColor`, cancelled-Style, Fit auf sichtbaren Bereich.
5. **Cache/Rate-Limit:** identische Suchen cachen, Refresh drosseln, 720/Tag-Hinweis, `retryAfterS` auswerten.
6. **Tests:** `TransitPanel` (Zeit/TZ/Invalidierung/Races), `transitStore` (Rehydrierung), `progress` (Transit-Legs), `NavigationOverlay` (currentLeg), `normalizeMotisItinerary` (ODM, ODM-Transfers, `tz`, `id`).
7. **A11y:** `aria-live`, `aria-pressed`, vollständige Combobox-ARIA, 44-px-Refresh, Sticky-CTA.
8. **Daily-Use-Extras:** Favoriten/Home/Work, „Mein Standort“, Kartenklick, Teilen, Kalender, letzte Suche.

---

## 9. Verifikationsgrenzen

- Dieses Audit ist **statisch** plus **Live-API-Probes**; es wurde kein vollständiger Browser-Durchlauf auf Gerät gemacht. Aussagen zu Layout/Scroll/Touch sind aus Code und CSS abgeleitet.
- Die 720-`/plan`-Requests/24 h/IP stammen aus dem projekteigenen Implementierungsdokument, nicht aus einer aktuellen Transitous-Doku; sie sollten vor Produktentscheidungen erneut geprüft werden.
- MOTIS-Felder können je nach Feed/Region variieren (z. B. `routeColor`, `wheelchairAccessible`, `reservation`). Die Normalisierung sollte fehlende Felder tolerant behandeln.
- Die Live-Beispiele (Basel–Berlin, Heidelberg–Mannheim, `START`/`END`, 0-Minuten-Umstieg) sind repräsentativ, aber nicht jede Region liefert dieselben Daten.

---

## Status 2026-11-18 — behoben

Die code-level Befunde sind im Anschluss umgesetzt und verifiziert. Details und
Abweichungen stehen in `docs/superpowers/plans/2026-11-18-transit-hardening.md`.

- Provider: `tz`, `routeColor`, `routeType`, Barrierefreiheit/Fahrrad/Reservierung,
  Zwischenhalte, Itinerary-ID, Page-Cursor, Stop-IDs, ODM als Transit.
- Zeit: kein Aufrunden mehr, „Jetzt“/„+1 h“/„Morgen“, Tageswechsel, Zeitzone je
  Halt (Abfahrt im Abfahrts-TZ, Ankunft im Ziel-TZ).
- Eingabe: From/To wird beim Editieren invalidiert, Abbrüche bei Place-Wechsel
  und Unmount, kein Textsuch-Nearest-Station-Race mehr, Clear/No-results/ARIA.
- Ergebnisse: Stadtfilter wirkt auf Verbindungen, Sortierung, Modus-/Max-Walk-
  Filter, Best nach Ankunft, echte „3/4/5“-Labels, Live nur für Fahrzeug-Legs,
  Verspätung Abfahrt + Ankunft, Umstiegswarnungen, Gleiswechsel, Gehzeit,
  Zwischenhalte, Linienfarben, Barrierefrei/Fahrrad/Reservierung.
- Alltag: Favoriten/Recents, Mein Standort, Kartenklick, Teilen, ICS, Früher/
  Später über Cursor, Auto-Refresh (opt-in), Aktualisiert-Zeit, Stale-Markierung,
  Sheet-Höhe beim Karten-Fit, Swap + Suche.
- Navigation: Ausstiegshalt/Gleis statt Zug-Endziel, Umstiegshinweis, Live/
  Fahrplan-Umschaltung, echte Neuberechnung, Ausstiegs-Erinnerung (Vibration +
  Sprache), Walk-only bleibt Walk, Vorschau zeitgerafft und distanzbasiert.
- Karte: Linienfarben, Labels, Stop-Popups, Zwischenhalte, gestrichelte
  Cancelled-Optik, Fit auf die tatsächliche Sheet-Höhe.
- Via-Zwischenstationen: bis zu zwei Haltestellen über MOTIS `via` plus
  `viaMinimumStay=1`; eigene Picker, Persistenz, Share-Link und Deep-Link.
- Live-Fahrzeugpositionen: `/api/v6/map/trips` liefert Echtzeit-Segmente und
  Polylinien; die Position wird zeitanteilig zwischen Abfahrt und Ankunft
  interpoliert. Karte mit Linienfarbe, Label, Popup und 30-s-Refresh; der
  Toggle sitzt im Transit-Panel. Keine GPS-Daten, sondern die genaueste
  öffentlich verfügbare Echtzeit-Interpolation.
- Tests: 159 Vitest-Tests, Lint, Typecheck und statischer Build grün; Browser-
  Smoke-Test mit echter MOTIS-Antwort (Heidelberg → Weinheim → Mannheim, fünf
  Verbindungen, Live-Layer mit 16 Fahrzeugen im Kartenausschnitt).
- Bewusst offen (keine Daten/Produktentscheidung): Preise, CO₂, vollständiges
  Offline-Routing, „Journey anzeigen“ während der Navigation.
