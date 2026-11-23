import { describe, expect, it } from "vitest";
import {
  deserializeBuildings,
  duskAlpha,
  renderShadowWindow,
  serializeBuildings,
} from "./render";
import type { Bbox, BuildingFootprint, SolarPosition } from "./types";

const CENTRE: [number, number] = [6.78, 51.23];
const METRES_PER_DEG_LAT = 111_320;
const METRES_PER_DEG_LON = METRES_PER_DEG_LAT * Math.cos((CENTRE[1] * Math.PI) / 180);

function square(halfSizeM: number, heightM: number): BuildingFootprint {
  const dLat = halfSizeM / METRES_PER_DEG_LAT;
  const dLon = halfSizeM / METRES_PER_DEG_LON;
  return {
    id: "b1",
    heightM,
    ring: [
      [CENTRE[0] - dLon, CENTRE[1] - dLat],
      [CENTRE[0] + dLon, CENTRE[1] - dLat],
      [CENTRE[0] + dLon, CENTRE[1] + dLat],
      [CENTRE[0] - dLon, CENTRE[1] + dLat],
    ],
  };
}

const BBOX: Bbox = [
  CENTRE[0] - 0.001,
  CENTRE[1] - 0.001,
  CENTRE[0] + 0.001,
  CENTRE[1] + 0.001,
];

function sun(azimuthDeg: number, elevationDeg: number): SolarPosition {
  return {
    azimuthDeg,
    elevationDeg,
    elevationGeometricDeg: elevationDeg,
    declinationDeg: 0,
    hourAngleDeg: 0,
    equationOfTimeMin: 0,
  };
}

describe("serializeBuildings", () => {
  it("round-trips ids, heights and rings", () => {
    const building = square(10, 25);
    const serialized = serializeBuildings([building, { heightM: 8, ring: building.ring }]);
    expect(serialized.count).toBe(2);
    expect(Array.from(serialized.heights)).toEqual([25, 8]);
    const back = deserializeBuildings(serialized);
    expect(back[0].id).toBe("b1");
    expect(back[1].id).toBeUndefined();
    expect(back[0].ring[0][0]).toBeCloseTo(building.ring[0][0], 9);
    expect(back[1].ring).toHaveLength(4);
  });
});

describe("renderShadowWindow", () => {
  it("returns no-buildings without touching the mask", () => {
    const out = renderShadowWindow({
      bbox: BBOX,
      timeMs: Date.parse("2026-06-21T10:00:00Z"),
      resolutionM: 2,
      buildings: serializeBuildings([]),
    });
    expect(out.status).toBe("no-buildings");
    expect(out.mask).toBeUndefined();
  });

  it("returns night when the sun is below the horizon", () => {
    const out = renderShadowWindow({
      bbox: BBOX,
      timeMs: Date.parse("2026-11-23T01:00:00Z"),
      resolutionM: 2,
      buildings: serializeBuildings([square(10, 20)]),
    });
    expect(out.status).toBe("night");
    expect(out.sun.elevationDeg).toBeLessThan(0);
  });

  it("casts the shadow away from the sun", () => {
    const out = renderShadowWindow({
      bbox: BBOX,
      timeMs: Date.parse("2026-06-21T10:00:00Z"),
      resolutionM: 2,
      buildings: serializeBuildings([square(10, 30)]),
      sun: sun(90, 45),
    });
    expect(out.status).toBe("rendered");
    const mask = out.mask!;
    expect(mask.width).toBeGreaterThan(10);
    expect(mask.height).toBeGreaterThan(10);

    let shadowCols = 0;
    let shadowCells = 0;
    for (let row = 0; row < mask.height; row++) {
      for (let col = 0; col < mask.width; col++) {
        if (mask.data[row * mask.width + col]) {
          shadowCells += 1;
          shadowCols += col;
        }
      }
    }
    expect(shadowCells).toBeGreaterThan(0);
    // Sun in the east (azimuth 90°) ⇒ shadows run west, i.e. to lower columns.
    const meanCol = shadowCols / shadowCells;
    expect(meanCol).toBeLessThan(mask.width / 2 - 3);

    // A 30 m building at 45° casts ~30 m: 15 cells at 2 m, give or take the
    // building itself and the raster edge.
    const shadowFraction = shadowCells / mask.data.length;
    expect(shadowFraction).toBeGreaterThan(0.01);
    expect(shadowFraction).toBeLessThan(0.4);
  });

  it("drops shadow length when the sun climbs", () => {
    const low = renderShadowWindow({
      bbox: BBOX,
      timeMs: Date.parse("2026-06-21T10:00:00Z"),
      resolutionM: 2,
      buildings: serializeBuildings([square(10, 30)]),
      sun: sun(90, 20),
    });
    const high = renderShadowWindow({
      bbox: BBOX,
      timeMs: Date.parse("2026-06-21T10:00:00Z"),
      resolutionM: 2,
      buildings: serializeBuildings([square(10, 30)]),
      sun: sun(90, 60),
    });
    expect(low.mask).toBeDefined();
    expect(high.mask).toBeDefined();
    expect(low.stats.shadowFraction).toBeGreaterThan(high.stats.shadowFraction * 1.5);
  });
});

describe("duskAlpha", () => {
  it("fades shadows between 0 and 3 degrees", () => {
    expect(duskAlpha(-1)).toBe(0);
    // Exactly on the horizon there is no direct sun, so no shadow pixels.
    expect(duskAlpha(0)).toBe(0);
    expect(duskAlpha(0.5)).toBeGreaterThan(0);
    expect(duskAlpha(0.5)).toBeLessThan(255);
    expect(duskAlpha(3)).toBe(255);
    expect(duskAlpha(20)).toBe(255);
  });
});
