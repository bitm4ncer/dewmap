/**
 * Pure helpers for the dewmap data gateway.
 *
 * Split out of server.js so every branch that decides "which slot", "which
 * cache file" or "what does a warning look like" can be unit-tested with
 * `node --test` without starting an HTTP server or touching the network.
 * No dependencies, no I/O.
 */

const SLOT_MS = 5 * 60_000;

/**
 * Decoding budget for the radar post-processor. Two full-size pixel buffers
 * (inflated + re-encoded) plus the compression window have to fit next to the
 * ~20 MB base RSS in a 128 MB container.
 */
const MAX_PNG_PIXELS = 1_500_000;
const MAX_PNG_RAW_BYTES = 20 * 1024 * 1024;

/** DWD radar composite RV over Germany, in web mercator metres. */
const RADAR_BBOX = "162894,5729950,2085194,7602217";
/** Same extent as lon/lat, used by the client as image coordinates. */
const RADAR_BOUNDS = [1.4633, 45.6846, 18.7316, 56.2194];
const RADAR_LAYER = "Radar_rv_product_1x1km_ger";
const RADAR_IMAGE = { width: 1000, height: 974 };

/** Analysis window: 12 frames x 5 min, ending at the anchor slot. */
const ANALYSIS_FRAMES = 12;
/** Nowcast window: 6 frames x 15 min, starting 15 min after the anchor. */
const FORECAST_FRAMES = 6;
const FORECAST_STEP_MS = 15 * 60_000;
/**
 * DWD publishes the RV composite with a few minutes of lag. Measured on
 * 2026-11-21: newest available slot was 6 min behind the wall clock.
 */
const ANALYSIS_LAG_MS = 10 * 60_000;

/** Slots we are willing to fetch at all (bounds the disk cache). */
const SLOT_PAST_MS = 6 * 60 * 60_000;
const SLOT_FUTURE_MS = 3 * 60 * 60_000;

function floorToSlot(ms) {
  return Math.floor(ms / SLOT_MS) * SLOT_MS;
}

const pad = (n) => String(n).padStart(2, "0");

/** Epoch ms -> `YYYYMMDDTHHMM` (UTC). URL and cache-file safe. */
function slotId(ms) {
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}

/** `YYYYMMDDTHHMM` -> epoch ms, or null when the string is not a 5-min slot. */
function parseSlotId(id) {
  if (typeof id !== "string" || !/^\d{8}T\d{4}$/.test(id)) return null;
  const year = Number(id.slice(0, 4));
  const month = Number(id.slice(4, 6));
  const day = Number(id.slice(6, 8));
  const hour = Number(id.slice(9, 11));
  const minute = Number(id.slice(11, 13));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || minute % 5 !== 0) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  // Reject 20260231T0000 and friends.
  const back = slotId(ms);
  return back === id ? ms : null;
}

/** `YYYYMMDDTHHMM` -> `YYYY-MM-DDTHH:MM:00Z` (the WMS time dimension value). */
function slotToWmsTime(id) {
  const ms = parseSlotId(id);
  if (ms === null) return null;
  return `${new Date(ms).toISOString().slice(0, 16)}:00Z`;
}

function isSlotInWindow(id, nowMs) {
  const ms = parseSlotId(id);
  if (ms === null) return false;
  return ms >= nowMs - SLOT_PAST_MS && ms <= nowMs + SLOT_FUTURE_MS;
}

function radarFrameUrl(slot, { baseUrl } = {}) {
  const time = slotToWmsTime(slot);
  if (!time) throw new Error(`invalid slot ${slot}`);
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: RADAR_LAYER,
    styles: "",
    crs: "EPSG:3857",
    bbox: RADAR_BBOX,
    width: String(RADAR_IMAGE.width),
    height: String(RADAR_IMAGE.height),
    format: "image/png",
    transparent: "true",
    time,
  });
  return `${baseUrl ?? "https://maps.dwd.de/geoserver/dwd/wms"}?${params}`;
}

/**
 * The frame list the client animates.
 *
 * `anchor` is the newest analysis slot we consider safely published. Analysis
 * frames step back in 5-minute increments, nowcast frames step forward in
 * 15-minute increments because RV's forecast is coarser than its analysis.
 */
