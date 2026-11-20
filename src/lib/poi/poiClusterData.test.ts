import { describe, expect, it } from "vitest";
import {
  MAX_CLUSTER_TILES,
  lonLatToTile,
  tileRangeForBbox,
} from "./poiClusterData";

/** Approximate tile coverage of a viewport in degrees at a map zoom. */
function viewportBbox(
  zoom: number,
  widthPx: number,
  heightPx: number,
  south = 51.17,
  west = 6.7,
  north = 51.28,
  east = 6.85,
): [number, number, number, number] {
  // Only used to derive realistic bboxes for the tile-budget assertions.
  const worldPx = 512 * 2 ** zoom;
  const spanLng = (widthPx / worldPx) * 360;
  const spanLat = (heightPx / worldPx) * 360 * 0.65;
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  return [cy - spanLat / 2, cx - spanLng / 2, cy + spanLat / 2, cx + spanLng / 2];
}

describe("lonLatToTile", () => {
  it("maps known coordinates to expected z14 tiles", () => {
    // Düsseldorf city centre.
    expect(lonLatToTile(6.81, 51.23, 14)).toEqual({ x: 8501, y: 5468 });
    expect(lonLatToTile(-180, 85.0511, 14)).toEqual({ x: 0, y: 0 });
  });

  it("clamps out-of-range coordinates", () => {
    const tile = lonLatToTile(200, 90, 14);
    expect(tile.x).toBeLessThan(2 ** 14);
    expect(tile.y).toBeLessThan(2 ** 14);
    expect(tile.x).toBeGreaterThanOrEqual(0);
    expect(tile.y).toBeGreaterThanOrEqual(0);
  });
});

describe("tileRangeForBbox", () => {
  it("counts the covered z14 tiles for a city viewport", () => {
    const range = tileRangeForBbox([51.17, 6.7, 51.28, 6.85], 14);
    expect(range.x0).toBeLessThanOrEqual(range.x1);
    expect(range.y0).toBeLessThanOrEqual(range.y1);
    expect(range.count).toBe(
      (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1),
    );
    expect(range.count).toBeGreaterThan(1);
  });

  it("stays inside the cluster budget at the minimum cluster zoom", () => {
    // 1440×900 at z13 (POI_CLUSTER_MIN_ZOOM) must fit the budget.
    const range = tileRangeForBbox(viewportBbox(13, 1440, 900), 14);
    expect(range.count).toBeLessThanOrEqual(MAX_CLUSTER_TILES);
  });

  it("is a single tile for a tiny bbox", () => {
    const range = tileRangeForBbox([51.2298, 6.8118, 51.2299, 6.8119], 14);
    expect(range.count).toBe(1);
  });
});
