const assert = require("node:assert/strict");
const test = require("node:test");
const lib = require("./lib.js");

const T0 = Date.UTC(2026, 10, 21, 5, 7, 30); // 2026-11-21T05:07:30Z

test("floorToSlot snaps down to a 5-minute boundary", () => {
  assert.equal(lib.slotId(lib.floorToSlot(T0)), "20261121T0505");
  assert.equal(
    lib.slotId(lib.floorToSlot(Date.UTC(2026, 0, 1, 0, 4, 59))),
    "20260101T0000",
  );
});

test("slotId/parseSlotId round-trip and reject garbage", () => {
  const ms = Date.UTC(2026, 10, 21, 4, 50);
  assert.equal(lib.slotId(ms), "20261121T0450");
  assert.equal(lib.parseSlotId("20261121T0450"), ms);
  assert.equal(lib.parseSlotId("20261121T0451"), null, "off-grid minute");
  assert.equal(lib.parseSlotId("20261121T045"), null, "too short");
  assert.equal(lib.parseSlotId("20260231T0000"), null, "impossible date");
  assert.equal(lib.parseSlotId("20261121T2400"), null, "hour 24");
  assert.equal(lib.parseSlotId(42), null);
});

test("slotToWmsTime formats the ISO8601 dimension value", () => {
  assert.equal(
    lib.slotToWmsTime("20261121T0450"),
    "2026-11-21T04:50:00Z",
  );
  assert.equal(lib.slotToWmsTime("nope"), null);
});

test("slot window bounds what the proxy will ever fetch", () => {
  const now = T0;
  const back = (min) => lib.slotId(lib.floorToSlot(now - min * 60_000));
  const fwd = (min) => lib.slotId(lib.floorToSlot(now + min * 60_000));
  assert.equal(lib.isSlotInWindow(back(60), now), true);
  assert.equal(lib.isSlotInWindow(fwd(60), now), true);
  assert.equal(lib.isSlotInWindow(back(7 * 60), now), false);
  assert.equal(lib.isSlotInWindow(fwd(4 * 60), now), false);
  assert.equal(lib.isSlotInWindow("20261121T0451", now), false);
});

test("radar frames: 12 analysis back-steps then 6 nowcast steps", () => {
  const { anchorMs, frames } = lib.buildRadarFrames(T0);
  assert.equal(anchorMs, Date.UTC(2026, 10, 21, 4, 55), "now - 10 min, floored");
  assert.equal(frames.length, 18);
  const analysis = frames.filter((f) => f.kind === "analysis");
  const forecast = frames.filter((f) => f.kind === "forecast");
  assert.equal(analysis.length, 12);
  assert.equal(forecast.length, 6);
  assert.equal(analysis.at(-1).ms, anchorMs);
  assert.equal(analysis[0].ms, anchorMs - 55 * 60_000);
  assert.equal(forecast[0].ms, anchorMs + 15 * 60_000);
  assert.equal(forecast.at(-1).ms, anchorMs + 90 * 60_000);
  for (let i = 1; i < frames.length; i += 1) {
    assert.ok(frames[i].ms > frames[i - 1].ms, "frames are chronological");
  }
  for (const f of frames) {
    assert.equal(lib.parseSlotId(f.slot), f.ms, `${f.slot} is a valid slot`);
  }
});

test("frame list payload carries urls, bounds and attribution", () => {
  const payload = lib.frameListPayload(T0);
  assert.equal(payload.ok, true);
  assert.equal(payload.anchor, "2026-11-21T04:55:00.000Z");
  assert.equal(payload.image.bounds.length, 4);
  assert.match(payload.attribution.label, /Deutscher Wetterdienst/);
  assert.match(
    payload.frames[0].url,
    /^\/api\/weather\/radar\/frames\/20261121T0400\.png$/,
  );
  assert.match(payload.source, /Radar_rv_product_1x1km_ger/);
});

test("radar WMS url pins the layer, crs, bbox and slot", () => {
  const url = new URL(lib.radarFrameUrl("20261121T0450"));
  assert.equal(url.origin + url.pathname, "https://maps.dwd.de/geoserver/dwd/wms");
  assert.equal(url.searchParams.get("layers"), "Radar_rv_product_1x1km_ger");
  assert.equal(url.searchParams.get("crs"), "EPSG:3857");
  assert.equal(url.searchParams.get("bbox"), lib.RADAR_BBOX);
  assert.equal(url.searchParams.get("time"), "2026-11-21T04:50:00Z");
  assert.equal(url.searchParams.get("transparent"), "true");
  assert.equal(url.searchParams.get("format"), "image/png");
  assert.throws(() => lib.radarFrameUrl("bad"));
});

