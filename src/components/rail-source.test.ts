import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mapSource = readFileSync(new URL("./Map.tsx", import.meta.url), "utf8");
const overpassSource = readFileSync(
  new URL("../lib/hiking/overpass.ts", import.meta.url),
  "utf8",
);

describe("rail data path", () => {
  it("does not use viewport Overpass batches for rails", () => {
    expect(mapSource).not.toContain("fetchRailNetwork");
    expect(mapSource).not.toContain("railTileCache");
    expect(mapSource).not.toContain("railTileInFlight");
    expect(overpassSource).not.toContain("fetchRailNetwork");
  });

  it("uses the vector tile source for the rail style", () => {
    expect(mapSource).toContain("RAIL_VECTOR_TILEJSON_URL");
    expect(mapSource).toContain("RAIL_VECTOR_LINES_LAYER");
    expect(mapSource).toContain("RAIL_VECTOR_STATIONS_LAYER");
    expect(mapSource).not.toContain("RAILWAY_TILE_URLS");
    expect(mapSource).not.toContain("ensureRailwayLayer");
  });

  it("asks the browser to keep immutable OpenFreeMap tiles", () => {
    expect(mapSource).toContain("tiles.openfreemap.org");
    expect(mapSource).toContain('cache: "force-cache"');
  });

  it("keeps the station hit target invisible", () => {
    expect(mapSource).toContain('"circle-radius": 18');
    expect(mapSource).toContain('"circle-opacity": 0');
  });

  it("fades rail layers in around their minzoom", () => {
    expect(mapSource).toContain("RAIL_LINE_FADE");
    expect(mapSource).toContain("RAIL_STATION_FADE");
    expect(mapSource).toContain("railFade(opacity, RAIL_LINE_FADE)");
    expect(mapSource).not.toMatch(/"\*",\s*opacity,\s*\[\s*"interpolate"/);
  });
});