function buildRadarFrames(nowMs) {
  const anchor = floorToSlot(nowMs - ANALYSIS_LAG_MS);
  const frames = [];
  for (let i = ANALYSIS_FRAMES - 1; i >= 0; i -= 1) {
    const ms = anchor - i * SLOT_MS;
    frames.push({ slot: slotId(ms), ms, kind: "analysis" });
  }
  for (let i = 1; i <= FORECAST_FRAMES; i += 1) {
    const ms = anchor + i * FORECAST_STEP_MS;
    frames.push({ slot: slotId(ms), ms, kind: "forecast" });
  }
  return { anchorMs: anchor, frames };
}

function frameListPayload(nowMs, { basePath = "" } = {}) {
  const { anchorMs, frames } = buildRadarFrames(nowMs);
  return {
    ok: true,
    generated: new Date(nowMs).toISOString(),
    now: new Date(Math.floor(nowMs / 60_000) * 60_000).toISOString(),
    anchor: new Date(anchorMs).toISOString(),
    intervalMinutes: SLOT_MS / 60_000,
    forecastIntervalMinutes: FORECAST_STEP_MS / 60_000,
    image: { ...RADAR_IMAGE, bounds: RADAR_BOUNDS },
    source: `DWD GeoServer · ${RADAR_LAYER}`,
    attribution: {
      label: "Deutscher Wetterdienst (DWD)",
      url: "https://www.dwd.de",
    },
    frames: frames.map((f) => ({
      slot: f.slot,
      time: new Date(f.ms).toISOString(),
      kind: f.kind,
      url: `${basePath}/api/weather/radar/frames/${f.slot}.png`,
    })),
  };
}

/* -------------------------------------------------------------- warnings */

const LEVEL_LABELS = {
  1: "Vorabinformation",
  2: "Wetterwarnung",
  3: "Markante Wetterwarnung",
  4: "Unwetterwarnung",
};

const TYPE_LABELS = {
  1: "Wind",
  2: "Regen",
  3: "Schnee",
  4: "Nebel",
  5: "Frost",
  6: "Glätte",
  7: "Tauwetter",
  8: "Hitze",
  9: "UV",
  10: "Gewitter",
  11: "Gewitter",
};

function levelLabel(level) {
  return LEVEL_LABELS[level] ?? "Wetterwarnung";
}

function typeLabel(type) {
  return TYPE_LABELS[type] ?? "Wetter";
}

/**
 * warnings.json is served as `warnWetter.loadWarnings({...});` — a JSONP body,
 * not plain JSON. Strip the wrapper defensively: accept a bare object too.
 */
function parseWarningsJsonp(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function isoOrNull(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clampLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(4, Math.round(n)));
}

/** One normalised warning. Keeps the fields the panel and the popup show. */
function normalizeWarning(cellId, raw) {
  const level = clampLevel(raw.level);
  const start = typeof raw.start === "number" ? raw.start : 0;
  const end = typeof raw.end === "number" ? raw.end : 0;
  const type = Number(raw.type);
  return {
    id: `${cellId}-${start}-${type}-${level}`,
    cellId: String(cellId),
    level,
    levelLabel: levelLabel(level),
    type: Number.isFinite(type) ? type : null,
    typeLabel: typeLabel(type),
    event: cleanText(raw.event) || "Wetterwarnung",
    headline: cleanText(raw.headline) || cleanText(raw.event) || "Wetterwarnung",
    description: cleanText(raw.description),
    instruction: cleanText(raw.instruction),
    area: cleanText(raw.regionName) || cleanText(raw.areaName),
    state: cleanText(raw.state),
    stateShort: cleanText(raw.stateShort),
    from: isoOrNull(start),
    to: isoOrNull(end),
    altitudeFrom:
      typeof raw.altitudeStart === "number" ? raw.altitudeStart : null,
    altitudeTo: typeof raw.altitudeEnd === "number" ? raw.altitudeEnd : null,
  };
}

/**
 * Flattens the warncell map into a sorted list plus per-level counts.
 * Sorted hardest first, then by start: the panel shows a leader, not a dump.
 */
