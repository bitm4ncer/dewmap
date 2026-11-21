/**
 * Pure helpers for the dewmap data gateway.
 *
 * Split out of server.js so every branch that decides "which slot", "which
 * cache file" or "what does a warning look like" can be unit-tested with
 * `node --test` without starting an HTTP server or touching the network.
 * No dependencies, no I/O.
 */

const SLOT_MS = 5 * 60_000;

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
    typeName: "dwd:Warngebiete_Kreise,dwd:Warngebiete_Gemeinden",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
  });
  if (cql) params.set("CQL_FILTER", cql);
  return params.toString();
}

/* ------------------------------------------------------------------ misc */

/** Stable cache file name for a radar slot. */
function radarCacheName(slot) {
  return `${slot}.png`;
}

function isPng(contentType, buffer) {
  if (typeof contentType === "string" && /image\/png/i.test(contentType)) {
    return true;
  }
  return (
    buffer instanceof Uint8Array &&
    buffer.length > 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

/** ETag for an immutable radar frame. */
function frameEtag(slot) {
  return `"radar-${slot}"`;
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
};
