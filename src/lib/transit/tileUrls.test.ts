import { describe, expect, it } from "vitest";
import {
  TRANSIT_LINES_FILE,
  TRANSIT_STOPS_FILE,
  TRANSIT_TILES_BASE,
  transitTileUrl,
} from "./tileUrls";

describe("transit tile URLs", () => {
  it("builds pmtiles URLs on the data origin", () => {
    expect(transitTileUrl(TRANSIT_LINES_FILE)).toBe(
      `pmtiles://${TRANSIT_TILES_BASE}/${TRANSIT_LINES_FILE}`,
    );
    expect(transitTileUrl(TRANSIT_STOPS_FILE)).toContain(
      `/tiles/${TRANSIT_STOPS_FILE}`,
    );
  });
});
