import { beforeEach, describe, expect, it } from "vitest";
import { overlayCredits } from "./MapCredit";
import { resetOverlayRegistry, registerOverlay } from "@/lib/overlays";
import type { OverlayDefinition, OverlaySource } from "@/lib/overlays/types";

function definition(
  id: string,
  label: string,
  source: OverlaySource,
  attribution: OverlayDefinition["attribution"],
): OverlayDefinition {
  return {
    id,
    label,
    group: "weather",
    kind: source.type === "geojson" ? "geojson" : "raster",
    description: "",
    attribution,
    opacity: 1,
    timeAware: false,
    order: 1,
    resolve: () => ({
      source,
      layers: [{ type: source.type === "geojson" ? "fill" : "raster" }],
    }),
  };
}

const image: OverlaySource = {
  type: "image",
  url: "https://example.test/a.png",
  coordinates: [
    [1, 56],
    [19, 56],
    [19, 45],
    [1, 45],
  ],
};
const geojson: OverlaySource = {
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
};
const raster: OverlaySource = {
  type: "raster",
  tiles: ["https://example.test/{z}/{x}/{y}.png"],
};

describe("map credit", () => {
  beforeEach(() => resetOverlayRegistry());

  it("credits image overlays, which MapLibre cannot credit itself", () => {
    registerOverlay(
      definition("radar", "Rain radar", image, {
        label: "Deutscher Wetterdienst (DWD)",
        short: "DWD",
        url: "https://www.dwd.de/opendata",
      }),
    );
    const credits = overlayCredits({ radar: true }, { radar: "image" });
    expect(credits).toEqual([
      {
        id: "radar",
        label: "Rain radar",
        short: "DWD",
        url: "https://www.dwd.de/opendata",
      },
    ]);
  });

  it("stays silent for sources that carry their own attribution", () => {
    registerOverlay(
      definition("warnings", "Warnings", geojson, {
        label: "DWD",
        short: "DWD",
      }),
    );
    registerOverlay(
      definition("tiles", "Tiles", raster, { label: "DWD", short: "DWD" }),
    );
    expect(
      overlayCredits({ warnings: true, tiles: true }, { warnings: "geojson", tiles: "raster" }),
    ).toEqual([]);
  });

  it("skips overlays that are off or not resolved yet", () => {
    registerOverlay(
      definition("radar", "Rain radar", image, { label: "DWD", short: "DWD" }),
    );
    registerOverlay(
      definition("shadow", "Shadows", image, { label: "Geobasis NRW", short: "Geobasis NRW" }),
    );
    expect(overlayCredits({ radar: false, shadow: true }, { shadow: "image" })).toHaveLength(1);
    expect(overlayCredits({ radar: true }, { radar: null })).toEqual([]);
  });

  it("lists several image overlays in a stable order", () => {
    registerOverlay(
      definition("shadow", "Shadows", image, { label: "Geobasis NRW", short: "Geobasis NRW" }),
    );
    registerOverlay(
      definition("radar", "Rain radar", image, { label: "DWD", short: "DWD" }),
    );
    const credits = overlayCredits(
      { radar: true, shadow: true },
      { radar: "image", shadow: "image" },
    );
    expect(credits.map((c) => c.label)).toEqual(["Rain radar", "Shadows"]);
  });

  it("falls back to the full label when no short form is given", () => {
    registerOverlay(
      definition("radar", "Rain radar", image, {
        label: "Deutscher Wetterdienst (DWD)",
      }),
    );
    expect(overlayCredits({ radar: true }, { radar: "image" })[0].short).toBe(
      "Deutscher Wetterdienst (DWD)",
    );
  });
});
