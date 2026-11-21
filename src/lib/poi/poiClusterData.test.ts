import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregatePoiDistricts,
  clearPoiTileCache,
  clusterTileBudget,
  DISTRICT_CELL_DEG,
  MAX_CLUSTER_TILES,
  lonLatToTile,
  tileRangeForBbox,
  persistPoiView,
  loadPoiView,
  type ClusterData,
  type ClusterPoint,
  type DistrictPoint,
} from "./poiClusterData";

/** Approximate tile coverage of a viewport. Mercator compresses latitude
 *  by cos(lat), so a square screen covers less latitude than longitude. */
function viewportBbox(
  zoom: number,
  widthPx: number,
  heightPx: number,
  south = 51.17,
  west = 6.7,
  north = 51.28,
  east = 6.85,
): [number, number, number, number] {
  const worldPx = 512 * 2 ** zoom;
  const spanLng = (widthPx / worldPx) * 360;
  const spanLat = spanLng * (heightPx / widthPx) * 0.627;
  const cx = (west + east) / 2;
  const cy = (south + north) / 2;
  return [cy - spanLat / 2, cx - spanLng / 2, cy + spanLat / 2, cx + spanLng / 2];
}

const poi = (
  lon: number,
  lat: number,
  name = "Place",
  cls = "restaurant",
  subclass = "restaurant",
): ClusterPoint => ({ lon, lat, name, class: cls, subclass });

const district = (
  lon: number,
  lat: number,
  name: string,
  cls: DistrictPoint["class"] = "suburb",
): DistrictPoint => ({ lon, lat, name, class: cls });

const data = (
  points: ClusterPoint[],
  districts: DistrictPoint[] = [],
): ClusterData => ({ points, districts });

const featureByName = (
  collection: GeoJSON.FeatureCollection<GeoJSON.Point>,
  name: string,
) => collection.features.find((f) => f.properties?.district_name === name);

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

  it("is a single tile for a tiny bbox", () => {
    const range = tileRangeForBbox([51.2298, 6.8118, 51.2299, 6.8119], 14);
    expect(range.count).toBe(1);
  });
});

describe("clusterTileBudget", () => {
  it("covers a phone at z10 and typical desktops at z11/z12", () => {
    expect(clusterTileBudget(10)).toBe(MAX_CLUSTER_TILES);
    expect(tileRangeForBbox(viewportBbox(10, 390, 844), 14).count)
      .toBeLessThanOrEqual(clusterTileBudget(10));
    // 1920×1080 at z11 is the widest supported region overview.
    expect(tileRangeForBbox(viewportBbox(11, 1920, 1080), 14).count)
      .toBeLessThanOrEqual(clusterTileBudget(11));
    // 4K at z12 is the widest supported city view.
    expect(tileRangeForBbox(viewportBbox(12, 3840, 2160), 14).count)
      .toBeLessThanOrEqual(clusterTileBudget(12));
    expect(tileRangeForBbox(viewportBbox(13, 1440, 900), 14).count)
      .toBeLessThanOrEqual(clusterTileBudget(13));
  });
});

