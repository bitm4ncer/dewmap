import { describe, expect, it } from "vitest";
import {
  HISTORIC_CATEGORIES,
  categoryFromOsm,
  categoryFromWikidata,
  categoryLabel,
  isSiteVisibleAtYear,
} from "./categories";

describe("categoryFromOsm", () => {
  it("maps fortifications and castles", () => {
    expect(categoryFromOsm("castle")).toBe("castle");
    expect(categoryFromOsm("fortress")).toBe("castle");
    expect(categoryFromOsm("citywalls")).toBe("castle");
    expect(categoryFromOsm("city_gate")).toBe("castle");
  });

  it("maps archaeology and ruins", () => {
    expect(categoryFromOsm("archaeological_site")).toBe("archaeological");
    expect(categoryFromOsm("ruins")).toBe("archaeological");
    expect(categoryFromOsm("settlement")).toBe("archaeological");
  });

  it("maps religious sites", () => {
    expect(categoryFromOsm("wayside_cross")).toBe("religious");
    expect(categoryFromOsm("wayside_shrine")).toBe("religious");
    expect(categoryFromOsm("church")).toBe("religious");
    expect(categoryFromOsm("monastery")).toBe("religious");
  });

  it("maps memorials, battlefields, industry and museums", () => {
    expect(categoryFromOsm("memorial")).toBe("memorial");
    expect(categoryFromOsm("tomb")).toBe("memorial");
    expect(categoryFromOsm("monument")).toBe("memorial");
    expect(categoryFromOsm("battlefield")).toBe("battlefield");
    expect(categoryFromOsm("mine")).toBe("industrial");
    expect(categoryFromOsm("mine_shaft")).toBe("industrial");
    expect(categoryFromOsm("museum")).toBe("museum");
  });

  it("falls back to other", () => {
    expect(categoryFromOsm(undefined)).toBe("other");
    expect(categoryFromOsm("yes")).toBe("other");
    expect(categoryFromOsm("boundary_stone")).toBe("other");
  });
});

describe("categoryFromWikidata", () => {
  it("prefers castle over a generic heritage class", () => {
    expect(categoryFromWikidata(["Q210272", "Q23413"])).toBe("castle");
  });

  it("maps the main heritage classes", () => {
    expect(categoryFromWikidata(["Q839954"])).toBe("archaeological");
    expect(categoryFromWikidata(["Q16970"])).toBe("religious");
    expect(categoryFromWikidata(["Q44613"])).toBe("religious");
    expect(categoryFromWikidata(["Q4989906"])).toBe("memorial");
    expect(categoryFromWikidata(["Q4895508"])).toBe("battlefield");
    expect(categoryFromWikidata(["Q1569871"])).toBe("industrial");
    expect(categoryFromWikidata(["Q33506"])).toBe("museum");
  });

  it("maps unclassified heritage to other", () => {
    expect(categoryFromWikidata(["Q210272"])).toBe("other");
    expect(categoryFromWikidata([])).toBe("other");
  });
});

describe("categoryLabel", () => {
  it("returns translated labels", () => {
    expect(categoryLabel("castle", "de")).toBe("Burg");
    expect(categoryLabel("castle", "en")).toBe("Castle");
    expect(categoryLabel("archaeological", "de")).toBe("Archäologie");
    expect(categoryLabel("other", "en")).toBe("Other");
  });

  it("covers every category", () => {
    for (const category of HISTORIC_CATEGORIES) {
      expect(categoryLabel(category, "en").length).toBeGreaterThan(0);
      expect(categoryLabel(category, "de").length).toBeGreaterThan(0);
    }
  });
});

describe("isSiteVisibleAtYear", () => {
  it("filters dated sites by inception and dissolution", () => {
    expect(
      isSiteVisibleAtYear({ inception: 1900, dissolved: 1950 }, 1899),
    ).toBe(false);
    expect(
      isSiteVisibleAtYear({ inception: 1900, dissolved: 1950 }, 1900),
    ).toBe(true);
    expect(
      isSiteVisibleAtYear({ inception: 1900, dissolved: 1950 }, 1950),
    ).toBe(true);
    expect(
      isSiteVisibleAtYear({ inception: 1900, dissolved: 1950 }, 1951),
    ).toBe(false);
  });

  it("shows undated sites at every year", () => {
    expect(isSiteVisibleAtYear({}, 1500)).toBe(true);
    expect(isSiteVisibleAtYear({}, 2026)).toBe(true);
  });

  it("shows ancient sites from the first slider position", () => {
    expect(isSiteVisibleAtYear({ inception: -500 }, 1500)).toBe(true);
    expect(isSiteVisibleAtYear({ inception: -500 }, -600)).toBe(false);
  });
});
