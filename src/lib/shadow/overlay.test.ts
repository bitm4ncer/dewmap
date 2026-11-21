import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getShadowOverlaySnapshot,
  getShadowVersion,
  resetShadowOverlayStore,
  setShadowOverlayData,
  setShadowOverlayOpacity,
  setShadowOverlayTiles,
  shadowOverlayDefinition,
  subscribeShadowData,
} from "./overlay";

function collection(name: string): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name },
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      },
    ],
  };
}

beforeEach(() => {
  resetShadowOverlayStore();
});

describe("shadow overlay store", () => {
  it("starts empty and resolves to null", () => {
    expect(getShadowVersion()).toBe(0);
    expect(getShadowOverlaySnapshot().geojson).toBeNull();
    expect(shadowOverlayDefinition().resolve()).toBeNull();
  });

  it("bumps the version and notifies subscribers on data", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeShadowData(listener);
    setShadowOverlayData(collection("a"));
    expect(getShadowVersion()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setShadowOverlayData(collection("b"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the snapshot identity stable until a change", () => {
    const first = getShadowOverlaySnapshot();
    expect(getShadowOverlaySnapshot()).toBe(first);
    setShadowOverlayOpacity(0.6);
    expect(getShadowOverlaySnapshot()).not.toBe(first);
  });

  it("forces a re-resolve on every data change", () => {
    const definition = shadowOverlayDefinition();
    const a = collection("a");
    const b = collection("b");
    setShadowOverlayData(a);
    const first = definition.resolve();
    expect(first?.source).toMatchObject({ type: "geojson", data: a });

    setShadowOverlayData(b);
    const second = definition.resolve();
    expect(second?.source).not.toBe(first?.source);
    expect(second?.source).toMatchObject({ type: "geojson", data: b });
    expect(getShadowVersion()).toBe(2);
  });

  it("switches to raster tiles and back", () => {
    const tiles = ["https://tiles.example/shadow/{z}/{x}/{y}.png"];
    setShadowOverlayTiles(tiles, 512);
    const raster = shadowOverlayDefinition().resolve();
    expect(raster?.source).toMatchObject({ type: "raster", tiles, tileSize: 512 });
    expect(raster?.layers[0].type).toBe("raster");

    setShadowOverlayData(collection("a"));
    const vector = shadowOverlayDefinition().resolve();
    expect(vector?.source).toMatchObject({ type: "geojson" });
    expect(vector?.layers[0].type).toBe("fill");
  });

  it("reports the active source kind", () => {
    expect(shadowOverlayDefinition().kind).toBe("geojson");
    setShadowOverlayTiles(["https://tiles.example/{z}/{x}/{y}.png"]);
    expect(shadowOverlayDefinition().kind).toBe("raster");
  });

  it("clamps opacity", () => {
    setShadowOverlayOpacity(2);
    expect(getShadowOverlaySnapshot().opacity).toBe(1);
    setShadowOverlayOpacity(-1);
    expect(getShadowOverlaySnapshot().opacity).toBe(0);
  });
});
