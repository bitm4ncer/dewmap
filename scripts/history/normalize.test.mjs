import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeSites,
  normalizeCsvText,
  normalizeRow,
  parseWktPoint,
  parseYear,
  toGeoJsonLine,
} from "./normalize.mjs";

function row(overrides = {}) {
  return {
    item: "http://www.wikidata.org/entity/Q100",
    name: "Test Castle",
    coord: "POINT(6.95 50.94)",
    inception: "1848-01-01T00:00:00Z",
    dissolved: "",
    types: "Q23413|Q210272",
    heritage: "true",
    unesco: "false",
    ...overrides,
  };
}

describe("parseWktPoint", () => {
  it("parses Wikidata WKT points in lon/lat order", () => {
    assert.deepEqual(parseWktPoint("POINT(6.95 50.94)"), {
      lon: 6.95,
      lat: 50.94,
    });
    assert.deepEqual(parseWktPoint("Point(-0.12 51.5)"), {
      lon: -0.12,
      lat: 51.5,
    });
  });

  it("rejects invalid or out-of-range coordinates", () => {
    assert.equal(parseWktPoint("POINT(bad)"), null);
    assert.equal(parseWktPoint("POINT(190 10)"), null);
    assert.equal(parseWktPoint(undefined), null);
  });
});

describe("parseYear", () => {
  it("parses CE, BCE and missing dates", () => {
    assert.equal(parseYear("1848-01-01T00:00:00Z"), 1848);
    assert.equal(parseYear("-0500-01-01T00:00:00Z"), -500);
    assert.equal(parseYear(""), undefined);
    assert.equal(parseYear("not-a-date"), undefined);
  });
});

describe("normalizeRow", () => {
  it("normalizes a heritage castle", () => {
    assert.deepEqual(normalizeRow(row()), {
      id: "wd/Q100",
      qid: "Q100",
      name: "Test Castle",
      category: "castle",
      heritage: true,
      unesco: false,
      lon: 6.95,
      lat: 50.94,
      inception: 1848,
    });
  });

  it("keeps undated sites", () => {
    const site = normalizeRow(
      row({
        item: "http://www.wikidata.org/entity/Q101",
        name: "Old Dig",
        inception: "",
        types: "Q839954",
        heritage: "false",
      }),
    );
    assert.equal(site?.inception, undefined);
    assert.equal(site?.category, "archaeological");
    assert.equal(site?.heritage, false);
  });

  it("drops excluded classes, empty names and bad coordinates", () => {
    assert.equal(normalizeRow(row({ types: "Q5" })), null);
    assert.equal(normalizeRow(row({ name: "   " })), null);
    assert.equal(normalizeRow(row({ coord: "POINT(bad)" })), null);
  });

  it("parses dissolution and UNESCO", () => {
    const site = normalizeRow(
      row({
        dissolved: "1950-01-01T00:00:00Z",
        unesco: "true",
      }),
    );
    assert.equal(site?.dissolved, 1950);
    assert.equal(site?.unesco, true);
  });
});

describe("dedupeSites", () => {
  it("keeps the fuller row for a duplicate QID", () => {
    const first = normalizeRow(row({ inception: "" }));
    const second = normalizeRow(row({ dissolved: "1950-01-01T00:00:00Z" }));
    if (!first || !second) throw new Error("fixture did not normalize");
    const result = dedupeSites([first, second]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.inception, 1848);
    assert.equal(result[0]?.dissolved, 1950);
  });
});

describe("normalizeCsvText", () => {
  it("parses, normalizes and dedupes a page", () => {
    const csv = [
      "item,name,coord,inception,dissolved,types,heritage,unesco",
      'http://www.wikidata.org/entity/Q100,"Castle, Old",POINT(6.95 50.94),1848-01-01T00:00:00Z,,Q23413,true,false',
      "http://www.wikidata.org/entity/Q101,Old Dig,POINT(7.1 51.1),,,Q839954,false,false",
      "http://www.wikidata.org/entity/Q102,Human,POINT(7.2 51.2),,,Q5,false,false",
    ].join("\n");
    const sites = normalizeCsvText(csv);
    assert.equal(sites.length, 2);
    assert.equal(sites[0]?.name, "Castle, Old");
    assert.equal(sites[1]?.category, "archaeological");
  });
});

describe("toGeoJsonLine", () => {
  it("writes a lon/lat point with the tile properties", () => {
    const site = normalizeRow(row());
    if (!site) throw new Error("fixture did not normalize");
    const parsed = JSON.parse(toGeoJsonLine(site));
    assert.equal(parsed.type, "Feature");
    assert.deepEqual(parsed.geometry, {
      type: "Point",
      coordinates: [6.95, 50.94],
    });
    assert.equal(parsed.properties.id, "wd/Q100");
    assert.equal(parsed.properties.qid, "Q100");
    assert.equal(parsed.properties.category, "castle");
    assert.equal(parsed.properties.heritage, true);
    assert.equal(parsed.properties.inception, 1848);
  });
});
