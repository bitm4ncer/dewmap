import { describe, expect, it } from "vitest";
import {
  buildClusterFilter,
  buildSiteFilter,
  countGlobalSites,
  globalLayerIds,
} from "./global-layers";

describe("buildClusterFilter", () => {
  it("returns null when no toggle is active", () => {
    expect(buildClusterFilter({ heritageOnly: false, unescoOnly: false })).toBeNull();
  });

  it("filters on heritage and UNESCO counts", () => {
    expect(buildClusterFilter({ heritageOnly: true, unescoOnly: false })).toEqual([
      "all",
      [">", ["get", "heritageCount"], 0],
    ]);
    expect(buildClusterFilter({ heritageOnly: true, unescoOnly: true })).toEqual([
      "all",
      [">", ["get", "heritageCount"], 0],
      [">", ["get", "unescoCount"], 0],
    ]);
  });
});

describe("buildSiteFilter", () => {
  it("builds a flat all-expression with dates, flags and categories", () => {
    const filter = buildSiteFilter({
      year: 1800,
      categories: ["castle", "religious"],
      heritageOnly: true,
      unescoOnly: false,
    });
    expect(filter).toEqual([
      "all",
      ["case", ["has", "inception"], ["<=", ["get", "inception"], 1800], true],
      [">=", ["coalesce", ["get", "dissolved"], 9999], 1800],
      ["==", ["get", "heritage"], true],
      ["in", ["get", "category"], ["literal", ["castle", "religious"]]],
    ]);
  });

  it("omits the category clause when no categories are selected", () => {
    const filter = buildSiteFilter({
      year: 1900,
      categories: [],
      heritageOnly: false,
      unescoOnly: false,
    });
    expect(filter).toEqual([
      "all",
      ["case", ["has", "inception"], ["<=", ["get", "inception"], 1900], true],
      [">=", ["coalesce", ["get", "dissolved"], 9999], 1900],
    ]);
  });
});

describe("globalLayerIds", () => {
  it("creates distinct cluster and site ids", () => {
    const ids = globalLayerIds();
    expect(ids.clusterSources).toHaveLength(4);
    expect(ids.siteSource).toBe("history-global-sites");
    expect(new Set(ids.clusterSources).size).toBe(4);
  });
});

describe("countGlobalSites", () => {
  it("dedupes repeated features by id", () => {
    const map = {
      querySourceFeatures: () => [
        { properties: { id: "wd/Q1" } },
        { properties: { id: "wd/Q1" } },
        { properties: { id: "wd/Q2" } },
      ],
    };
    expect(countGlobalSites(map as never)).toBe(2);
  });
});
