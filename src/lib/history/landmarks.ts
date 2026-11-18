// src/lib/history/landmarks.ts
//
// Loader for historic landmarks shown on the History tab. Combines two
// sources: OSM `historic=*` features via Overpass (dense, but most
// entries lack a date) and Wikidata SPARQL (sparser, but every result
// has an inception date and often a Wikipedia article). Results are
// merged into a single GeoJSON FeatureCollection ready for a MapLibre
// GeoJSON source. Slider-year filtering happens in the map layer via
// `setFilter`, so this module does no time filtering itself.

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";

/**
 * Per-attempt and overall budgets for Overpass. A single stalled mirror
 * used to block the whole tile forever: `fetch` has no default timeout,
 * so the promise never settled and neither source ever reached the map.
 * Mirrors are tried sequentially; the overall deadline bounds the worst
 * case to ~12 s even when every mirror hangs.
 */
export const HISTORY_OVERPASS_ATTEMPT_TIMEOUT_MS = 6_000;
export const HISTORY_OVERPASS_TOTAL_TIMEOUT_MS = 12_000;
/** Wikidata SPARQL normally answers in 1–4 s; 10 s is generous. */
export const HISTORY_WIKIDATA_TIMEOUT_MS = 10_000;

/** Year from which undated `historic=*` features are shown. */
export const HISTORY_UNDATED_VISIBLE_FROM = 2000;

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

interface Attempt {
  signal: AbortSignal;
  didTimeout: () => boolean;
  /** Clear the timer and detach from the caller's signal. */
  cancel: () => void;
}

/**
 * Combine the caller's abort signal with a timeout. `AbortSignal.any`
 * is still missing on some supported Safari versions, so wire the two
 * controllers by hand.
 */
function createAttempt(
  caller: AbortSignal | undefined,
  timeoutMs: number,
): Attempt {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener("abort", onCallerAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cancel: () => {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    },
  };
}

// Wikidata QIDs of "things that are not landmarks" — events, people,
// administrative units. Used as a *negative* filter on the bbox query
// to reduce noise without forcing items into a narrow whitelist
// (`wdt:P31` direct match on a positive list missed most heritage
// sites because OSM/Wikidata kinds are highly heterogeneous).
const WIKIDATA_EXCLUDE_QIDS = [
  "Q5", // human
  "Q1656682", // event
  "Q15275719", // recurrent event
  "Q1190554", // occurrence
  "Q3024240", // historical country (admin)
  "Q56061", // administrative territorial entity
  "Q515", // city
  "Q3957", // town
  "Q532", // village
  "Q702492", // urban municipality
];

export interface LandmarkProperties {
  id: string;
  name: string;
  kind: string;
  /** Year as a number (e.g. 1485). Undefined when unknown. */
  inception?: number;
  /** Year of dissolution / destruction, when known. */
  dissolved?: number;
  /** Wikidata QID (without prefix), when known. */
  wikidataId?: string;
  /** Wikipedia article title, when known. */
  wikipediaTitle?: string;
  /** Wikipedia language edition for the title above (default "en"). */
  wikipediaLang?: string;
  /** Representative image (Wikimedia Commons), when known. */
  imageUrl?: string;
  /** Source bucket — useful for diagnostics + potential UI filters. */
  source: "osm" | "wikidata";
}

export type LandmarkFeature = GeoJSON.Feature<
  GeoJSON.Point,
  LandmarkProperties
>;

export type LandmarkCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  LandmarkProperties
>;

/**
 * Single source of truth for the timeline filter, shared by the MapLibre
 * expression (dots) and the panel's visible-site counter.
 */
export function isLandmarkVisibleAtYear(
  props: LandmarkProperties,
  year: number,
): boolean {
  if (props.inception === undefined) return year >= HISTORY_UNDATED_VISIBLE_FROM;
  if (props.inception > year) return false;
  return props.dissolved === undefined || props.dissolved >= year;
}

// ─── Overpass ─────────────────────────────────────────────────────────

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
interface OverpassResponse {
  elements: OverpassElement[];
}

