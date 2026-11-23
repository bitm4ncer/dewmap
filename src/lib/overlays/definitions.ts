/**
 * The overlays this build ships: DWD rain radar and DWD weather warnings.
 *
 * Both are registered into the generic registry; nothing here is special-cased
 * in the map code. A future layer (lightning, wind, river levels, …) only
 * needs another `registerOverlay` call.
 */
import { dataApiUrl } from "./api";
import { registerOverlay } from "./index";
import { radarCoordinates } from "./radar";
import { severityColorExpression, warningPopupHtml } from "./warnings";
import type { OverlayDefinition } from "./types";

export const RADAR_OVERLAY_ID = "weather-radar";
export const WARNINGS_OVERLAY_ID = "weather-warnings";

const DWD: OverlayDefinition["attribution"] = {
  label: "Deutscher Wetterdienst (DWD)",
  short: "DWD",
  // DWD's copyright subpage moved; the open-data portal carries the
  // DL-DE-BY-2.0 terms and the attribution rules.
  url: "https://www.dwd.de/opendata",
};

export const radarOverlay: OverlayDefinition = {
  id: RADAR_OVERLAY_ID,
  label: "Rain radar",
  group: "weather",
  kind: "raster",
  description:
    "Radar composite RV · 1 km · 5 min · analysis plus 90 min nowcast · Germany",
  attribution: DWD,
  opacity: 0.72,
  // The composite is ~1.3 km per source pixel; past z12 the blobs get larger
  // than any useful detail, so the layer stops there.
  maxzoom: 12,
  timeAware: true,
  order: 100,
  resolve: ({ opacity, radar }) => {
    if (!radar) return null;
    const frame = radar.frames[radar.index];
    if (!frame) return null;
    return {
      source: {
        type: "image",
        url: dataApiUrl(frame.url),
        coordinates: radarCoordinates(radar.image.bounds),
      },
      layers: [
        {
          type: "raster",
          maxzoom: 12,
          paint: {
            "raster-opacity": opacity,
            "raster-fade-duration": 0,
            "raster-resampling": "linear",
          },
        },
      ],
    };
  },
};

export const warningsOverlay: OverlayDefinition = {
  id: WARNINGS_OVERLAY_ID,
  label: "Weather warnings",
  group: "weather",
  kind: "geojson",
  description:
    "Official DWD warnings by district and municipality · severity areas",
  attribution: DWD,
  opacity: 1,
  timeAware: false,
  order: 110,
  popup: warningPopupHtml,
  resolve: ({ opacity, warnings }) => {
    if (!warnings) return null;
    return {
      source: { type: "geojson", data: warnings },
      layers: [
        {
          type: "fill",
          paint: {
            "fill-color": severityColorExpression(),
            // A level-2 warning can cover half of Germany, so the fill stays
            // light; severity reads through colour and outline weight.
            "fill-opacity": [
              "match",
              ["get", "level"],
              4,
              0.26 * opacity,
              3,
              0.16 * opacity,
              0.08 * opacity,
            ],
          },
        },
        {
          type: "line",
          paint: {
            "line-color": severityColorExpression(),
            "line-width": [
              "match",
              ["get", "level"],
              4,
              2.2,
              3,
              1.6,
              1.1,
            ],
            "line-opacity": 0.9 * opacity,
          },
        },
      ],
    };
  },
};

let registered = false;

/** Idempotent: safe on HMR and in React strict mode. */
export function registerWeatherOverlays(): void {
  if (registered) return;
  registered = true;
  registerOverlay(radarOverlay);
  registerOverlay(warningsOverlay);
}
