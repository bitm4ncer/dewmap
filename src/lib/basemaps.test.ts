import { describe, expect, it } from "vitest";
import { BASEMAPS, DEFAULT_VECTOR_BASEMAP_ID } from "./basemaps";

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