async function overpass(
  query: string,
  signal?: AbortSignal,
): Promise<OverpassResponse> {
  if (Date.now() < overpassUnavailableUntil) {
    throw new Error("Overpass temporarily unavailable (backoff)");
  }
  let lastErr: unknown;
  const deadline = Date.now() + HISTORY_OVERPASS_TOTAL_TIMEOUT_MS;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) throw abortError();
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      lastErr = new Error("Overpass overall timeout reached");
      break;
    }
    const attempt = createAttempt(
      signal,
      Math.min(HISTORY_OVERPASS_ATTEMPT_TIMEOUT_MS, remaining),
    );
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: attempt.signal,
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass ${endpoint} → ${res.status}`);
        continue;
      }
      return (await res.json()) as OverpassResponse;
    } catch (err) {
      // A caller abort must win over the attempt timeout so the whole
      // tile fetch stops when the user pans away.
      if (signal?.aborted) throw abortError();
      lastErr = attempt.didTimeout()
        ? new Error(`Overpass ${endpoint} → timed out`)
        : err;
    } finally {
      attempt.cancel();
    }
  }
  overpassUnavailableUntil = Date.now() + OVERPASS_BACKOFF_MS;
  throw new Error(
    `All Overpass endpoints failed: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}

/**
 * OSM start_date and end_date come in many flavours: "1485", "1485-04",
 * "C16", "early 19th century", "~1200". The pragmatic move is to grab
 * the first 4-digit year-looking token. Returns undefined if none.
 */
function parseOsmYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.match(/-?\d{3,4}/);
  if (!m) return undefined;
  const y = Number(m[0]);
  if (!Number.isFinite(y)) return undefined;
  // Slider only goes 1500..now; clamp older to undefined so they
  // surface as "undated" rather than mis-positioning at year 1500.
  return y;
}

/**
 * Turn an OSM `image` / `wikimedia_commons` tag into a usable image URL.
 * Direct http(s) URLs are accepted; Commons file references
 * (`File:Foo.jpg`) go through Special:FilePath, which redirects to the
 * actual file and supports server-side thumbnailing.
 */