test("parseWarningsJsonp strips the loadWarnings wrapper", () => {
  const payload = lib.parseWarningsJsonp(
    'warnWetter.loadWarnings({"time":123,"warnings":{}});',
  );
  assert.deepEqual(payload, { time: 123, warnings: {} });
  assert.deepEqual(lib.parseWarningsJsonp('{"a":1}'), { a: 1 });
  assert.equal(lib.parseWarningsJsonp("not json"), null);
  assert.equal(lib.parseWarningsJsonp(null), null);
});

const sample = {
  time: Date.UTC(2026, 10, 21, 4, 51, 54),
  warnings: {
    106535000: [
      {
        state: "Hessen",
        type: 6,
        level: 3,
        start: Date.UTC(2026, 10, 21, 3, 0),
        end: Date.UTC(2026, 10, 21, 12, 0),
        regionName: "Vogelsbergkreis",
        description: "Glättegefahr.",
        event: "MARKANTE GLÄTTE",
        headline: "Amtliche WARNUNG vor MARKANTER GLÄTTE",
        instruction: "Verhalten anpassen.",
        stateShort: "HE",
        altitudeStart: null,
        altitudeEnd: null,
      },
    ],
    801051061: [
      {
        state: "Schleswig-Holstein",
        type: 5,
        level: 4,
        start: Date.UTC(2026, 10, 21, 2, 0),
        end: Date.UTC(2026, 10, 21, 9, 0),
        regionName: "Krempel",
        event: "FROST",
        headline: "Amtliche UNWETTERWARNUNG vor FROST",
        instruction: "Frostschutz.",
        stateShort: "SH",
      },
    ],
  },
  vorabInformation: {
    914628003: [
      {
        state: "Sachsen",
        type: 1,
        level: 1,
        start: Date.UTC(2026, 10, 21, 6, 0),
        end: Date.UTC(2026, 10, 21, 18, 0),
        regionName: "Sächsische Schweiz",
        event: "GEWITTER",
        headline: "Vorabinformation",
        instruction: "",
      },
    ],
  },
};

test("normalizeWarnings flattens, labels, sorts and counts", () => {
  const out = lib.normalizeWarnings(sample, { nowMs: T0 });
  assert.equal(out.total, 3);
  assert.deepEqual(out.counts, { 1: 1, 2: 0, 3: 1, 4: 1 });
  assert.equal(out.maxLevel, 4);
  assert.equal(out.warnings[0].level, 4, "hardest warning first");
  assert.equal(out.warnings[0].event, "FROST");
  assert.equal(out.warnings[0].levelLabel, "Unwetterwarnung");
  assert.equal(out.warnings[0].typeLabel, "Frost");
  assert.equal(out.warnings[0].from, "2026-11-21T02:00:00.000Z");
  assert.equal(out.warnings[1].typeLabel, "Glätte");
  assert.equal(out.warnings[2].levelLabel, "Vorabinformation");
  assert.equal(out.issuedAt, "2026-11-21T04:51:54.000Z");
  assert.deepEqual(out.cells.sort(), ["106535000", "801051061", "914628003"]);
  assert.equal(new Set(out.warnings.map((w) => w.id)).size, 3, "ids are unique");
});

test("normalizeWarnings survives empty and malformed payloads", () => {
  const empty = lib.normalizeWarnings({ time: 0, warnings: {} }, { nowMs: T0 });
  assert.equal(empty.total, 0);
  assert.equal(empty.maxLevel, 0);
  assert.deepEqual(empty.counts, { 1: 0, 2: 0, 3: 0, 4: 0 });
  const junk = lib.normalizeWarnings(null, { nowMs: T0 });
  assert.equal(junk.total, 0);
  const weird = lib.normalizeWarnings(
    { warnings: { 1: [null, { level: 99, type: "x" }] } },
    { nowMs: T0 },
  );
  assert.equal(weird.total, 1);
  assert.equal(weird.warnings[0].level, 4, "level is clamped");
  assert.equal(weird.warnings[0].typeLabel, "Wetter");
});

