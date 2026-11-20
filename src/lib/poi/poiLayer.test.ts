import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MLMap } from "maplibre-gl";
import {
  POI_CLUSTER_CIRCLE_LAYER_ID,
  POI_CLUSTER_COUNT_LAYER_ID,
  POI_CLUSTER_DATA_SOURCE_ID,
  POI_CLUSTER_NAME_LAYER_ID,
  POI_DOT_LAYER_ID,
  POI_HIT_LAYER_ID,
  POI_ICON_LAYER_ID,
  POI_LABEL_LAYER_ID,
  POI_SOURCE_ID,
  ensurePoiClusterLayers,
  ensurePoiLayers,
  featureMatchesKinds,
  poiLayerFilter,
  poiTextFont,
  removePoiClusterLayers,
  removePoiLayers,
} from "./poiLayer";

function fakeCanvas() {
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "getImageData") {
          return () => ({
            data: new Uint8ClampedArray(4),
            width: 1,
            height: 1,
          });
        }
        return () => {};
      },
      set() {
        return true;
      },
    },
  );
  return {
    width: 0,
    height: 0,
    getContext: () => ctx,
  };
}

function fakeMap() {
  const sources = new Map<string, unknown>();
  const layers = new Map<string, { id: string; before?: string }>();
  const images = new Map<string, unknown>();
  const map = {
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: unknown) => sources.set(id, spec),
    getLayer: (id: string) => layers.get(id),
    addLayer: (layer: { id: string }, before?: string) =>
      layers.set(layer.id, { id: layer.id, before }),
    hasImage: (id: string) => images.has(id),
    addImage: (id: string, image: unknown) => images.set(id, image),
    removeLayer: (id: string) => layers.delete(id),
    removeSource: (id: string) => sources.delete(id),
    removeImage: (id: string) => images.delete(id),
    getStyle: () => ({
      layers: [
        { id: "basemap-labels", type: "symbol" },
        { id: "basemap-roads", type: "line" },
      ],
    }),
  };
  return { map: map as unknown as MLMap, sources, layers, images };
}

describe("POI vector layer", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { createElement: fakeCanvas });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds the source, dots, category icons and both symbol layers", () => {
    const { map, sources, layers, images } = fakeMap();
    ensurePoiLayers(map);

    expect(sources.has(POI_SOURCE_ID)).toBe(true);
    expect(images.size).toBe(6);
    expect(layers.has(POI_ICON_LAYER_ID)).toBe(true);
    expect(layers.has(POI_DOT_LAYER_ID)).toBe(true);
    expect(layers.has(POI_LABEL_LAYER_ID)).toBe(true);
    expect(layers.has(POI_HIT_LAYER_ID)).toBe(true);
    // POIs must sit above the basemap, not beneath later fill layers.
    expect(layers.get(POI_ICON_LAYER_ID)?.before).toBeUndefined();
  });

  it("is idempotent and removes everything on toggle off", () => {
    const { map, sources, layers, images } = fakeMap();
    ensurePoiLayers(map);
    ensurePoiLayers(map);
    expect(sources.size).toBe(1);
    expect(layers.size).toBe(4);
    expect(images.size).toBe(6);

    removePoiLayers(map);
    expect(sources.size).toBe(0);
    expect(layers.size).toBe(0);
    expect(images.size).toBe(0);
  });
});

describe("POI cluster layers", () => {
  it("adds the clustered GeoJSON source and all three layers", () => {
    const { map, sources, layers } = fakeMap();
    ensurePoiClusterLayers(map);

    expect(sources.has(POI_CLUSTER_DATA_SOURCE_ID)).toBe(true);
    expect(layers.has(POI_CLUSTER_CIRCLE_LAYER_ID)).toBe(true);
    expect(layers.has(POI_CLUSTER_COUNT_LAYER_ID)).toBe(true);
    expect(layers.has(POI_CLUSTER_NAME_LAYER_ID)).toBe(true);
  });

  it("is idempotent and removes everything", () => {
    const { map, sources, layers } = fakeMap();
    ensurePoiClusterLayers(map);
    ensurePoiClusterLayers(map);
    expect(sources.size).toBe(1);
    expect(layers.size).toBe(3);

    removePoiClusterLayers(map);
    expect(sources.size).toBe(0);
    expect(layers.size).toBe(0);
  });
});

