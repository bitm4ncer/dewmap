import { describe, expect, it } from "vitest";
import {
  BASEMAPS,
  BASEMAP_GROUP_ORDER,
  DEFAULT_IMAGE_BASEMAP_ID,
  DEFAULT_VECTOR_BASEMAP_ID,
  GIBS_TODAY_DATE_PLACEHOLDER,
  availableBasemapsInGroup,
  basemapAvailableAt,
  basemapGroup,
  basemapPresentation,
  basemapsInGroup,
  getActiveVariant,
  getBasemap,
  resolveBasemapSubtitle,
  resolveBasemapUrl,
} from "./basemaps";
import { gibsDateNDaysAgo } from "./gibs";

describe("basemap collection", () => {
  it("has unique ids", () => {
    const ids = BASEMAPS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique labels", () => {
    const labels = BASEMAPS.map((b) => b.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("keeps both default ids in the collection", () => {
    expect(getBasemap(DEFAULT_IMAGE_BASEMAP_ID)).toBeDefined();
    expect(getBasemap(DEFAULT_VECTOR_BASEMAP_ID)).toBeDefined();
  });

  it("has metadata for every entry", () => {
    for (const basemap of BASEMAPS) {
      expect(basemap.label.length, basemap.id).toBeGreaterThan(0);
      expect(basemap.attribution.length, basemap.id).toBeGreaterThan(0);
      expect(basemap.provider?.length, basemap.id).toBeGreaterThan(0);
      expect(basemap.license?.length, basemap.id).toBeGreaterThan(0);
      expect(basemap.coverage?.length, basemap.id).toBeGreaterThan(0);
      expect(BASEMAP_GROUP_ORDER).toContain(basemap.group);
    }
  });

  it("gives every regional entry valid bounds", () => {
    for (const basemap of BASEMAPS) {
      if (!basemap.bounds) continue;
      const [west, south, east, north] = basemap.bounds;
      expect(west, basemap.id).toBeLessThan(east);
      expect(south, basemap.id).toBeLessThan(north);
      expect(basemap.coverage, basemap.id).not.toBe("Welt");
    }
    const countryCoverage = new Set([
      "DE",
      "BY",
      "AT",
      "CH",
      "FR",
      "NL",
      "NO",
      "CZ",
      "PL",
      "ES",
      "UK",
      "JP",
    ]);
    for (const basemap of BASEMAPS) {
      if (basemap.coverage === "Welt" || basemap.coverage === "Weltmeere") continue;
      expect(basemap.bounds, basemap.id).toBeDefined();
      if (basemap.coverage && countryCoverage.has(basemap.coverage)) {
        expect(basemap.region, basemap.id).toBeDefined();
      }
    }
  });

  it("uses a usable tile template for every raster entry", () => {
    for (const basemap of BASEMAPS) {
      if (basemap.kind !== "raster") continue;
      const url = basemap.url;
      const hasXyz = url.includes("{z}") && url.includes("{x}") && url.includes("{y}");
      const hasWmsBbox = url.includes("{bbox-epsg-3857}");
      expect(hasXyz || hasWmsBbox, basemap.id).toBe(true);
    }
  });

  it("separates technical category from picker presentation", () => {
    for (const basemap of BASEMAPS) {
      expect(basemap.category, basemap.id).toBe(
        basemap.kind === "style" ? "vector" : "photo",
      );
      if (basemapPresentation(basemap) === "vector") {
        expect(basemap.kind, basemap.id).toBe("style");
      }
      if (basemapPresentation(basemap) === "drawn") {
        expect(basemap.kind, basemap.id).toBe("raster");
      }
    }
    const siegfried = getBasemap("ch-siegfried");
    const imagery = getBasemap("esri-imagery");
    const ofm = getBasemap("ofm-dark");
    expect(siegfried && basemapPresentation(siegfried)).toBe("drawn");
    expect(imagery && basemapPresentation(imagery)).toBe("photo");
    expect(ofm && basemapPresentation(ofm)).toBe("vector");
    expect(
      BASEMAPS.filter((b) => basemapPresentation(b) === "drawn").length,
    ).toBeGreaterThan(20);
  });

  it("uses https style URLs for style entries", () => {
    for (const basemap of BASEMAPS) {
      if (basemap.kind !== "style") continue;
      expect(basemap.url.startsWith("https://"), basemap.id).toBe(true);
      expect(basemap.url, basemap.id).toMatch(/style\.json$|\/styles\/[a-z-]+$/);
    }
  });

  it("resolves a variant placeholder in the URL and subtitle", () => {
    const s2 = getBasemap("s2cloudless");
    expect(s2).toBeDefined();
    expect(resolveBasemapUrl(s2!, "2024")).toContain("s2cloudless-2024_3857");

    const siegfried = getBasemap("ch-siegfried");
    expect(siegfried).toBeDefined();
    expect(resolveBasemapUrl(siegfried!, "1926")).toContain("/1926/3857/");

    const wien = getBasemap("at-wien-luftbild");
    expect(wien).toBeDefined();
    expect(resolveBasemapUrl(wien!, "1956")).toContain("/lb1956/grau/");
  });

  it("falls back to the default variant for unknown ids", () => {
    const siegfried = getBasemap("ch-siegfried");
    expect(siegfried?.variants?.defaultId).toBe("1926");
    expect(getActiveVariant(siegfried!, "nope")?.id).toBe("1926");
  });

  it("keeps the literal ${year} placeholder out of resolved URLs", () => {
    for (const basemap of BASEMAPS) {
      if (!basemap.variants) continue;
      const resolved = resolveBasemapUrl(basemap);
      expect(resolved, basemap.id).not.toContain("${year}");
      expect(resolved, basemap.id).not.toContain("${era}");
    }
  });

  it("uses a two-day GIBS lag to avoid blank yesterday tiles", () => {
    const gibs = getBasemap("gibs-today");
    expect(gibs).toBeDefined();
    const resolved = resolveBasemapUrl(gibs!);
    expect(resolved).toContain(gibsDateNDaysAgo(2));
    expect(resolved).not.toContain(GIBS_TODAY_DATE_PLACEHOLDER);
    expect(resolveBasemapSubtitle(gibs!)).toContain(gibsDateNDaysAgo(2));
  });

  it("filters by picker group", () => {
    expect(basemapsInGroup("all")).toHaveLength(BASEMAPS.length);
    expect(basemapsInGroup("dach").length).toBeGreaterThan(5);
    expect(basemapsInGroup("historical").length).toBeGreaterThan(5);
    for (const basemap of basemapsInGroup("dach")) {
      expect(basemapGroup(basemap)).toBe("dach");
    }
  });

  it("offers regional layers only inside their country outline", () => {
    const vienna: [number, number] = [16.373, 48.208];
    const berlin: [number, number] = [13.405, 52.52];
    const zurich: [number, number] = [8.54, 47.37];
    const paris: [number, number] = [2.352, 48.857];

    const at = getBasemap("at-geoland");
    const de = getBasemap("de-basemap-col");
    const ch = getBasemap("ch-pixelkarte");
    const global = getBasemap("esri-imagery");
    expect(at && basemapAvailableAt(at, vienna)).toBe(true);
    expect(at && basemapAvailableAt(at, berlin)).toBe(false);
    expect(de && basemapAvailableAt(de, berlin)).toBe(true);
    expect(de && basemapAvailableAt(de, zurich)).toBe(false);
    expect(ch && basemapAvailableAt(ch, zurich)).toBe(true);
    expect(de && basemapAvailableAt(de, paris)).toBe(false);
    expect(global && basemapAvailableAt(global, paris)).toBe(true);
    expect(at && basemapAvailableAt(at, null)).toBe(true);

    const dachAtVienna = availableBasemapsInGroup("dach", vienna);
    const dachAtZurich = availableBasemapsInGroup("dach", zurich);
    const dachAtParis = availableBasemapsInGroup("dach", paris);
    expect(dachAtVienna.some((b) => b.id === "at-geoland")).toBe(true);
    expect(dachAtVienna.some((b) => b.id === "de-basemap-col")).toBe(false);
    expect(dachAtZurich.some((b) => b.id === "ch-pixelkarte")).toBe(true);
    expect(dachAtZurich.some((b) => b.id === "de-basemap-col")).toBe(false);
    expect(dachAtParis.some((b) => b.id === "at-geoland")).toBe(false);
    expect(dachAtParis).toHaveLength(0);
  });

  it("requires every variant default to exist", () => {
    for (const basemap of BASEMAPS) {
      if (!basemap.variants) continue;
      const ids = basemap.variants.options.map((o) => o.id);
      expect(ids, basemap.id).toContain(basemap.variants.defaultId);
      expect(ids.length, basemap.id).toBeGreaterThan(0);
    }
  });
});

describe("vector basemaps", () => {
  it("keeps the graphite tint and the raw CARTO style as separate options", () => {
    const graphite = BASEMAPS.find((b) => b.id === "streets-dark");
    const raw = BASEMAPS.find((b) => b.id === "dark-matter");
    expect(graphite?.kind).toBe("style");
    expect(raw?.kind).toBe("style");
    expect(raw?.category).toBe("vector");
    expect(raw?.url).toBe(graphite?.url);
    expect(raw?.label).toBe("Dark Matter");
    expect(DEFAULT_VECTOR_BASEMAP_ID).toBe("streets-dark");
  });
});