test("warncellCql keeps only numeric ids and dedupes", () => {
  assert.equal(
    lib.warncellCql(["106535000", "106535000", "801051061"]),
    "WARNCELLID IN (106535000,801051061)",
  );
  assert.equal(lib.warncellCql([]), null);
  assert.equal(lib.warncellCql(["1 OR 1=1"]), null);
  assert.equal(lib.warncellCql(["12"]), null, "too short to be a warncell");
});

test("joinWarningAreas attaches only warned cells and summarises them", () => {
  const normalized = lib.normalizeWarnings(sample, { nowMs: T0 });
  const collection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [] },
        properties: { WARNCELLID: 106535000, NAME: "Vogelsbergkreis" },
      },
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [] },
        properties: { WARNCELLID: 999999999, NAME: "Unwarned" },
      },
    ],
  };
  const out = lib.joinWarningAreas(normalized.warnings, collection);
  assert.equal(out.type, "FeatureCollection");
  assert.equal(out.features.length, 1, "cell without warning is dropped");
  const props = out.features[0].properties;
  assert.equal(props.cellId, "106535000");
  assert.equal(props.level, 3);
  assert.equal(props.count, 1);
  assert.match(props.event, /GLÄTTE/);
  assert.equal(props.area, "Vogelsbergkreis");
});

test("warningsRequest builds a WFS query without leaking parameters", () => {
  const query = new URLSearchParams(lib.warningsRequest("WARNCELLID IN (1)"));
  assert.equal(query.get("service"), "WFS");
  assert.equal(query.get("request"), "GetFeature");
  assert.equal(query.get("outputFormat"), "application/json");
  assert.equal(query.get("CQL_FILTER"), "WARNCELLID IN (1)");
  assert.match(query.get("typeName"), /Warngebiete_Kreise/);
  assert.equal(new URLSearchParams(lib.warningsRequest(null)).has("CQL_FILTER"), false);
});

test("isPng requires the magic bytes, the content type alone is not enough", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.equal(lib.isPng("image/png", png), true);
  assert.equal(lib.isPng("", png), true);
  assert.equal(lib.isPng("image/png", Buffer.alloc(0)), false, "no bytes, no png");
  assert.equal(
    lib.isPng("image/png", Buffer.from("<xml/>")),
    false,
    "a mislabelled body is not a png",
  );
  assert.equal(lib.isPng("text/xml", Buffer.from("<xml/>")), false);
  assert.equal(
    lib.isPng("text/xml", png),
    false,
    "png bytes behind a wrong type are rejected too",
  );
  assert.equal(lib.isPng("image/png;charset=binary", png), true);
});

test("cache keys and etags are stable per slot", () => {
  assert.equal(lib.radarCacheName("20261121T0450"), "20261121T0450.png");
  assert.equal(lib.frameEtag("20261121T0450"), '"radar-20261121T0450"');
  assert.equal(lib.frameEtag("20261121T0450"), lib.frameEtag("20261121T0450"));
});

/* ------------------------------------------------------------- png strip */

const zlib = require("node:zlib");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
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
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  return Buffer.concat([head, data, crc]);
}
/** Independent encoder for fixtures: no filters, one IDAT chunk. */
function encodePng(width, height, rows, colorType = 6) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const raw = Buffer.alloc(height * (rows[0].length + 1));
  rows.forEach((row, y) => {
    raw[y * (row.length + 1)] = 0;
    row.copy(raw, y * (row.length + 1) + 1);
  });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
/** Decode our own stripped output (unfiltered rows only) for assertions. */
function decodeRows(png) {
  let offset = 8;
  const idat = [];
  let width = 0;
  let height = 0;
  let colorType = 6;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    assert.equal(raw[y * (stride + 1)], 0, "strip writes filter type 0");
    rows.push(Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))));
  }
  return { width, height, colorType, rows };
}