function osmImageUrl(tags: Record<string, string>): string | undefined {
  const direct = tags.image?.trim();
  if (direct && /^https?:\/\//i.test(direct)) {
    // `image` is sometimes a Commons *page* URL rather than a file URL.
    const commonsPage = direct.match(
      /^https?:\/\/commons\.wikimedia\.org\/wiki\/(File:[^#?]+)/i,
    );
    if (commonsPage) {
      const file = decodeURIComponent(commonsPage[1]).slice("File:".length);
      return commonsFilePath(file);
    }
    return direct;
  }
  const commons = tags.wikimedia_commons?.trim();
  if (!commons?.startsWith("File:")) return undefined;
  const file = commons.slice("File:".length).trim();
  if (!file) return undefined;
  return commonsFilePath(file);
}

function commonsFilePath(file: string): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    file,
  )}?width=320`;
}

async function fetchOverpassLandmarks(
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<LandmarkFeature[]> {
  const [s, w, n, e] = bbox;
  const q = `
    [out:json][timeout:25];
    (
      nwr[historic](${s},${w},${n},${e});
    );
    out tags center 400;
  `;
  const data = await overpass(q, signal);
  const out: LandmarkFeature[] = [];
  for (const el of data.elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const name =
      tags.name ?? tags["name:en"] ?? tags["name:de"] ?? tags.historic ?? "";
    if (!name) continue;
    const kind = (tags.historic ?? "site").replace(/_/g, " ");
    const inception = parseOsmYear(tags.start_date);
    const dissolved = parseOsmYear(tags.end_date);
    const wikidataId =
      typeof tags.wikidata === "string" && /^Q\d+$/.test(tags.wikidata)
        ? tags.wikidata
        : undefined;
    // OSM `wikipedia` tag format: `lang:Article Title` (e.g. "de:Düsseldorf").
    // Both pieces matter — the lang tells us which Wikipedia edition has the
    // article. Without it we'd default to en.wikipedia and 404 on most
    // German-only sites.
    let wikipediaLang: string | undefined;
    let wikipediaTitle: string | undefined;
    if (typeof tags.wikipedia === "string" && tags.wikipedia.includes(":")) {
      const idx = tags.wikipedia.indexOf(":");
      const lang = tags.wikipedia.slice(0, idx);
      const title = tags.wikipedia.slice(idx + 1);
      if (/^[a-z]{2,3}$/i.test(lang) && title) {
        wikipediaLang = lang.toLowerCase();
        wikipediaTitle = title;
      }
    }
    const props: LandmarkProperties = {
      id: `osm/${el.type}/${el.id}`,
      name,
      kind,
      source: "osm",
    };
    if (inception !== undefined) props.inception = inception;
    if (dissolved !== undefined) props.dissolved = dissolved;
    if (wikidataId) props.wikidataId = wikidataId;
    if (wikipediaTitle) props.wikipediaTitle = wikipediaTitle;
    if (wikipediaLang) props.wikipediaLang = wikipediaLang;
    const imageUrl = osmImageUrl(tags);
    if (imageUrl) props.imageUrl = imageUrl;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: props,
    });
  }
  return out;
}

// ─── Wikidata SPARQL ──────────────────────────────────────────────────

interface SparqlBinding {
  type: string;
  value: string;
  "xml:lang"?: string;
  datatype?: string;
}

interface SparqlRow {
  item: SparqlBinding;
  itemLabel?: SparqlBinding;
  coord: SparqlBinding;
  inception?: SparqlBinding;
  dissolved?: SparqlBinding;
  kind?: SparqlBinding;
  kindLabel?: SparqlBinding;
  wpTitle?: SparqlBinding;
}

interface SparqlResponse {
  results: { bindings: SparqlRow[] };
}

/**
 * Wikidata stores dates as `+1485-04-12T00:00:00Z`. Slice the year and
 * coerce to number. BCE dates start with a minus and are out of scope
 * (slider is 1500+) — those return undefined.
 */
function parseWikidataYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.match(/^([+-]?)(\d{1,5})/);
  if (!m) return undefined;
  const sign = m[1] === "-" ? -1 : 1;
  const y = sign * Number(m[2]);
  if (!Number.isFinite(y)) return undefined;
  return y;
}

/**
 * Wikidata coords are `Point(lon lat)` WKT literals.
 */
function parseWktPoint(value: string): [number, number] | null {
  const m = value.match(/^Point\(([-\d.]+)\s+([-\d.]+)\)$/);
  if (!m) return null;
  const lon = Number(m[1]);
  const lat = Number(m[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

async function fetchWikidataLandmarks(
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<LandmarkFeature[]> {
  const [s, w, n, e] = bbox;
  // Force decimal formatting — integer-only WKT literals (e.g.
  // "Point(6 51)") are silently rejected by the box service.
  const fmt = (n: number) => n.toFixed(5);
  const excludeList = WIKIDATA_EXCLUDE_QIDS.map((q) => `wd:${q}`).join(" ");
  // All items in the bbox that have an inception date (P571) and are
  // not in the exclusion list. Wikibase's box service does the spatial
  // filter; the inception triple is what lets us place items on the
  // timeline. Keeping the kind unfiltered turned out to be essential —
  // OSM/Wikidata heritage classes are highly heterogeneous (Q23413
  // castle, Q1149531 fort, Q57831 fortress, etc.) and a positive
  // VALUES list silently skipped most of them.
  const query = `
    SELECT ?item ?itemLabel ?coord ?inception ?dissolved ?kind ?kindLabel ?wpTitle WHERE {
      SERVICE wikibase:box {
        ?item wdt:P625 ?coord .
        bd:serviceParam wikibase:cornerSouthWest "Point(${fmt(w)} ${fmt(s)})"^^geo:wktLiteral .
        bd:serviceParam wikibase:cornerNorthEast "Point(${fmt(e)} ${fmt(n)})"^^geo:wktLiteral .
      }
      ?item wdt:P571 ?inception .
      OPTIONAL { ?item wdt:P31 ?kind . }
      OPTIONAL { ?item wdt:P576 ?dissolved . }
      OPTIONAL {
        ?wpArticle schema:about ?item ;
                   schema:isPartOf <https://en.wikipedia.org/> ;
                   schema:name ?wpTitle .
      }
      FILTER NOT EXISTS {
        ?item wdt:P31 ?excluded .
        VALUES ?excluded { ${excludeList} }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,de". }
    }
    LIMIT 400
  `;
  // POST avoids the URL-length cliff (the QID VALUES list pushes us
  // close to the 414 limit on some proxies).
  const attempt = createAttempt(signal, HISTORY_WIKIDATA_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(WIKIDATA_SPARQL, {
      method: "POST",
      headers: {
        Accept: "application/sparql-results+json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `query=${encodeURIComponent(query)}`,
      signal: attempt.signal,
    });
  } catch (err) {
    if (signal?.aborted) throw abortError();
    if (attempt.didTimeout()) {
      throw new Error("Wikidata SPARQL → timed out");
    }
    throw err;
  } finally {
    attempt.cancel();
  }
  if (!res.ok) {
    throw new Error(`Wikidata SPARQL → ${res.status}`);
  }
  const data = (await res.json()) as SparqlResponse;
  const out: LandmarkFeature[] = [];
  // A Q-id may have multiple inception triples (estimates); keep the
  // earliest, drop duplicates by item.
  const byItem = new Map<string, LandmarkFeature>();
  for (const row of data.results.bindings) {
    const itemUri = row.item?.value ?? "";
    const qid = itemUri.split("/").pop() ?? "";
    if (!qid) continue;
    const coords = parseWktPoint(row.coord.value);
    if (!coords) continue;
    const inception = parseWikidataYear(row.inception?.value);
    if (inception === undefined) continue;
    const dissolved = parseWikidataYear(row.dissolved?.value);
    const name = row.itemLabel?.value ?? qid;
    const kindUri = row.kind?.value ?? "";
    const kindQid = kindUri.split("/").pop() ?? "site";
    const kind = row.kindLabel?.value ?? kindQid;
    const wikipediaTitle = row.wpTitle?.value;
    const existing = byItem.get(qid);
    if (existing) {
      const prev = existing.properties.inception;
      if (prev !== undefined && inception >= prev) continue;
    }
    const props: LandmarkProperties = {
      id: `wd/${qid}`,
      name,
      kind,
      inception,
      wikidataId: qid,
      source: "wikidata",
    };
    if (dissolved !== undefined) props.dissolved = dissolved;
    if (wikipediaTitle) {
      props.wikipediaTitle = wikipediaTitle;
      props.wikipediaLang = "en";
    }
    byItem.set(qid, {
      type: "Feature",
      geometry: { type: "Point", coordinates: coords },
      properties: props,
    });
  }
  for (const f of byItem.values()) out.push(f);
  return out;
}

// ─── Tile cache ───────────────────────────────────────────────────────
//
// Same pattern as the rail-network cache in Map.tsx: slippy-map tiles
// at zoom 9 (~80 km × 50 km per tile in mid-latitudes). Pans within an
// already-loaded tile render instantly from cache.

export const HISTORY_TILE_ZOOM = 9;

interface CachedTile {
  features: LandmarkFeature[];
  /** True when only one of the two sources answered. */
  partial: boolean;
  cachedAt: number;
}
const tileCache = new Map<string, CachedTile>();
interface InFlightTile {
  promise: Promise<LandmarkFeature[]>;
  /** The request that started this load; aborted entries must not be reused. */
  signal?: AbortSignal;
}
const tileInFlight = new Map<string, InFlightTile>();
let rateLimitedUntil = 0;
const RATE_LIMIT_BACKOFF_MS = 15_000;
/** Skip Overpass for a while after every mirror failed (capacity/outage). */
let overpassUnavailableUntil = 0;
const OVERPASS_BACKOFF_MS = 60_000;
/** Re-try a one-source tile after this long, so missing OSM data fills in. */
const PARTIAL_TILE_TTL_MS = 60_000;

function isRateLimitError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  // Only genuine throttling/connection-reset signals. A CORS failure or
  // ordinary offline error must not pause the layer for 15 seconds.
  return msg.includes("429") || msg.includes("CONNECTION_CLOSED");
}

function tileKey(x: number, y: number): string {
  return `${x}/${y}`;
}

function lon2tileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * (1 << z));
}
function lat2tileY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * (1 << z),
  );
}
function tileX2lon(x: number, z: number): number {
  return (x / (1 << z)) * 360 - 180;
}
function tileY2lat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (1 << z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function tilesForBounds(
  bounds: { west: number; south: number; east: number; north: number },
  z: number,
): { x: number; y: number }[] {
  const n = 1 << z;
  // MapLibre reports longitudes beyond ±180 when the viewport crosses
  // the antimeridian (e.g. west 170, east 190). Normalise tile x so we
  // fetch the valid wrapped tiles instead of out-of-range indices.
  const wrapX = (x: number) => ((x % n) + n) % n;
  const xMin = lon2tileX(bounds.west, z);
  const xMax = lon2tileX(bounds.east, z);
  // Mercator cannot represent latitudes beyond ±85.0511°; clamp y.
  const yMin = Math.max(0, lat2tileY(bounds.north, z));
  const yMax = Math.min(n - 1, lat2tileY(bounds.south, z));
  // Deduplicate because a world-spanning bbox can wrap back onto itself.
  const out = new Map<string, { x: number; y: number }>();
  for (let x = xMin; x <= xMax; x += 1) {
    const wx = wrapX(x);
    for (let y = yMin; y <= yMax; y += 1) {
      out.set(`${wx}/${y}`, { x: wx, y });
    }
  }
  return [...out.values()];
}

export function tileBbox(
  z: number,
  x: number,
  y: number,
): [number, number, number, number] {
  // [south, west, north, east] — matches Overpass + our fetcher
  return [
    tileY2lat(y + 1, z),
    tileX2lon(x, z),
    tileY2lat(y, z),
    tileX2lon(x + 1, z),
  ];
}

/**
 * Merge the two source buckets, preferring the Wikidata entry when both
 * describe the same QID (Wikidata always has a date; OSM rarely does).
 */
function mergeLandmarkSources(
  osm: LandmarkFeature[],
  wikidata: LandmarkFeature[],
): LandmarkFeature[] {
  const seenQids = new Set<string>();
  for (const f of wikidata) {
    if (f.properties.wikidataId) seenQids.add(f.properties.wikidataId);
  }
  return [
    ...osm.filter(
      (f) =>
        !f.properties.wikidataId || !seenQids.has(f.properties.wikidataId),
    ),
    ...wikidata,
  ];
}

async function loadTile(
  x: number,
  y: number,
  signal?: AbortSignal,
  /** Called whenever one source settles, so callers can paint early. */
  onPartial?: (features: LandmarkFeature[]) => void,
): Promise<LandmarkFeature[]> {
  const key = tileKey(x, y);
  const cached = tileCache.get(key);
  const cachedIsFresh =
    cached &&
    (!cached.partial || Date.now() - cached.cachedAt < PARTIAL_TILE_TTL_MS);
  if (cached && cachedIsFresh) {
    onPartial?.(cached.features);
    return cached.features;
  }
  if (cached) tileCache.delete(key);
  const inFlight = tileInFlight.get(key);
  if (inFlight && !inFlight.signal?.aborted) return inFlight.promise;
  // A stale entry from an aborted request must not be reused, or the
  // next fetch inherits the old AbortError and the area stays blank.
  const bbox = tileBbox(HISTORY_TILE_ZOOM, x, y);
  let osmFeatures: LandmarkFeature[] = [];
  let wdFeatures: LandmarkFeature[] = [];
  const emitPartial = () => {
    if (signal?.aborted || !onPartial) return;
    onPartial(mergeLandmarkSources(osmFeatures, wdFeatures));
  };
  const promise = (async () => {
    // Run both queries in parallel; either failing alone shouldn't
    // wipe out the other source. Timeouts inside the fetchers keep a
    // stalled mirror from blocking the whole tile indefinitely.
    const [osmRes, wdRes] = await Promise.allSettled([
      fetchOverpassLandmarks(bbox, signal).then((features) => {
        osmFeatures = features;
        emitPartial();
        return features;
      }),
      fetchWikidataLandmarks(bbox, signal).then((features) => {
        wdFeatures = features;
        emitPartial();
        return features;
      }),
    ]);
    if (signal?.aborted) {
      throw abortError();
    }
    if (osmRes.status === "fulfilled") osmFeatures = osmRes.value;
    else if (isRateLimitError(osmRes.reason)) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    }
    if (wdRes.status === "fulfilled") wdFeatures = wdRes.value;
    else if (isRateLimitError(wdRes.reason)) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    }
    const deduped = mergeLandmarkSources(osmFeatures, wdFeatures);
    // Only cache a tile when at least one source answered. An empty
    // result produced by two transient failures used to be cached
    // forever, so the area stayed blank for the rest of the session.
    const answered =
      osmRes.status === "fulfilled" || wdRes.status === "fulfilled";
    if (!answered) {
      // Surface the failure; without this the UI just says "no data".
      console.warn(
        `[history-landmarks] tile ${key} failed:`,
        osmRes.status === "rejected" ? osmRes.reason : undefined,
        wdRes.status === "rejected" ? wdRes.reason : undefined,
      );
    }
    if (!signal?.aborted && answered) {
      tileCache.set(key, {
        features: deduped,
        partial:
          osmRes.status !== "fulfilled" || wdRes.status !== "fulfilled",
        cachedAt: Date.now(),
      });
    }
    return deduped;
  })();
  tileInFlight.set(key, { promise, signal });
  try {
    return await promise;
  } catch (err) {
    if (isRateLimitError(err)) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
    }
    throw err;
  } finally {
    // Only remove our own entry; a newer request may have replaced it.
    if (tileInFlight.get(key)?.promise === promise) {
      tileInFlight.delete(key);
    }
  }
}

/**
 * Public API — fetch all tiles intersecting the bounds, returning the
 * merged FeatureCollection. Resolves after every tile has loaded (or
 * failed). Caller decides when to call this (typically on `moveend`).
 */
export async function fetchLandmarksForBounds(
  bounds: { west: number; south: number; east: number; north: number },
  signal?: AbortSignal,
  /** Progressive results: called whenever a source or tile settles. */
  onProgress?: (collection: LandmarkCollection) => void,
): Promise<LandmarkCollection> {
  if (Date.now() < rateLimitedUntil) {
    return featuresToCollection(collectCachedFeaturesForBounds(bounds));
  }
  const tiles = tilesForBounds(bounds, HISTORY_TILE_ZOOM);
  // A world view would fan out to thousands of tiles, each with an
  // Overpass + SPARQL request. The layer is hidden below z4 anyway; cap
  // the work and render whatever is already cached.
  const MAX_TILES = 120;
  if (tiles.length > MAX_TILES) {
    console.warn(
      `[history-landmarks] ${tiles.length} tiles at this view; using cached subset`,
    );
    return featuresToCollection(collectCachedFeaturesForBounds(bounds));
  }
  // Track the latest merged result per tile so a partial update from a
  // second source can replace the first without losing other tiles.
  const perTile = new Map<string, LandmarkFeature[]>();
  const emitProgress = () => {
    if (!onProgress || signal?.aborted) return;
    const seen = new Set<string>();
    const merged: LandmarkFeature[] = [];
    for (const features of perTile.values()) {
      for (const f of features) {
        if (seen.has(f.properties.id)) continue;
        seen.add(f.properties.id);
        merged.push(f);
      }
    }
    onProgress(featuresToCollection(merged));
  };
  // Cap parallelism — Wikidata SPARQL throttles aggressively.
  const MAX_PARALLEL = 2;
  const queue = tiles.slice();
  const results: LandmarkFeature[] = [];
  const seen = new Set<string>();
  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) return;
      const key = tileKey(t.x, t.y);
      try {
        const tileFeatures = await loadTile(t.x, t.y, signal, (partial) => {
          perTile.set(key, partial);
          emitProgress();
        });
        perTile.set(key, tileFeatures);
        for (const f of tileFeatures) {
          if (seen.has(f.properties.id)) continue;
          seen.add(f.properties.id);
          results.push(f);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") throw err;
        // Surface load failures so users can see why a region is empty
        // (rate limit, network, query syntax) rather than silent zeros.
        console.warn(`[history-landmarks] tile ${t.x}/${t.y} failed`, err);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_PARALLEL, tiles.length) }, () => worker()),
  );
  return featuresToCollection(results);
}

function collectCachedFeaturesForBounds(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}): LandmarkFeature[] {
  const tiles = tilesForBounds(bounds, HISTORY_TILE_ZOOM);
  const seen = new Set<string>();
  const out: LandmarkFeature[] = [];
  for (const t of tiles) {
    const data = tileCache.get(tileKey(t.x, t.y));
    if (!data) continue;
    for (const f of data.features) {
      if (seen.has(f.properties.id)) continue;
      seen.add(f.properties.id);
      out.push(f);
    }
  }
  return out;
}

function featuresToCollection(features: LandmarkFeature[]): LandmarkCollection {
  return { type: "FeatureCollection", features };
}

/**
 * Synchronous render of whatever is cached for the given bounds.
 * Useful for instant repaint while a fresh fetch is still in flight.
 */
export function landmarksFromCache(bounds: {
  west: number;
  south: number;
  east: number;
  north: number;
}): LandmarkCollection {
  return featuresToCollection(collectCachedFeaturesForBounds(bounds));
}
