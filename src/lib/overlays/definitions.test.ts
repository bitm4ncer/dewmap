import { beforeEach, describe, expect, it } from "vitest";
import {
  RADAR_OVERLAY_ID,
  WARNINGS_OVERLAY_ID,
  radarOverlay,
  registerWeatherOverlays,
  warningsOverlay,
} from "./definitions";
import { getOverlay, resetOverlayRegistry } from "./index";
import { THEME } from "../theme";

const image = { width: 1000, height: 974, bounds: [1, 45, 19, 56] as [number, number, number, number] };
const frame = {
  slot: "20261121T0450",
  time: "2026-11-21T04:50:00.000Z",
  kind: "analysis" as const,
  url: "/api/weather/radar/frames/20261121T0450.png",
};

describe("radar overlay", () => {
  it("has no source until frames exist", () => {
    expect(
      radarOverlay.resolve({ opacity: 0.7, radar: null, warnings: null }),
    ).toBeNull();
    expect(
      radarOverlay.resolve({
        opacity: 0.7,
        radar: { frames: [], index: 0, image },
        warnings: null,
      }),
    ).toBeNull();
  });

  it("renders the selected frame as a georeferenced image", () => {
    const resolved = radarOverlay.resolve({
      opacity: 0.6,
      radar: { frames: [frame], index: 0, image },
      warnings: null,
    });
    expect(resolved?.source.type).toBe("image");
    if (resolved?.source.type !== "image") throw new Error("unreachable");
    expect(resolved.source.url).toBe(
      "https://data.dewmap.app/api/weather/radar/frames/20261121T0450.png",
    );
    expect(resolved.source.coordinates).toEqual([
      [1, 56],
      [19, 56],
      [19, 45],
      [1, 45],
    ]);
    expect(resolved.layers[0].paint?.["raster-opacity"]).toBe(0.6);
  });

  it("is a time-aware overlay from the DWD", () => {
    expect(radarOverlay.timeAware).toBe(true);
    expect(radarOverlay.group).toBe("weather");
    expect(radarOverlay.attribution.label).toContain("Deutscher Wetterdienst");
    expect(radarOverlay.maxzoom).toBeUndefined();
  });
});

describe("warnings overlay", () => {
  it("has no source until the payload is loaded", () => {
    expect(
      warningsOverlay.resolve({ opacity: 1, radar: null, warnings: null }),
    ).toBeNull();
  });

  it("paints severity areas with fill and outline", () => {
    const areas = { type: "FeatureCollection" as const, features: [] };
    const resolved = warningsOverlay.resolve({
      opacity: 1,
      radar: null,
      warnings: areas,
    });
    expect(resolved?.source.type).toBe("geojson");
    expect(resolved?.layers.map((l) => l.type)).toEqual(["fill", "line"]);
    expect(JSON.stringify(resolved?.layers[0].paint)).toContain(THEME.warningLevel4);
  });

  it("scales the fill and line opacity with the overlay opacity", () => {
    const areas = { type: "FeatureCollection" as const, features: [] };
    const dim = warningsOverlay.resolve({
      opacity: 0.5,
      radar: null,
      warnings: areas,
    });
    expect(dim?.layers[0].paint?.["fill-opacity"]).toBeCloseTo(0.09);
    expect(dim?.layers[1].paint?.["line-opacity"]).toBeCloseTo(0.45);
  });

  it("offers a popup for tapped areas", () => {
    expect(typeof warningsOverlay.popup).toBe("function");
    expect(warningsOverlay.popup?.({ level: 4, headline: "Test" })).toContain("Test");
  });
});

describe("registration", () => {
  beforeEach(() => resetOverlayRegistry());

  it("registers both weather overlays exactly once", () => {
    registerWeatherOverlays();
    registerWeatherOverlays();
    expect(getOverlay(RADAR_OVERLAY_ID)).toBe(radarOverlay);
    expect(getOverlay(WARNINGS_OVERLAY_ID)).toBe(warningsOverlay);
  });

  it("keeps warnings above the radar in the stacked order", () => {
    registerWeatherOverlays();
    expect(warningsOverlay.order).toBeGreaterThan(radarOverlay.order);
  });
});