test("stripNoDataPng clears the grey wash and the coverage ring", () => {
  const wash = Buffer.from([126, 126, 126, 77]);
  const ring = Buffer.from([251, 0, 255, 255]);
  const rain = Buffer.from([51, 255, 255, 255]);
  const empty = Buffer.from([255, 255, 255, 0]);
  const png = encodePng(4, 1, [Buffer.concat([wash, ring, rain, empty])]);

  const out = lib.stripNoDataPng(png);
  assert.ok(out.length > 0);
  const { rows } = decodeRows(out);
  assert.deepEqual([...rows[0].subarray(0, 4)], [126, 126, 126, 0]);
  assert.deepEqual([...rows[0].subarray(4, 8)], [251, 0, 255, 0]);
  assert.deepEqual([...rows[0].subarray(8, 12)], [51, 255, 255, 255]);
  assert.deepEqual([...rows[0].subarray(12, 16)], [255, 255, 255, 0]);
});

test("stripNoDataPng keeps radar classes untouched", () => {
  const classes = [
    [51, 255, 255],
    [26, 204, 154],
    [1, 153, 52],
    [229, 0, 76],
    [204, 0, 152],
    [102, 0, 203],
    [0, 0, 254],
  ];
  const pixels = classes.flatMap((c) => [...c, 255]);
  const png = encodePng(classes.length, 1, [Buffer.from(pixels)]);
  assert.equal(lib.stripNoDataPng(png), png, "untouched when nothing matches");
});

test("stripNoDataPng handles RGB without alpha", () => {
  const png = encodePng(
    2,
    1,
    [Buffer.from([126, 126, 126, 51, 255, 255])],
    2,
  );
  const { rows, colorType } = decodeRows(lib.stripNoDataPng(png));
  assert.equal(colorType, 2);
  assert.deepEqual([...rows[0]], [0, 0, 0, 51, 255, 255]);
});

test("stripNoDataPng passes through unsupported formats", () => {
  const notPng = Buffer.from("GIF89a-not-a-png");
  assert.equal(lib.stripNoDataPng(notPng), notPng);

  const palette = encodePng(1, 1, [Buffer.from([0, 0, 0, 0])]);
  palette[25] = 3; // IHDR colour type: palette
  assert.equal(lib.stripNoDataPng(palette), palette);

  const interlaced = encodePng(1, 1, [Buffer.from([1, 2, 3, 4])]);
  interlaced[28] = 1; // IHDR interlace flag
  assert.equal(lib.stripNoDataPng(interlaced), interlaced);
});

test("no-data and ring classifiers do not eat palette colours", () => {
  assert.equal(lib.isNoDataWash(126, 126, 126, 77), true);
  assert.equal(lib.isNoDataWash(126, 126, 126, 255), false, "opaque grey is data");
  assert.equal(lib.isNoDataWash(51, 255, 255, 255), false);
  assert.equal(lib.isCoverageRing(251, 0, 255, 255), true);
  assert.equal(lib.isCoverageRing(165, 85, 167, 99), true, "anti-aliased edge");
  assert.equal(lib.isCoverageRing(204, 0, 152, 255), false, "#cc0098 class");
  assert.equal(lib.isCoverageRing(102, 0, 203, 255), false, "#6600cb class");
  assert.equal(lib.isCoverageRing(229, 0, 76, 255), false, "#e5004c class");
});

/* --------------------------------------------------------------- routing */

test("matchRoute maps every public path to its handler", () => {
  assert.equal(lib.matchRoute("GET", "/health").kind, "health");
  assert.equal(lib.matchRoute("HEAD", "/health").kind, "health");
  assert.equal(lib.matchRoute("GET", "/api/status").kind, "status");
  assert.equal(lib.matchRoute("GET", "/api/weather/radar/frames").kind, "frames");
  assert.equal(lib.matchRoute("GET", "/api/weather/warnings").kind, "warnings");
  const frame = lib.matchRoute(
    "GET",
    "/api/weather/radar/frames/20261121T1410.png",
  );
  assert.equal(frame.kind, "frame");
  assert.equal(frame.slot, "20261121T1410");
});

test("matchRoute rejects everything else without touching an upstream", () => {
  assert.equal(lib.matchRoute("POST", "/api/weather/warnings").kind, "method_not_allowed");
  assert.equal(lib.matchRoute("DELETE", "/health").kind, "method_not_allowed");
  assert.equal(lib.matchRoute("GET", "/api/weather/radar/frames/").kind, "not_found");
  assert.equal(lib.matchRoute("GET", "/api/weather/radar/frames/20261121T141.png").kind, "not_found");
  assert.equal(lib.matchRoute("GET", "/api/weather/radar/frames/20261121T1410").kind, "not_found");
  assert.equal(lib.matchRoute("GET", "/api/weather/radar/frames/..%2F..%2Fhealth.png").kind, "not_found");
  assert.equal(lib.matchRoute("GET", "/api/weather/nope").kind, "not_found");
  assert.equal(lib.matchRoute("GET", "/").kind, "not_found");
});