describe("district aggregation", () => {
  it("assigns places to the nearest Stadtteil and keeps the name", () => {
    const altstadt = district(6.7736, 51.2259, "Altstadt");
    const bilk = district(6.7851, 51.2028, "Bilk");
    const out = aggregatePoiDistricts(
      data(
        [
          poi(6.7737, 51.226, "Cafe", "cafe"),
          poi(6.774, 51.2261, "Museum", "museum"),
          poi(6.785, 51.203, "Bakery", "bakery"),
        ],
        [altstadt, bilk],
      ),
      DISTRICT_CELL_DEG,
    );
    expect(out.features).toHaveLength(2);
    expect(featureByName(out, "Altstadt")?.properties?.point_count).toBe(2);
    expect(featureByName(out, "Bilk")?.properties?.point_count).toBe(1);
    expect(featureByName(out, "Altstadt")?.geometry.coordinates).toEqual([
      altstadt.lon,
      altstadt.lat,
    ]);
    expect(featureByName(out, "Altstadt")?.properties?.district_class).toBe(
      "suburb",
    );
  });

  it("gives a single-place district a count of one", () => {
    const out = aggregatePoiDistricts(
      data([poi(6.78, 51.23)], [district(6.78, 51.23, "Stadtmitte")]),
      DISTRICT_CELL_DEG,
    );
    expect(out.features).toHaveLength(1);
    expect(out.features[0].properties?.point_count).toBe(1);
    expect(out.features[0].properties?.district_name).toBe("Stadtmitte");
  });

  it("falls back to a fixed grid when no district point is nearby", () => {
    const out = aggregatePoiDistricts(
      data([poi(6.78, 51.23)], [district(8.0, 50.0, "Far Away")]),
      DISTRICT_CELL_DEG,
    );
    expect(out.features).toHaveLength(1);
    expect(out.features[0].properties?.point_count).toBe(1);
    expect(out.features[0].properties?.cell_deg).toBe(DISTRICT_CELL_DEG);
    expect(out.features[0].properties?.district_name).toBeUndefined();
  });

  it("groups multiple fallback places in the same grid cell", () => {
    const out = aggregatePoiDistricts(
      data(
        [poi(6.7801, 51.2301), poi(6.7802, 51.2302)],
        [district(8.0, 50.0, "Far Away")],
      ),
      DISTRICT_CELL_DEG,
    );
    expect(out.features).toHaveLength(1);
    expect(out.features[0].properties?.point_count).toBe(2);
  });

  it("keeps the district anchor stable when more places arrive", () => {
    const altstadt = district(6.7736, 51.2259, "Altstadt");
    const first = aggregatePoiDistricts(
      data([poi(6.7737, 51.226), poi(6.774, 51.2261)], [altstadt]),
      DISTRICT_CELL_DEG,
    );
    const later = aggregatePoiDistricts(
      data(
        [
          poi(6.7737, 51.226),
          poi(6.774, 51.2261),
          poi(6.7742, 51.2263),
        ],
        [altstadt],
      ),
      DISTRICT_CELL_DEG,
    );
    expect(first.features[0].geometry.coordinates).toEqual(
      later.features[0].geometry.coordinates,
    );
    expect(later.features[0].properties?.point_count).toBe(3);
  });

  it("deduplicates repeated district points from tile buffers", () => {
    const altstadt = district(6.7736, 51.2259, "Altstadt");
    const out = aggregatePoiDistricts(
      data(
        [poi(6.7737, 51.226), poi(6.774, 51.2261)],
        [altstadt, altstadt],
      ),
      DISTRICT_CELL_DEG,
    );
    expect(out.features).toHaveLength(1);
    expect(out.features[0].properties?.point_count).toBe(2);
  });

  it("prefers the Stadtteil over a much closer quarter", () => {
    const suburb = district(6.78, 51.23, "Stadtteil", "suburb");
    const quarter = district(6.775, 51.23, "Kiez", "quarter");
    const out = aggregatePoiDistricts(
      data([poi(6.773, 51.23)], [suburb, quarter]),
      DISTRICT_CELL_DEG,
    );
    expect(featureByName(out, "Stadtteil")).toBeTruthy();
  });

  it("prefers a nearby village over a very distant suburb", () => {
    const distantSuburb = district(6.78, 51.32, "Distant", "suburb");
    const village = district(6.78, 51.23, "Dorf", "village");
    const out = aggregatePoiDistricts(
      data([poi(6.7801, 51.2301)], [distantSuburb, village]),
      DISTRICT_CELL_DEG,
    );
    expect(featureByName(out, "Dorf")).toBeTruthy();
    expect(featureByName(out, "Distant")).toBeUndefined();
  });
});

describe("warm start", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearPoiTileCache();
  });

  it("keeps up to three views and reloads a containing one", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });

    const frame = (key: string): GeoJSON.FeatureCollection<GeoJSON.Point> => ({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [1.5, 1.5] },
          properties: { key, point_count: 2, bounds: [1.4, 1.4, 1.6, 1.6] },
        },
      ],
    });

    persistPoiView([0, 0, 1, 1], 0.02, frame("one"));
    persistPoiView([1, 1, 2, 2], 0.02, frame("two"));
    persistPoiView([2, 2, 3, 3], 0.02, frame("three"));
    persistPoiView([3, 3, 4, 4], 0.02, frame("four"));

    const stored = JSON.parse(store.get("dewmap.poi-view.v2") ?? "{}");
    expect(stored.v).toBe(2);
    expect(stored.views).toHaveLength(3);
    expect(stored.views.map((v: { bbox: number[] }) => v.bbox)).toEqual([
      [3, 3, 4, 4],
      [2, 2, 3, 3],
      [1, 1, 2, 2],
    ]);

    const loaded = loadPoiView([1.2, 1.2, 1.4, 1.4], 0.02);
    expect(loaded?.features[0].properties?.key).toBe("two");
  });

  it("does not return an expired view", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
    persistPoiView(
      [0, 0, 1, 1],
      0.02,
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [0.5, 0.5] },
            properties: { key: "old" },
          },
        ],
      },
    );
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 13 * 60 * 60_000);
    expect(loadPoiView([0.1, 0.1, 0.9, 0.9], 0.02)).toBeNull();
    vi.restoreAllMocks();
  });
});
