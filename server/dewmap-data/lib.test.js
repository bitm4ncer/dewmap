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

test("isPng trusts the magic bytes over a wrong content type", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.equal(lib.isPng("image/png", Buffer.alloc(0)), true);
  assert.equal(lib.isPng("", png), true);
  assert.equal(lib.isPng("text/xml", Buffer.from("<xml/>")), false);
  assert.equal(
    lib.isPng("text/xml", Buffer.from('<?xml version="1.0"?><e/>')),
    false,
  );
});

test("cache keys and etags are stable per slot", () => {
  assert.equal(lib.radarCacheName("20261121T0450"), "20261121T0450.png");
  assert.equal(lib.frameEtag("20261121T0450"), '"radar-20261121T0450"');
  assert.equal(lib.frameEtag("20261121T0450"), lib.frameEtag("20261121T0450"));
});