function normalizeWarnings(payload, { nowMs = Date.now() } = {}) {
  const warnings = [];
  const cells = new Set();
  const push = (cellId, raw) => {
    if (!raw || typeof raw !== "object") return;
    const w = normalizeWarning(cellId, raw);
    warnings.push(w);
    cells.add(w.cellId);
  };

  const map = payload && typeof payload === "object" ? payload.warnings : null;
  if (map && typeof map === "object") {
    for (const [cellId, list] of Object.entries(map)) {
      if (Array.isArray(list)) for (const raw of list) push(cellId, raw);
    }
  }
  const advance = payload?.vorabInformation;
  if (advance && typeof advance === "object") {
    for (const [cellId, list] of Object.entries(advance)) {
      if (Array.isArray(list)) for (const raw of list) push(cellId, raw);
    }
  }

  warnings.sort((a, b) => {
    if (b.level !== a.level) return b.level - a.level;
    const at = a.from ? Date.parse(a.from) : 0;
    const bt = b.from ? Date.parse(b.from) : 0;
    return at - bt || a.area.localeCompare(b.area, "de");
  });

  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const w of warnings) counts[w.level] += 1;

  const latest = warnings.reduce((max, w) => {
    const t = w.to ? Date.parse(w.to) : 0;
    return t > max ? t : max;
  }, 0);

  return {
    issuedAt: isoOrNull(Number(payload?.time)) ?? null,
    generated: new Date(nowMs).toISOString(),
    counts,
    total: warnings.length,
    maxLevel: warnings.reduce((m, w) => Math.max(m, w.level), 0),
    validUntil: latest > nowMs ? new Date(latest).toISOString() : null,
    warnings,
    cells: [...cells],
  };
}

/**
 * Joins the warncell polygons we fetched from the DWD WFS with the warnings we
 * already normalised. Only cells that carry a warning end up on the map.
 */
