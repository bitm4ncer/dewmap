import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  tileFor,
  validateArchive,
  validateCategoryCoverage,
  validateManifest,
  validateSites,
} from "./validate.mjs";

const SITE = {
  id: "wd/Q1",
  qid: "Q1",
  name: "Test Castle",
  category: "castle",
  heritage: true,
  unesco: false,
  lon: 6.95,
  lat: 50.94,
  inception: 1848,
};

const MANIFEST = {
  schema: 1,
  buildId: "history-20261118-0400",
  builtAt: "2026-11-18T04:00:00Z",
  counts: { sites: 10, clusters: 5 },
  files: {
    clusters: [
      {
        path: "history-20261118-0400/history-clusters-0-1.pmtiles",
        bytes: 100,
        sha256: "a".repeat(64),
        minzoom: 0,
        maxzoom: 1,
      },
    ],
    sites: {
      path: "history-20261118-0400/history-sites.pmtiles",
      bytes: 200,
      sha256: "b".repeat(64),
    },
  },
  attribution: ["Wikidata contributors (CC0)"],
};

describe("validateSites", () => {
  it("accepts a valid site", () => {
    assert.deepEqual(validateSites([SITE]), { ok: true, errors: [] });
  });

  it("rejects bad coordinates, categories and duplicate ids", () => {
    const result = validateSites([
      { ...SITE, lon: 190 },
      { ...SITE, id: "wd/Q2", lat: 91 },
      { ...SITE, id: "wd/Q3", category: "temple" },
      { ...SITE, id: "wd/Q4", inception: Number.NaN },
      { ...SITE },
      { ...SITE },
    ]);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("longitude")));
    assert.ok(result.errors.some((error) => error.includes("latitude")));
    assert.ok(result.errors.some((error) => error.includes("category")));
    assert.ok(result.errors.some((error) => error.includes("inception")));
    assert.ok(result.errors.some((error) => error.includes("duplicate")));
  });
});

describe("validateCategoryCoverage", () => {
  it("requires the advertised categories in a large build", () => {
    const ok = validateCategoryCoverage(
      [
        { category: "castle" },
        { category: "religious" },
        { category: "archaeological" },
      ],
      { minTotal: 3, required: ["castle", "religious", "archaeological"] },
    );
    assert.equal(ok.ok, true);

    const missing = validateCategoryCoverage(
      [{ category: "castle" }, { category: "castle" }],
      { minTotal: 2, required: ["castle", "museum"] },
    );
    assert.equal(missing.ok, false);
    assert.ok(missing.errors.some((error) => error.includes("museum")));
  });
});

describe("validateManifest", () => {
  it("accepts a valid manifest", () => {
    assert.deepEqual(
      validateManifest(MANIFEST, { maxBytes: 40 * 1024 * 1024 }),
      { ok: true, errors: [] },
    );
  });

  it("rejects schema, dates, hashes and oversize archives", () => {
    const result = validateManifest(
      {
        ...MANIFEST,
        schema: 2,
        builtAt: "not-a-date",
        files: {
          ...MANIFEST.files,
          sites: { ...MANIFEST.files.sites, sha256: "short", bytes: 50 * 1024 * 1024 },
        },
      },
      { maxBytes: 40 * 1024 * 1024 },
    );
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("schema")));
    assert.ok(result.errors.some((error) => error.includes("builtAt")));
    assert.ok(result.errors.some((error) => error.includes("sha256")));
    assert.ok(result.errors.some((error) => error.includes("size")));
  });
});

describe("tileFor", () => {
  it("maps Düsseldorf to a plausible z8 tile", () => {
    const tile = tileFor(6.95, 51.23, 8);
    assert.ok(tile.x > 0 && tile.x < 256);
    assert.ok(tile.y > 0 && tile.y < 256);
  });
});

describe("validateArchive", () => {
  const decode = () => ({
    history_clusters: [{ properties: { count: 3 } }, { properties: { count: 2 } }],
    history_sites: [{ properties: { id: "wd/Q1" } }],
  });

  it("checks the layer name and cluster sum", () => {
    const result = validateArchive({
      expectedLayer: "history_clusters",
      siteCount: 5,
      decode,
      tiles: [[2, 2, 1]],
    });
    assert.equal(result.ok, true);
  });

  it("rejects a missing layer", () => {
    const result = validateArchive({
      expectedLayer: "missing_layer",
      siteCount: 5,
      decode,
      tiles: [[2, 2, 1]],
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("layer")));
  });
});
