/**
 * dewmap data gateway.
 *
 * Caches and normalises a handful of fixed external sources so the static
 * client can read them without CORS surprises, without hammering the
 * upstreams, and without knowing any upstream URL.
 *
 * There is no generic proxy here on purpose: every upstream host is
 * hard-coded below and the only variable parts of a request are a radar slot
 * (strictly validated) and a cached warning payload.
 *
 * Node 22, no dependencies.
 */
const http = require("node:http");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { URL } = require("node:url");

const lib = require("./lib.js");

const PORT = Number(process.env.PORT || 8787);
const SERVICE = "dewmap-data";
const VERSION = "0.2.0";

const CACHE_DIR = process.env.DEWMAP_CACHE_DIR || "/app/cache";
const RADAR_DIR = path.join(CACHE_DIR, "radar");
const WARNINGS_DIR = path.join(CACHE_DIR, "warnings");

const WMS_ENDPOINT = "https://maps.dwd.de/geoserver/dwd/wms";
const WFS_ENDPOINT = "https://maps.dwd.de/geoserver/dwd/ows";
const WARNINGS_ENDPOINT =
  "https://www.dwd.de/DWD/warnungen/warnapp/json/warnings.json";

/**
 * Per-upstream budget. A cold radar render was measured at up to 10.1 s (DWD
 * GeoServer), so 12 s left almost no head room; 15 s covers it with margin.
 * The warnings path may spend this twice (warnings.json + WFS), which is why
 * the client allows 40 s for that endpoint.
 */
const UPSTREAM_TIMEOUT_MS = 15_000;
const UPSTREAM_MAX_BYTES = 5 * 1024 * 1024;

const FRAMES_TTL_MS = 60_000;
// Env-overridable so the stale-while-revalidate path can be exercised in a
// local run instead of waiting five minutes.
const WARNINGS_TTL_MS = Number(process.env.WARNINGS_TTL_MS || 5 * 60_000);
const WARNINGS_STALE_MS = Number(process.env.WARNINGS_STALE_MS || 30 * 60_000);

const RADAR_MEMORY_LIMIT = 64;
const RADAR_FILES_LIMIT = 400;
const WARNINGS_CACHE_FILE = "latest.json";

const ATTRIBUTION = {
  radar: {
    label: "Deutscher Wetterdienst (DWD)",
    url: "https://www.dwd.de",
  },
  warnings: {
    label: "Deutscher Wetterdienst (DWD)",
    url: "https://www.dwd.de",
  },
};

/** Small LRU: Map keeps insertion order, we re-insert on read. */
class Lru {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) {
      this.map.delete(this.map.keys().next().value);
    }
  }
  delete(key) {
    this.map.delete(key);
  }
  get size() {
    return this.map.size;
  }
}

const radarMemory = new Lru(RADAR_MEMORY_LIMIT);

/** Upstream health, surfaced on /health without leaking internals. */
const upstreams = {
  radar: { lastOk: null, lastError: null, lastMs: null },
  warnings: { lastOk: null, lastError: null, lastMs: null },
  warnAreas: { lastOk: null, lastError: null, lastMs: null },
};

function noteUpstream(name, startedAt, error) {
  const state = upstreams[name];
  if (!state) return;
  state.lastMs = Date.now() - startedAt;
  if (error) {
    state.lastError = `${new Date().toISOString()} ${String(error).slice(0, 160)}`;
  } else {
    state.lastOk = new Date().toISOString();
    state.lastError = null;
  }
}

function log(...parts) {
  console.log(new Date().toISOString(), ...parts);
}

/* ---------------------------------------------------------------- HTTP out */

