import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MLMap } from "maplibre-gl";
import {
  POI_HIT_LAYER_ID,
  POI_ICON_LAYER_ID,
  POI_LABEL_LAYER_ID,
  POI_SOURCE_ID,
  ensurePoiLayers,
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

  it("adds the source, category icons and both symbol layers", () => {
    const { map, sources, layers, images } = fakeMap();
    ensurePoiLayers(map);

    expect(sources.has(POI_SOURCE_ID)).toBe(true);
    expect(images.size).toBe(6);
    expect(layers.has(POI_ICON_LAYER_ID)).toBe(true);
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
    expect(layers.size).toBe(3);
    expect(images.size).toBe(6);

    removePoiLayers(map);
    expect(sources.size).toBe(0);
    expect(layers.size).toBe(0);
    expect(images.size).toBe(0);
  });
});
