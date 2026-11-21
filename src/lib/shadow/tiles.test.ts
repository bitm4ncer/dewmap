import { describe, expect, it } from "vitest";
import {
  lonLatToTile,
  resolutionForZoom,
  shadowTileUrl,
  tileBounds,
  tileResolutionM,
  tilesForBbox,
} from "./tiles";

describe("lonLatToTile", () => {
  it("puts (0, 0) at the centre of z0", () => {
    const tile = lonLatToTile(0, 0, 0);
    expect(tile.x).toBeCloseTo(0.5, 9);
    expect(tile.y).toBeCloseTo(0.5, 9);
  });

  it("puts Düsseldorf in the expected z12 tile", () => {
    const tile = lonLatToTile(6.7735, 51.2277, 12);
    expect(Math.floor(tile.x)).toBe(2125);
    expect(Math.floor(tile.y)).toBe(1367);
  });

  it("clamps the latitude", () => {
    const tile = lonLatToTile(0, 89, 2);
    expect(Number.isFinite(tile.y)).toBe(true);
  });
});

describe("tileBounds", () => {
  it("covers the world at z0", () => {
    const [west, south, east, north] = tileBounds({ z: 0, x: 0, y: 0 });
    expect(west).toBe(-180);
    expect(east).toBe(180);
    expect(north).toBeCloseTo(85.0511, 3);
    expect(south).toBeCloseTo(-85.0511, 3);
  });

  it("round-trips with lonLatToTile", () => {
    const bounds = tileBounds({ z: 14, x: 8585, y: 5480 });
    const centreLon = (bounds[0] + bounds[2]) / 2;
    const centreLat = (bounds[1] + bounds[3]) / 2;
    const tile = lonLatToTile(centreLon, centreLat, 14);
    expect(Math.floor(tile.x)).toBe(8585);
    expect(Math.floor(tile.y)).toBe(5480);
  });
});

describe("tileResolutionM", () => {
  it("is about 156 km per pixel at z0 on the equator", () => {
    expect(tileResolutionM(0, 0)).toBeCloseTo(156_543, 0);
  });

  it("halves per zoom level", () => {
    expect(tileResolutionM(10, 0) / tileResolutionM(11, 0)).toBeCloseTo(2, 9);
  });
});

describe("tilesForBbox", () => {
  it("returns one tile for a bbox inside a tile", () => {
    const tiles = tilesForBbox([6.773, 51.227, 6.774, 51.228], 14);
    expect(tiles).toHaveLength(1);
  });

  it("returns a grid for a larger bbox", () => {
    const tiles = tilesForBbox([6.7, 51.1, 6.9, 51.3], 12);
    expect(tiles.length).toBeGreaterThan(1);
  });

  it("covers both sides of the antimeridian", () => {
    const tiles = tilesForBbox([179.9, -1, -179.9, 1], 5);
    // Two rows of latitude, two tile columns at the seam.
    expect(tiles).toHaveLength(4);
    expect([...new Set(tiles.map((t) => t.x))].sort((a, b) => a - b)).toEqual([0, 31]);
    expect(tiles.every((t) => t.x >= 0 && t.x < 32)).toBe(true);
  });

  it("does not repeat the first column on a world bbox", () => {
    const tiles = tilesForBbox([-180, -85, 180, 85], 2);
    // 4 columns x 4 rows, not 5 columns.
    expect(tiles).toHaveLength(16);
    expect([...new Set(tiles.map((t) => t.x))].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("documents that lon 180 yields x = n and must be wrapped", () => {
    expect(lonLatToTile(180, 0, 2).x).toBe(4);
  });
});

describe("resolutionForZoom", () => {
  it("gets finer with zoom", () => {
    const values = [14, 15, 16.5, 18].map((z) => resolutionForZoom(z, 51.2));
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("matches the documented steps at mid-latitude", () => {
    expect(resolutionForZoom(14, 51.2)).toBe(8);
    expect(resolutionForZoom(15, 51.2)).toBe(4);
    expect(resolutionForZoom(16, 51.2)).toBe(2);
    expect(resolutionForZoom(17, 51.2)).toBe(1);
  });

  it("uses 1 m at street zoom", () => {
    expect(resolutionForZoom(18, 51.2)).toBe(1);
  });
});

describe("shadowTileUrl", () => {
  it("substitutes the tile coordinates", () => {
    expect(shadowTileUrl("/shadow/{z}/{x}/{y}.png", { z: 14, x: 8585, y: 5480 })).toBe(
      "/shadow/14/8585/5480.png",
    );
  });

  it("flips y for TMS", () => {
    expect(shadowTileUrl("/s/{z}/{x}/{y}.png", { z: 2, x: 0, y: 0 }, true)).toBe("/s/2/0/3.png");
  });
});