function joinWarningAreas(warnings, collection) {
  const byCell = new Map();
  for (const w of warnings) {
    const list = byCell.get(w.cellId);
    if (list) list.push(w);
    else byCell.set(w.cellId, [w]);
  }
  const features = [];
  const source = Array.isArray(collection?.features) ? collection.features : [];
  for (const feature of source) {
    const props = feature?.properties;
    if (!props) continue;
    const cellId = String(props.WARNCELLID ?? props.warncellid ?? "");
    const list = byCell.get(cellId);
    if (!list || list.length === 0 || !feature.geometry) continue;
    const worst = list.reduce((a, b) => (b.level > a.level ? b : a), list[0]);
    const from = list
      .map((w) => w.from)
      .filter(Boolean)
      .sort()[0] ?? null;
    const to =
      list
        .map((w) => w.to)
        .filter(Boolean)
        .sort()
        .at(-1) ?? null;
    features.push({
      type: "Feature",
      geometry: feature.geometry,
      properties: {
        cellId,
        level: worst.level,
        count: list.length,
        label: worst.levelLabel,
        event: [...new Set(list.map((w) => w.event))].join(", "),
        headline: worst.headline,
        area: cleanText(props.NAME) || worst.area,
        from,
        to,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * Warned cells that the DWD geometry layers do not cover (combined city cells,
 * sea areas). They are legitimate warnings without a polygon, so the panel
 * reports the count instead of pretending the map is complete.
 */
function missingWarncells(warnings, collection) {
  const covered = new Set(
    (Array.isArray(collection?.features) ? collection.features : [])
      .map((feature) => String(feature?.properties?.WARNCELLID ?? ""))
      .filter(Boolean),
  );
  const missing = new Set();
  for (const warning of warnings) {
    if (!covered.has(String(warning.cellId))) missing.add(String(warning.cellId));
  }
  return [...missing];
}

/** CQL for the WFS call: only the warncells that actually have a warning. */
function warncellCql(cellIds) {
  const ids = [...new Set(cellIds.map((id) => String(id)))].filter((id) =>
    /^\d{6,12}$/.test(id),
  );
  if (ids.length === 0) return null;
  return `WARNCELLID IN (${ids.join(",")})`;
}

function warningsRequest(cql) {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeName:
      "dwd:Warngebiete_Kreise,dwd:Warngebiete_Gemeinden,dwd:Warngebiete_Binnenseen",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });
  if (cql) params.set("CQL_FILTER", cql);
  return params.toString();
}

/* -------------------------------------------------------------- semaphore */

/**
 * Counting semaphore with a bounded wait queue.
 *
 * `acquire()` resolves with true when a slot is free or the caller may wait,
 * and with null when the queue is already full — the caller answers 503
 * instead of letting unbounded work pile up behind a slow upstream.
 */
function createSemaphore(limit, queueLimit) {
  let active = 0;
  const queue = [];
  return {
    get active() {
      return active;
    },
    get queued() {
      return queue.length;
    },
    acquire() {
      if (active < limit) {
        active += 1;
        return Promise.resolve(true);
      }
      if (queue.length >= queueLimit) return null;
      return new Promise((resolve) => {
        queue.push(resolve);
      });
    },
    release() {
      const next = queue.shift();
      if (next) {
        // Hand the slot straight over; the count stays the same.
        next(true);
        return;
      }
      active = Math.max(0, active - 1);
    },
  };
}

/* -------------------------------------------------------------- cache policy */

/**
 * What to do with a warnings request: serve fresh, serve stale and refresh in
 * the background, wait for the run that is already going, or build now.
 *
 * Pure so the policy is testable — the HTTP path only maps the answer onto a
 * response.
 */
function warningsCacheAction(state, nowMs, ttlMs) {
  const hasPayload = Boolean(state?.payload);
  if (hasPayload && nowMs - (state.fetchedAt ?? 0) < ttlMs) return "hit";
  if (hasPayload) return "refresh";
  if (state?.inflight) return "coalesce";
  return "build";
}

/* ---------------------------------------------------------------- routing */

const FRAME_PATH = /^\/api\/weather\/radar\/frames\/(\d{8}T\d{4})\.png$/;

/**
 * Pure request routing, so the paths that decide "what does this request do"
 * can be tested without an HTTP server. `server.js` only executes the verdict.
 *
 * Trailing slashes are normalised here and not in the HTTP layer: `/health/`
 * and `/api/weather/radar/frames/` are the same endpoint, and the rule that
 * decides this is part of what the tests cover.
 */
function normalizePath(pathname) {
  if (typeof pathname !== "string" || pathname.length === 0) return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed.length === 0 ? "/" : trimmed;
}

function matchRoute(method, pathname) {
  if (method !== "GET" && method !== "HEAD") {
    return { kind: "method_not_allowed" };
  }
  const path = normalizePath(pathname);
  if (path === "/health") return { kind: "health" };
  if (path === "/api/status") return { kind: "status" };
  if (path === "/api/weather/radar/frames") return { kind: "frames" };
  const frame = path.match(FRAME_PATH);
  if (frame) return { kind: "frame", slot: frame[1] };
  if (path === "/api/weather/warnings") return { kind: "warnings" };
  return { kind: "not_found" };
}

/* ------------------------------------------------------------------ misc */

/** Stable cache file name for a radar slot. */
function radarCacheName(slot) {
  return `${slot}.png`;
}

/**
 * A frame is a PNG only if the bytes say so. The content type alone is not
 * enough: a mislabelled body would otherwise be cached as `image/png` for a
 * year and served forever. When a type is given it must also be a PNG type,
 * so `text/xml` with PNG bytes is still rejected.
 */
function isPng(contentType, buffer) {
  if (!(buffer instanceof Uint8Array) || buffer.length < 8) return false;
  const magic =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (!magic) return false;
  if (typeof contentType === "string" && contentType.length > 0) {
    return /image\/(png|x-png)/i.test(contentType);
  }
  return true;
}

/** ETag for an immutable radar frame. */
function frameEtag(slot) {
  return `"radar-${slot}"`;
}

/* ------------------------------------------------------------------- png */

/**
 * DWD renders two things we do not want over a basemap: a 30 %-alpha grey
 * wash for "no echo / no data" across the whole radar coverage, and a
 * magenta outline around the composite's edge. Both are style artefacts of
 * the GeoServer layer, not weather. We strip exactly those pixels and keep
 * everything else byte-for-byte.
 *
 * Implemented on node:zlib only: 8-bit non-interlaced RGB/RGBA PNGs are
 * decoded, filtered and re-encoded. Anything else is returned untouched, so
 * a format change upstream degrades to the old behaviour instead of breaking
 * the overlay.
 */

const zlib = require("node:zlib");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function readPngChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Near-neutral mid-grey: DWD's "no echo / no data" tone. */
function isNoDataGrey(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min <= 12 && max > 100 && max < 160;
}

/** Grey wash: the no-data tone, painted translucent so the map shows through. */
function isNoDataWash(r, g, b, a) {
  if (a === 0 || a > 200) return false;
  return isNoDataGrey(r, g, b);
}

/**
 * Coverage outline: magenta and its anti-aliased blends. The radar classes
 * never land here — the closest ones (#e5004c, #cc0098, #6600cb) have either
 * a low blue channel or a large red/blue split.
 */
function isCoverageRing(r, g, b, a) {
  if (a === 0 || g >= 115) return false;
  return r > 150 && b > 120 && Math.abs(r - b) < 45;
}

function stripNoDataPng(buffer) {
  if (!isPng("", buffer)) return buffer;
  let chunks;
  try {
    chunks = readPngChunks(buffer);
  } catch {
    return buffer;
  }
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (!ihdr || ihdr.data.length < 13) return buffer;
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8 || interlace !== 0) return buffer;
  if (colorType !== 6 && colorType !== 2) return buffer;
  // A DWD frame is 1000x974 = 0.97 Mpx. 1.5 Mpx leaves head room for a slightly
  // larger composite but keeps a hostile input from blocking the event loop for
  // long: right at the cap a decode costs ~130 ms and ~36 MB.
  if (width === 0 || height === 0 || width * height > MAX_PNG_PIXELS) {
    return buffer;
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rawLength = height * (stride + 1);
  // `inflateSync` without a bound is the one place where a broken upstream
  // could hand us a gigabyte. Bound the output to exactly what the header
  // promises, and refuse anything that would not fit the container budget.
  if (rawLength > MAX_PNG_RAW_BYTES) return buffer;
  let inflated;
  try {
    inflated = zlib.inflateSync(
      Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)),
      { maxOutputLength: rawLength + 1024 },
    );
  } catch {
    return buffer;
  }
  if (inflated.length < rawLength) return buffer;

  const out = Buffer.alloc(rawLength);
  let previous = Buffer.alloc(stride);
  let changed = false;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)];
    const rowIn = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = previous[x];
      const c = x >= bpp ? previous[x - bpp] : 0;
      let value;
      switch (filter) {
        case 0:
          value = rowIn[x];
          break;
        case 1:
          value = rowIn[x] + a;
          break;
        case 2:
          value = rowIn[x] + b;
          break;
        case 3:
          value = rowIn[x] + ((a + b) >> 1);
          break;
        case 4:
          value = rowIn[x] + paeth(a, b, c);
          break;
        default:
          return buffer;
      }
      row[x] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const i = x * bpp;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const alpha = bpp === 4 ? row[i + 3] : 255;
      const noData =
        bpp === 4 ? isNoDataWash(r, g, b, alpha) : isNoDataGrey(r, g, b);
      if (noData || isCoverageRing(r, g, b, alpha)) {
        if (bpp === 4) row[i + 3] = 0;
        else {
          row[i] = 0;
          row[i + 1] = 0;
          row[i + 2] = 0;
        }
        changed = true;
      }
    }
    out[y * (stride + 1)] = 0;
    row.copy(out, y * (stride + 1) + 1);
    previous = row;
  }
  if (!changed) return buffer;

  const body = zlib.deflateSync(out, { level: 6 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr.data),
    pngChunk("IDAT", body),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

module.exports = {
  SLOT_MS,
  RADAR_BBOX,
  RADAR_BOUNDS,
  RADAR_LAYER,
  RADAR_IMAGE,
  ANALYSIS_FRAMES,
  FORECAST_FRAMES,
  FORECAST_STEP_MS,
  ANALYSIS_LAG_MS,
  SLOT_PAST_MS,
  SLOT_FUTURE_MS,
  floorToSlot,
  slotId,
  parseSlotId,
  slotToWmsTime,
  isSlotInWindow,
  radarFrameUrl,
  buildRadarFrames,
  frameListPayload,
  LEVEL_LABELS,
  TYPE_LABELS,
  levelLabel,
  typeLabel,
  parseWarningsJsonp,
  normalizeWarning,
  normalizeWarnings,
  joinWarningAreas,
  warncellCql,
  warningsRequest,
  radarCacheName,
  isPng,
  frameEtag,
  createSemaphore,
  warningsCacheAction,
  normalizePath,
  matchRoute,
  missingWarncells,
  MAX_PNG_PIXELS,
  MAX_PNG_RAW_BYTES,
  stripNoDataPng,
  isCoverageRing,
  isNoDataWash,
  isNoDataGrey,
};