class UpstreamError extends Error {
  constructor(message, { status = 502, code = "upstream_error" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function fetchBuffer(url, { method = "GET", body, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs ?? UPSTREAM_TIMEOUT_MS,
  );
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: controller.signal,
      headers: {
        "User-Agent": "dewmap-data/0.2 (+https://dewmap.app)",
        Accept: "*/*",
        ...(method === "POST"
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
    });
    if (!res.ok) {
      throw new UpstreamError(`upstream ${res.status}`, {
        status: 502,
        code: "upstream_status",
      });
    }
    // Count the decompressed bytes while streaming instead of trusting the
    // header: a chunked response has no content-length at all, and a gzipped
    // one reports the compressed size (a 5 MB body can expand to gigabytes).
    if (!res.body) {
      throw new UpstreamError("upstream returned no body", {
        status: 502,
        code: "upstream_empty",
      });
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.byteLength;
      if (total > UPSTREAM_MAX_BYTES) {
        controller.abort();
        throw new UpstreamError("upstream response too large", {
          status: 502,
          code: "upstream_too_large",
        });
      }
      chunks.push(Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks, total),
      contentType: res.headers.get("content-type") ?? "",
      status: res.status,
    };
  } catch (error) {
    if (error instanceof UpstreamError) throw error;
    if (error?.name === "AbortError") {
      throw new UpstreamError("upstream timeout", {
        status: 504,
        code: "upstream_timeout",
      });
    }
    throw new UpstreamError(String(error?.message ?? error), {
      status: 502,
      code: "upstream_unreachable",
    });
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------- responses */

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body)
    ? body
    : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(data);
}

function json(res, status, body, headers = {}) {
  send(res, status, body, headers);
}

/** Fixed, non-leaking copy per error code. */
const ERROR_MESSAGES = {
  busy: "too many radar frames are rendering right now",
  frame_unavailable: "radar frame is not published yet",
  upstream_timeout: "upstream did not answer in time",
  upstream_too_large: "upstream response exceeded the size limit",
  upstream_unreachable: "upstream is unreachable",
  upstream_status: "upstream returned an error",
  upstream_empty: "upstream returned no body",
  warnings_unavailable: "warnings are unavailable right now",
  warnings_unparseable: "warnings payload was not usable",
  invalid_slot: "slot must be a 5-minute radar timestamp within now-6h..now+3h",
  not_found: "no such endpoint",
  method_not_allowed: "GET only",
  bad_request: "malformed request",
  internal_error: "unexpected gateway error",
};

function errorMessage(code) {
  return ERROR_MESSAGES[code] ?? "request failed";
}

function fail(res, status, code, message, extra = {}) {
  const headers = extra["Retry-After"]
    ? { "Retry-After": String(extra["Retry-After"]) }
    : {};
  const rest = { ...extra };
  delete rest["Retry-After"];
  json(res, status, { ok: false, error: code, message, ...rest }, headers);
}

const gzipCache = new WeakMap();

function sendJsonCompressed(req, res, body, { cacheControl, extra = {} } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const acceptsGzip = String(req.headers["accept-encoding"] ?? "").includes(
    "gzip",
  );
  const headers = {
    "Cache-Control": cacheControl ?? "no-store",
    Vary: "Accept-Encoding",
    ...extra,
  };
  if (acceptsGzip && raw.byteLength > 1024) {
    let gz = gzipCache.get(body);
    if (!gz) {
      gz = zlib.gzipSync(raw, { level: 6 });
      gzipCache.set(body, gz);
    }
    headers["Content-Encoding"] = "gzip";
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      ...headers,
    });
    res.end(gz);
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(raw);
}

/* ------------------------------------------------------------------- cache */

async function ensureCacheDirs() {
  await fsp.mkdir(RADAR_DIR, { recursive: true });
  await fsp.mkdir(WARNINGS_DIR, { recursive: true });
}

async function readCacheFile(dir, name) {
  try {
    return await fsp.readFile(path.join(dir, name));
  } catch {
    return null;
  }
}

async function writeCacheFile(dir, name, data) {
  const target = path.join(dir, name);
  const tmp = `${target}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, target);
}

let cacheWritable = true;

async function safeWrite(dir, name, data) {
  try {
    await writeCacheFile(dir, name, data);
    cacheWritable = true;
  } catch (error) {
    if (cacheWritable) {
      cacheWritable = false;
      log("cache write failed", String(error));
    }
  }
}

let cacheStats = { files: 0, bytes: 0, updatedAt: null };

async function refreshCacheStats() {
  let files = 0;
  let bytes = 0;
  for (const dir of [RADAR_DIR, WARNINGS_DIR]) {
    let entries = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".tmp")) continue;
      try {
        const stat = await fsp.stat(path.join(dir, entry));
        files += 1;
        bytes += stat.size;
      } catch {
        /* raced with cleanup */
      }
    }
  }
  cacheStats = { files, bytes, updatedAt: new Date().toISOString() };
  return cacheStats;
}

/** Drop radar frames we will never serve again, and enforce the hard cap. */
async function pruneRadarCache(nowMs) {
  let entries = [];
  try {
    entries = await fsp.readdir(RADAR_DIR);
  } catch {
    return;
  }
  const keepBelow = nowMs - lib.SLOT_PAST_MS - lib.SLOT_MS;
  const pngs = entries.filter((name) => name.endsWith(".png"));
  const stale = [];
  for (const name of pngs) {
    const slot = name.slice(0, -4);
    const ms = lib.parseSlotId(slot);
    if (ms === null || ms < keepBelow) stale.push(name);
  }
  for (const name of stale) {
    try {
      await fsp.unlink(path.join(RADAR_DIR, name));
    } catch {
      /* already gone */
    }
  }
  const remaining = pngs.length - stale.length;
  if (remaining > RADAR_FILES_LIMIT) {
    const sorted = pngs
      .filter((name) => !stale.includes(name))
      .sort()
      .slice(0, remaining - RADAR_FILES_LIMIT);
    for (const name of sorted) {
      try {
        await fsp.unlink(path.join(RADAR_DIR, name));
      } catch {
        /* already gone */
      }
    }
  }
}

/* ------------------------------------------------------------------- radar */

const UPSTREAM_CONCURRENCY = 3;
const UPSTREAM_QUEUE_LIMIT = 12;

/** slot -> Promise<Buffer> for renders that are already running. */
const radarInflight = new Map();

const renderSlots = lib.createSemaphore(
  UPSTREAM_CONCURRENCY,
  UPSTREAM_QUEUE_LIMIT,
);

function acquireRenderSlot() {
  return renderSlots.acquire();
}

function releaseRenderSlot() {
  renderSlots.release();
}

/**
 * Radar frames: cache, then de-duplicated inflight, then a bounded render.
 *
 * Three identical cold requests used to start three GeoServer renders. Each
 * render costs 1–10 s upstream plus ~7 MB RSS and ~90 ms of event loop in the
 * PNG post-processor, so an unbounded fan-out on cold slots could exhaust the
 * 128 MB container. Identical slots now share one promise, and at most
 * `UPSTREAM_CONCURRENCY` renders run at a time; beyond a short queue the
 * gateway answers 503 with Retry-After instead of piling up.
 */
async function radarFrame(slot) {
  const cached = radarMemory.get(slot);
  if (cached) return { buffer: cached, cache: "hit" };

  const fromDisk = await readCacheFile(RADAR_DIR, lib.radarCacheName(slot));
  if (fromDisk) {
    radarMemory.set(slot, fromDisk);
    return { buffer: fromDisk, cache: "hit" };
  }

  const inflight = radarInflight.get(slot);
  if (inflight) return { buffer: await inflight, cache: "coalesced" };

  const ticket = acquireRenderSlot();
  if (!ticket) {
    throw new UpstreamError("too many radar renders in flight", {
      status: 503,
      code: "busy",
    });
  }

  const started = Date.now();
  const task = (async () => {
    await ticket;
    try {
      const result = await fetchBuffer(
        lib.radarFrameUrl(slot, { baseUrl: WMS_ENDPOINT }),
      );
      if (!lib.isPng(result.contentType, result.buffer)) {
        noteUpstream("radar", started, "no png for slot");
        throw new UpstreamError("frame not published yet", {
          status: 502,
          code: "frame_unavailable",
        });
      }
      noteUpstream("radar", started, null);
      // Drop DWD's translucent "no data" wash and the magenta coverage ring;
      // the overlay should paint precipitation only.
      const stripped = lib.stripNoDataPng(result.buffer);
      radarMemory.set(slot, stripped);
      await safeWrite(RADAR_DIR, lib.radarCacheName(slot), stripped);
      return stripped;
    } catch (error) {
      noteUpstream("radar", started, error);
      throw error;
    } finally {
      releaseRenderSlot();
    }
  })();

  radarInflight.set(slot, task);
  try {
    const buffer = await task;
    return { buffer, cache: "miss", upstreamMs: Date.now() - started };
  } finally {
    radarInflight.delete(slot);
  }
}

let framesCache = { at: 0, payload: null };
let radarWanted = false;
let lastWarmSlot = null;

function framesPayload(nowMs) {
  if (framesCache.payload && nowMs - framesCache.at < FRAMES_TTL_MS) {
    return framesCache.payload;
  }
  const payload = lib.frameListPayload(nowMs);
  framesCache = { at: nowMs, payload };
  radarWanted = true;
  return payload;
}

/**
 * Keep the newest analysis frame hot. One upstream request per radar slot
 * (i.e. every 5 minutes) turns a 1–7 s GeoServer render into a disk read for
 * every real visitor.
 */
let warming = false;

async function warmRadar() {
  if (!radarWanted) return;
  const nowMs = Date.now();
  const { anchorMs } = lib.buildRadarFrames(nowMs);
  const newest = lib.slotId(anchorMs);
  if (newest === lastWarmSlot) {
    await pruneRadarCache(nowMs);
    return;
  }
  let warmed = true;
  for (const slot of [newest, lib.slotId(anchorMs - lib.SLOT_MS)]) {
    try {
      const had = radarMemory.get(slot);
      await radarFrame(slot);
      if (!had) log("warmed radar", slot);
    } catch (error) {
      log("warm radar failed", slot, String(error?.message ?? error));
      warmed = false;
      break;
    }
  }
  // Only claim the slot when it is actually cached, otherwise the next tick
  // retries instead of leaving the newest slot cold for five minutes.
  if (warmed) lastWarmSlot = newest;
  await pruneRadarCache(nowMs);
}

/* ---------------------------------------------------------------- warnings */

let warningsState = {
  payload: null,
  fetchedAt: 0,
  inflight: null,
};

async function buildWarnings(nowMs) {
  const started = Date.now();
  let raw;
  try {
    raw = await fetchBuffer(WARNINGS_ENDPOINT);
  } catch (error) {
    noteUpstream("warnings", started, error);
    throw error;
  }
  const parsed = lib.parseWarningsJsonp(raw.buffer.toString("utf8"));
  if (!parsed) {
    noteUpstream("warnings", started, "unparseable warnings.json");
    throw new UpstreamError("warnings.json could not be parsed", {
      status: 502,
      code: "warnings_unparseable",
    });
  }
  noteUpstream("warnings", started, null);

  const normalized = lib.normalizeWarnings(parsed, { nowMs });
  const cql = lib.warncellCql(normalized.cells);
  let collection = { type: "FeatureCollection", features: [] };
  let areasError = null;
  if (cql) {
    const areaStarted = Date.now();
    try {
      const res = await fetchBuffer(WFS_ENDPOINT, {
        method: "POST",
        body: lib.warningsRequest(cql),
        timeoutMs: 15_000,
      });
      const parsedAreas = JSON.parse(res.buffer.toString("utf8"));
      if (parsedAreas?.type === "FeatureCollection") {
        collection = parsedAreas;
      } else {
        throw new Error("WFS returned no FeatureCollection");
      }
      noteUpstream("warnAreas", areaStarted, null);
    } catch (error) {
      noteUpstream("warnAreas", areaStarted, error);
      areasError = String(error?.message ?? error);
      log("warning areas failed", areasError);
    }
  }

  return {
    ok: true,
    generated: new Date(nowMs).toISOString(),
    issuedAt: normalized.issuedAt,
    counts: normalized.counts,
    total: normalized.total,
    maxLevel: normalized.maxLevel,
    validUntil: normalized.validUntil,
    warnings: normalized.warnings,
    areas: lib.joinWarningAreas(normalized.warnings, collection),
    areasComplete: !areasError,
    // "WFS down" and "this warncell has no polygon" are different problems:
    // only the second one is worth naming per cell.
    ...(areasError
      ? { areasUnavailable: true }
      : { areasMissing: lib.missingWarncells(normalized.warnings, collection).length }),
    source: {
      warnings: "DWD warnapp warnings.json",
      areas: "DWD WFS Warngebiete (Kreise + Gemeinden)",
    },
    attribution: ATTRIBUTION.warnings,
  };
}

/**
 * Refresh the warnings in the background and return the current payload.
 *
 * A cold build can take up to 2 x 15 s upstream. Blocking a request on that
 * made the client time out for a payload we already had, so anything older
 * than the TTL is served immediately with `X-Cache: stale` while the rebuild
 * runs. Only a first-ever request (no payload at all) waits.
 */
function refreshWarningsInBackground(nowMs) {
  if (warningsState.inflight) return;
  warningsState.inflight = buildWarnings(nowMs)
    .then(async (payload) => {
      warningsState = { payload, fetchedAt: Date.now(), inflight: null };
      await safeWrite(WARNINGS_DIR, WARNINGS_CACHE_FILE, JSON.stringify(payload));
      return payload;
    })
    .catch((error) => {
      warningsState.inflight = null;
      log("warnings refresh failed", String(error?.message ?? error));
      return null;
    });
  warningsState.inflight.catch(() => {});
}

async function warningsPayload(nowMs) {
  const action = lib.warningsCacheAction(warningsState, nowMs, WARNINGS_TTL_MS);

  if (action === "hit") {
    return { payload: warningsState.payload, cache: "hit" };
  }
  if (action === "refresh") {
    refreshWarningsInBackground(nowMs);
    return { payload: warningsState.payload, cache: "stale" };
  }
  if (action === "coalesce") {
    return { payload: await warningsState.inflight, cache: "coalesced" };
  }
  const pending = buildWarnings(nowMs)
    .then(async (payload) => {
      warningsState = { payload, fetchedAt: Date.now(), inflight: null };
      await safeWrite(WARNINGS_DIR, WARNINGS_CACHE_FILE, JSON.stringify(payload));
      return payload;
    })
    .catch(async (error) => {
      warningsState.inflight = null;
      log("warnings upstream failed", String(error?.message ?? error));
      if (warningsState.payload) {
        return warningsState.payload;
      }
      const disk = await loadWarningsFromDisk();
      if (disk) return disk;
      throw error;
    });
  warningsState.inflight = pending;
  return { payload: await pending, cache: "miss" };
}

/**
 * Survive a restart (and a DWD outage) on the last warnings we saw. The
 * payload is only used while it is younger than the stale window.
 */
async function loadWarningsFromDisk() {
  const raw = await readCacheFile(WARNINGS_DIR, WARNINGS_CACHE_FILE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    if (!parsed || parsed.ok !== true) return null;
    const age = Date.now() - Date.parse(parsed.generated ?? 0);
    if (!Number.isFinite(age) || age > WARNINGS_STALE_MS) return null;
    warningsState = { payload: parsed, fetchedAt: Date.now(), inflight: null };
    return parsed;
  } catch {
    return null;
  }
}


/* ----------------------------------------------------------------- routing */

function commonHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function parseRequestUrl(req) {
  try {
    return new URL(req.url, "http://localhost");
  } catch {
    return null;
  }
}

async function handleRadarFrames(req, res, nowMs) {
  const payload = framesPayload(nowMs);
  sendJsonCompressed(req, res, payload, {
    cacheControl: "public, max-age=60",
    extra: { "Access-Control-Allow-Origin": "*" },
  });
  // Someone wants the radar: start warming right away instead of waiting for
  // the next minute tick. GeoServer renders take seconds, so warming early is
  // the difference between "blank map" and "instant" for the next visitor.
  if (!warming) {
    warming = true;
    warmRadar()
      .catch(() => {})
      .finally(() => {
        warming = false;
      });
  }
}

async function handleRadarFrame(req, res, slot, nowMs) {
  if (!lib.isSlotInWindow(slot, nowMs)) {
    return fail(res, 400, "invalid_slot", errorMessage("invalid_slot"));
  }
  let frame;
  try {
    frame = await radarFrame(slot);
  } catch (error) {
    const status = error.status ?? 502;
    const code = error.code ?? "upstream_error";
    return fail(res, status, code, errorMessage(code), {
      upstream: "dwd-radar",
      ...(status === 503 ? { retryAfterSeconds: 3 } : {}),
      ...(status === 503 ? { "Retry-After": "3" } : {}),
    });
  }
  const headers = {
    "Content-Type": "image/png",
    "Content-Length": String(frame.buffer.byteLength),
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: lib.frameEtag(slot),
    "X-Cache": frame.cache,
    "X-Radar-Slot": slot,
    "X-Upstream-Ms": String(frame.upstreamMs ?? 0),
  };
  if (req.headers["if-none-match"] === headers.ETag) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  res.end(frame.buffer);
}

async function handleWarnings(req, res, nowMs) {
  let result;
  try {
    result = await warningsPayload(nowMs);
  } catch (error) {
    const code = error.code ?? "warnings_unavailable";
    return fail(res, error.status ?? 502, code, errorMessage(code), {
      upstream: "dwd-warnings",
    });
  }
  // Age is measured from the payload itself so a restart that restores the
  // disk copy reports the real age instead of zero.
  const issued = Date.parse(result.payload?.generated ?? "");
  const age = Number.isFinite(issued)
    ? Math.max(0, Date.now() - issued)
    : Date.now() - warningsState.fetchedAt;
  const stale = age > WARNINGS_STALE_MS;
  sendJsonCompressed(req, res, result.payload, {
    cacheControl: "public, max-age=300",
    extra: {
      "Access-Control-Allow-Origin": "*",
      "X-Cache": stale ? "stale" : result.cache,
      "X-Cache-Age": String(Math.round(age / 1000)),
    },
  });
}

const server = http.createServer(async (req, res) => {
  for (const [key, value] of Object.entries(commonHeaders())) {
    res.setHeader(key, value);
  }
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = parseRequestUrl(req);
  if (!url) return fail(res, 400, "bad_request", errorMessage("bad_request"));

  const nowMs = Date.now();
  // Routing normalises trailing slashes itself (lib.matchRoute), so the raw
  // pathname is what gets logged and matched.
  const pathname = url.pathname;

  try {
    const route = lib.matchRoute(req.method, pathname);

    if (route.kind === "method_not_allowed") {
      return fail(res, 405, "method_not_allowed", errorMessage("method_not_allowed"));
    }

    if (route.kind === "health" || route.kind === "status") {
      const base = {
        ok: true,
        service: SERVICE,
        version: VERSION,
        uptime: Math.round(process.uptime()),
        now: new Date(nowMs).toISOString(),
      };
      // Operational state only: no filesystem paths, no raw upstream text.
      const detail = {
        cache: {
          writable: cacheWritable,
          files: cacheStats.files,
          bytes: cacheStats.bytes,
        },
        upstreams: Object.fromEntries(
          Object.entries(upstreams).map(([name, state]) => [
            name,
            { ok: state.lastError === null, lastMs: state.lastMs },
          ]),
        ),
      };
      return json(res, 200, { ...base, ...detail });
    }

    if (route.kind === "frames") {
      return await handleRadarFrames(req, res, nowMs);
    }

    if (route.kind === "frame") {
      return await handleRadarFrame(req, res, route.slot, nowMs);
    }

    if (route.kind === "warnings") {
      return await handleWarnings(req, res, nowMs);
    }

    return fail(res, 404, "not_found", errorMessage("not_found"));
  } catch (error) {
    log("unhandled", pathname, String(error?.stack ?? error));
    return fail(res, 500, "internal_error", errorMessage("internal_error"));
  }
});

async function tick() {
  try {
    await warmRadar();
    await refreshCacheStats();
  } catch (error) {
    log("tick failed", String(error?.message ?? error));
  }
}

async function main() {
  await ensureCacheDirs().catch((error) => {
    cacheWritable = false;
    log("cache dir unavailable", String(error));
  });
  await refreshCacheStats();
  await loadWarningsFromDisk();
  // Warm from the first second instead of waiting for a visitor: the newest
  // radar slot costs 1-10 s upstream, and the first visitor should not pay it.
  radarWanted = true;
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
  tick();

  server.listen(PORT, "0.0.0.0", () => {
    log(`${SERVICE} ${VERSION} listening on :${PORT} (cache ${CACHE_DIR})`);
  });

  const shutdown = () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