describe("poiTextFont", () => {
  const withGlyphs = (glyphs: string) =>
    ({ getStyle: () => ({ glyphs, layers: [] }) }) as unknown as MLMap;

  it("uses the font names each glyph provider actually serves", () => {
    expect(poiTextFont(withGlyphs("https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"), true))
      .toEqual(["Noto Sans Bold"]);
    expect(poiTextFont(withGlyphs("https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf")))
      .toEqual(["Noto Sans Regular"]);

    expect(poiTextFont(withGlyphs("https://tiles.basemaps.cartocdn.com/v/1/fonts/{fontstack}/{range}.pbf"), true))
      .toEqual(["Open Sans Bold"]);

    expect(poiTextFont(withGlyphs("https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf"), true))
      .toEqual(["Noto Sans Medium"]);

    expect(poiTextFont(withGlyphs("https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf"), true))
      .toEqual(["noto_sans_bold"]);
    expect(poiTextFont(withGlyphs("https://tiles.versatiles.org/assets/glyphs/{fontstack}/{range}.pbf")))
      .toEqual(["noto_sans_regular"]);

    expect(poiTextFont(withGlyphs("https://www.openhistoricalmap.org/map-styles/fonts/{fontstack}/{range}.pbf"), true))
      .toEqual(["OpenHistorical Bold"]);
    expect(poiTextFont(withGlyphs("https://www.openhistoricalmap.org/map-styles/fonts/{fontstack}/{range}.pbf")))
      .toEqual(["OpenHistorical"]);
  });
});

const place = (props: Record<string, unknown>) => props;

describe("featureMatchesKinds", () => {
  it("matches categorized places with no filter", () => {
    expect(featureMatchesKinds(place({ class: "restaurant" }))).toBe(true);
    expect(featureMatchesKinds(place({ class: "shop", subclass: "bakery" }))).toBe(true);
    expect(featureMatchesKinds(place({ class: "museum" }))).toBe(true);
  });

  it("rejects unrelated classes", () => {
    expect(featureMatchesKinds(place({ class: "gate" }))).toBe(false);
    expect(featureMatchesKinds(place({ class: "bollard" }))).toBe(false);
  });

  it("requires a name for green space", () => {
    expect(featureMatchesKinds(place({ class: "garden" }))).toBe(false);
    expect(featureMatchesKinds(place({ class: "garden", name: "Hofgarten" }))).toBe(true);
    expect(featureMatchesKinds(place({ subclass: "park" }))).toBe(false);
    expect(featureMatchesKinds(place({ subclass: "park", name: "Stadtpark" }))).toBe(true);
  });

  it("keeps named parks even though playgrounds are excluded", () => {
    expect(featureMatchesKinds(place({ class: "playground" }))).toBe(false);
  });

  it("filters by selected kind", () => {
    expect(featureMatchesKinds(place({ class: "restaurant" }), ["food"])).toBe(true);
    expect(featureMatchesKinds(place({ class: "restaurant" }), ["shop"])).toBe(false);
    expect(featureMatchesKinds(place({ class: "shop", subclass: "bakery" }), ["shop"])).toBe(true);
    expect(featureMatchesKinds(place({ class: "museum" }), ["culture", "sport"])).toBe(true);
  });

  it("combines kinds", () => {
    expect(featureMatchesKinds(place({ class: "restaurant" }), ["food", "shop"])).toBe(true);
    expect(featureMatchesKinds(place({ class: "garden", name: "Garten" }), ["space"])).toBe(true);
  });
});

describe("poiLayerFilter", () => {
  it("returns the plain category filter when nothing is selected", () => {
    const filter = poiLayerFilter([]) as unknown[];
    expect(filter[0]).toBe("any");
  });

  it("ANDs the category filter with the kind classes", () => {
    const filter = poiLayerFilter(["food"]) as unknown[];
    expect(filter[0]).toBe("all");
    expect(filter).toHaveLength(3);
  });
});
