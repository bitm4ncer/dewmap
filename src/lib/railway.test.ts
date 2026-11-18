import { describe, expect, it } from "vitest";
import {
  RAIL_VECTOR_ATTRIBUTION,
  RAIL_VECTOR_LINES_LAYER,
  RAIL_VECTOR_STATIONS_LAYER,
  RAIL_VECTOR_TILE_URL,
  RAILWAY_TILE_URLS,
} from "./railway";

describe("rail data sources", () => {
  it("uses a vector tile template with the Protomaps rail schema", () => {
    expect(RAIL_VECTOR_TILE_URL).toContain("{z}/{x}/{y}");
    expect(RAIL_VECTOR_TILE_URL).toContain(".mvt");
    expect(RAIL_VECTOR_LINES_LAYER).toBe("roads");
    expect(RAIL_VECTOR_STATIONS_LAYER).toBe("pois");
    expect(RAIL_VECTOR_ATTRIBUTION).toContain("OpenStreetMap");
    expect(RAIL_VECTOR_ATTRIBUTION).toContain("CARTO");
  });

  it("keeps the raster fallback shards", () => {
    expect(RAILWAY_TILE_URLS).toHaveLength(3);
    expect(RAILWAY_TILE_URLS[0]).toContain("{z}/{x}/{y}.png");
  });
});
