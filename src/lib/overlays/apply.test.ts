import { describe, expect, it } from "vitest";
import type { Map as MLMap } from "maplibre-gl";
import {
  OVERLAY_PREFIX,
  clearOverlays,
  overlayBeforeId,
  overlayLayerId,
  overlayLayerIds,
  overlaySourceId,
  reconcileOverlays,
} from "./apply";
import type { OverlayDefinition, ResolvedOverlay } from "./types";

/** Minimal stand-in for the parts of MapLibre that apply.ts uses. */
function fakeMap(layers: { id: string; type: string }[] = []) {
  const style = {
    layers: [...layers] as { id: string; type: string; source?: string }[],
    sources: {} as Record<string, unknown>,
  };
  const paint = new Map<string, Record<string, unknown>>();
  const setDataCalls: unknown[] = [];
  const map = {
    style,
    paint,
    setDataCalls,
    getStyle: () => style,
    isStyleLoaded: () => true,
    getLayer: (id: string) => style.layers.find((l) => l.id === id),
    getSource: (id: string) =>
      style.sources[id]
        ? {
            type: (style.sources[id] as { type?: string }).type,
            url: (style.sources[id] as { url?: string }).url,
            tiles: (style.sources[id] as { tiles?: string[] }).tiles,
            setData: (data: unknown) => {
              setDataCalls.push(data);
              (style.sources[id] as { data?: unknown }).data = data;
            },
            updateImage: (options: { url: string }) => {
              (style.sources[id] as { url?: string }).url = options.url;
            },
          }
        : undefined,
    addSource: (id: string, spec: Record<string, unknown>) => {
      style.sources[id] = spec;
    },
    removeSource: (id: string) => {
      delete style.sources[id];
    },
    addLayer: (layer: { id: string; type: string; source?: string }) => {
      style.layers.push(layer);
    },
    removeLayer: (id: string) => {
      style.layers = style.layers.filter((l) => l.id !== id);
    },
    setPaintProperty: (id: string, key: string, value: unknown) => {
      paint.set(id, { ...(paint.get(id) ?? {}), [key]: value });
    },
    setLayoutProperty: () => {},
  };
  return map as unknown as MLMap & {
    style: typeof style;
    paint: Map<string, Record<string, unknown>>;
    setDataCalls: unknown[];
  };
}

function definition(id: string, order = 0): OverlayDefinition {
  return {
    id,
    label: id,
    group: "weather",
    kind: "geojson",
    description: "",
    attribution: { label: "src" },
    opacity: 1,
    timeAware: false,
    order,
    resolve: () => null,
  };
}

function geojson(data: GeoJSON.FeatureCollection): ResolvedOverlay {
  return {
    source: { type: "geojson", data },
    layers: [
      { type: "fill", paint: { "fill-opacity": 0.2 } },
      { type: "line", paint: { "line-width": 1 } },
    ],
  };
}

const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

describe("ids", () => {
  it("prefixes sources and layers per overlay", () => {
    expect(overlaySourceId("weather-warnings")).toBe("overlay:weather-warnings");
    expect(overlayLayerId("weather-warnings", 1)).toBe(
      "overlay:weather-warnings:1",
    );
    expect(overlayLayerIds("x", 2)).toEqual(["overlay:x:0", "overlay:x:1"]);
    expect(OVERLAY_PREFIX).toBe("overlay:");
  });
});

describe("stacking anchor", () => {
  it("prefers known feature layers over the first symbol layer", () => {
    const map = fakeMap([
      { id: "water-fill", type: "fill" },
      { id: "place-labels", type: "symbol" },
      { id: "poi-mini-dots", type: "circle" },
    ]);
    expect(overlayBeforeId(map)).toBe("poi-mini-dots");
  });

  it("falls back to the first symbol layer", () => {
    const map = fakeMap([
      { id: "water-fill", type: "fill" },
      { id: "place-labels", type: "symbol" },
    ]);
    expect(overlayBeforeId(map)).toBe("place-labels");
  });

  it("returns undefined when the style has no candidate", () => {
    expect(overlayBeforeId(fakeMap([{ id: "bg", type: "background" }]))).toBe(
      undefined,
    );
  });
});