/* ------------------------------------------------------- warncell geometry */

test("missingWarncells lists warned cells the geometry layers do not cover", () => {
  const warnings = [{ cellId: "1" }, { cellId: "2" }, { cellId: "3" }];
  const collection = {
    type: "FeatureCollection",
    features: [{ properties: { WARNCELLID: 1 } }],
  };
  assert.deepEqual(lib.missingWarncells(warnings, collection).sort(), ["2", "3"]);
  assert.deepEqual(lib.missingWarncells(warnings, { features: [] }).sort(), [
    "1",
    "2",
    "3",
  ]);
  assert.deepEqual(
    lib.missingWarncells(warnings, {
      features: [{ properties: { WARNCELLID: 1 } }, { properties: { WARNCELLID: 2 } }, { properties: { WARNCELLID: 3 } }],
    }),
    [],
  );
});

/* ------------------------------------------------------------ png limits */

test("stripNoDataPng refuses images above the decode budget", () => {
  // 2400 x 1800 RGB = 4.32 Mpx: above MAX_PNG_PIXELS (4 Mpx) but still below
  // the raw byte cap, so this exercises the pixel guard specifically.
  const rows = Array.from({ length: 1800 }, () => Buffer.alloc(2400 * 3));
  const png = encodePng(2400, 1800, rows, 2);
  assert.ok(2400 * 1800 > lib.MAX_PNG_PIXELS);
  assert.equal(lib.stripNoDataPng(png), png, "returned untouched, not decoded");
  assert.ok(lib.MAX_PNG_PIXELS <= 4_000_000);
  assert.ok(lib.MAX_PNG_RAW_BYTES <= 20 * 1024 * 1024);
});

test("stripNoDataPng survives a truncated IDAT", () => {
  const png = encodePng(4, 1, [Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]);
  const broken = Buffer.from(png);
  broken[broken.length - 20] = 0x00; // corrupt the compressed stream
  assert.doesNotThrow(() => lib.stripNoDataPng(broken));
});

/* ------------------------------------------------------------- semaphore */

test("semaphore admits exactly `limit` callers and queues the rest", async () => {
  const sem = lib.createSemaphore(3, 12);
  const tickets = [];
  for (let i = 0; i < 6; i += 1) tickets.push(sem.acquire());
  await Promise.resolve();
  assert.equal(sem.active, 3);
  assert.equal(sem.queued, 3);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await tickets[i], true, `ticket ${i} was admitted`);
  }

  sem.release();
  assert.equal(await tickets[3], true, "first waiter got the slot");
  assert.equal(sem.active, 3, "the count stays at the limit during handover");
  assert.equal(sem.queued, 2);

  // Each release hands the slot to the next waiter; the two remaining waiters
  // only free their slots when they release too.
  sem.release();
  sem.release();
  sem.release();
  assert.equal(sem.active, 2, "handovers keep the slots occupied");
  assert.equal(sem.queued, 0);
  sem.release();
  sem.release();
  assert.equal(sem.active, 0, "all six holders released");
});

test("semaphore rejects past the queue limit instead of growing forever", async () => {
  const sem = lib.createSemaphore(2, 3);
  const accepted = [];
  const rejected = [];
  for (let i = 0; i < 10; i += 1) {
    const ticket = sem.acquire();
    if (ticket === null) rejected.push(i);
    else accepted.push(ticket);
  }
  assert.equal(sem.active, 2);
  assert.equal(sem.queued, 3);
  assert.equal(rejected.length, 5, "everything past limit + queue is refused");
  for (const ticket of accepted) {
    sem.release();
    await ticket;
  }
});

test("semaphore recovers after busy work completes", async () => {
  const sem = lib.createSemaphore(1, 0);
  assert.equal(await sem.acquire(), true);
  assert.equal(sem.acquire(), null, "no queue space");
  sem.release();
  assert.equal(sem.active, 0);
  assert.equal(await sem.acquire(), true, "the slot is available again");
});