describe("reconcileOverlays", () => {
  it("adds a source and its layers once, then updates in place", () => {
    const map = fakeMap([{ id: "place-labels", type: "symbol" }]);
    const def = definition("warnings");
    const entry = { definition: def, resolved: geojson(empty) };

    reconcileOverlays(map, [entry]);
    expect(map.getSource("overlay:warnings")).toBeTruthy();
    // Attribution is carried by the source so MapLibre's control credits it.
    expect(
      (map.getStyle().sources["overlay:warnings"] as { attribution?: string })
        .attribution,
    ).toBe("src");
    expect(map.getLayer("overlay:warnings:0")).toBeTruthy();
    expect(map.getLayer("overlay:warnings:1")).toBeTruthy();

    const withFeature: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { level: 4 },
          geometry: { type: "Point", coordinates: [8, 50] },
        },
      ],
    };
    reconcileOverlays(map, [{ definition: def, resolved: geojson(withFeature) }]);
    const source = map.getStyle().sources["overlay:warnings"] as {
      data: GeoJSON.FeatureCollection;
    };
    expect(source.data.features).toHaveLength(1);
    expect(map.getStyle().layers.filter((l) => l.id.startsWith("overlay:"))).toHaveLength(2);
  });

  it("removes overlays that are no longer active", () => {
    const map = fakeMap();
    reconcileOverlays(map, [
      { definition: definition("a"), resolved: geojson(empty) },
      { definition: definition("b"), resolved: geojson(empty) },
    ]);
    expect(map.getSource("overlay:a")).toBeTruthy();
    reconcileOverlays(map, [{ definition: definition("b"), resolved: geojson(empty) }]);
    expect(map.getSource("overlay:a")).toBeUndefined();
    expect(map.getLayer("overlay:a:0")).toBeUndefined();
    expect(map.getSource("overlay:b")).toBeTruthy();
  });

  it("skips overlays whose resolver returns null (no data yet)", () => {
    const map = fakeMap();
    reconcileOverlays(map, [{ definition: definition("a"), resolved: null }]);
    expect(map.getSource("overlay:a")).toBeUndefined();
    expect(map.getStyle().layers).toHaveLength(0);
  });

  it("drops layers a definition stopped producing", () => {
    const map = fakeMap();
    const def = definition("a");
    reconcileOverlays(map, [{ definition: def, resolved: geojson(empty) }]);
    reconcileOverlays(map, [
      {
        definition: def,
        resolved: {
          source: { type: "geojson", data: empty },
          layers: [{ type: "line", paint: { "line-width": 1 } }],
        },
      },
    ]);
    expect(map.getLayer("overlay:a:0")?.type).toBe("line");
    expect(map.getLayer("overlay:a:1")).toBeUndefined();
  });

  it("only pushes GeoJSON data when the reference actually changed", () => {
    const map = fakeMap();
    const def = definition("warnings");
    const areas = empty;
    const entry = { definition: def, resolved: geojson(areas) };

    reconcileOverlays(map, [entry]);
    // addSource carries the data; no setData round-trip is needed.
    expect(map.setDataCalls).toHaveLength(0);

    // A radar frame re-reconciles with the identical warnings collection.
    reconcileOverlays(map, [{ definition: def, resolved: geojson(areas) }]);
    reconcileOverlays(map, [{ definition: def, resolved: geojson(areas) }]);
    expect(map.setDataCalls).toHaveLength(0);

    const fresh: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };
    reconcileOverlays(map, [{ definition: def, resolved: geojson(fresh) }]);
    expect(map.setDataCalls).toEqual([fresh]);
  });

  it("pushes data again after the source was rebuilt", () => {
    const map = fakeMap();
    const def = definition("warnings");
    const areas = empty;
    reconcileOverlays(map, [{ definition: def, resolved: geojson(areas) }]);
    // Force a rebuild by switching the source type back and forth.
    reconcileOverlays(map, [
      {
        definition: def,
        resolved: {
          source: {
            type: "image",
            url: "https://a/1.png",
            coordinates: [
              [1, 56],
              [19, 56],
              [19, 45],
              [1, 45],
            ],
          },
          layers: [{ type: "raster" }],
        },
      },
    ]);
    reconcileOverlays(map, [{ definition: def, resolved: geojson(areas) }]);
    expect(map.getStyle().sources["overlay:warnings"]).toBeTruthy();
    expect(map.getLayer("overlay:warnings:0")?.type).toBe("fill");
  });

  it("rebuilds the overlay when a definition changes its source type", () => {
    const map = fakeMap();
    const def = definition("mixed");
    reconcileOverlays(map, [{ definition: def, resolved: geojson(empty) }]);
    expect(
      (map.getStyle().sources["overlay:mixed"] as { type: string }).type,
    ).toBe("geojson");

    const asImage: ResolvedOverlay = {
      source: {
        type: "image",
        url: "https://a/1.png",
        coordinates: [
          [1, 56],
          [19, 56],
          [19, 45],
          [1, 45],
        ],
      },
      layers: [{ type: "raster", paint: { "raster-opacity": 0.7 } }],
    };
    reconcileOverlays(map, [{ definition: def, resolved: asImage }]);
    expect(
      (map.getStyle().sources["overlay:mixed"] as { type: string }).type,
    ).toBe("image");
    expect(map.getLayer("overlay:mixed:0")?.type).toBe("raster");
    expect(map.getLayer("overlay:mixed:1")).toBeUndefined();
  });

  it("updates an image source in place instead of rebuilding it", () => {
    const map = fakeMap();
    const def = { ...definition("radar"), kind: "raster" as const };
    const image = (url: string): ResolvedOverlay => ({
      source: {
        type: "image",
        url,
        coordinates: [
          [1, 56],
          [19, 56],
          [19, 45],
          [1, 45],
        ],
      },
      layers: [{ type: "raster", paint: { "raster-opacity": 0.7 } }],
    });
    reconcileOverlays(map, [{ definition: def, resolved: image("https://a/1.png") }]);
    // Image sources must not carry `attribution`: MapLibre rejects the source.
    expect(
      "attribution" in (map.getStyle().sources["overlay:radar"] as object),
    ).toBe(false);
    reconcileOverlays(map, [{ definition: def, resolved: image("https://a/2.png") }]);
    const source = map.getStyle().sources["overlay:radar"] as { url: string };
    expect(source.url).toBe("https://a/2.png");
    expect(map.getStyle().layers.filter((l) => l.id.startsWith("overlay:"))).toHaveLength(1);
  });

  it("pushes paint changes through setPaintProperty", () => {
    const map = fakeMap();
    const def = definition("a");
    const resolved = (opacity: number): ResolvedOverlay => ({
      source: { type: "geojson", data: empty },
      layers: [{ type: "fill", paint: { "fill-opacity": opacity } }],
    });
    reconcileOverlays(map, [{ definition: def, resolved: resolved(0.2) }]);
    reconcileOverlays(map, [{ definition: def, resolved: resolved(0.5) }]);
    expect(map.paint.get("overlay:a:0")).toEqual({ "fill-opacity": 0.5 });
  });

  it("clearOverlays removes everything with the overlay prefix only", () => {
    const map = fakeMap([{ id: "place-labels", type: "symbol" }]);
    reconcileOverlays(map, [{ definition: definition("a"), resolved: geojson(empty) }]);
    clearOverlays(map);
    expect(map.getSource("overlay:a")).toBeUndefined();
    expect(map.getLayer("place-labels")).toBeTruthy();
  });
});
