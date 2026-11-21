import maplibregl, { type Map as MLMap } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { BUS_LINE_COLOR } from "@/lib/bus/busRoutes";
import { THEME } from "@/lib/theme";
import {
  TRANSIT_LINES_FILE,
  TRANSIT_STOPS_FILE,
  transitTileUrl,
} from "./tileUrls";

export const TRANSIT_TILES_ENABLED =
  process.env.NEXT_PUBLIC_TRANSIT_TILES !== "0";

export const TRANSIT_LINES_SOURCE = "transit-tiles-lines";
export const TRANSIT_STOPS_SOURCE = "transit-tiles-stops";
export const TRANSIT_BUS_CASING = "transit-bus-casing";
export const TRANSIT_BUS_UNDERLAY = "transit-bus-underlay";
export const TRANSIT_BUS_LINE = "transit-bus-line";
export const TRANSIT_RAIL_LINE = "transit-rail-line";
export const TRANSIT_BUS_STOP_HIT = "transit-bus-stop-hit";
export const TRANSIT_BUS_STOP = "transit-bus-stop";
export const TRANSIT_RAIL_STOP = "transit-rail-stop";

const BUS_LAYERS = [
  TRANSIT_BUS_CASING,
  TRANSIT_BUS_UNDERLAY,
  TRANSIT_BUS_LINE,
  TRANSIT_BUS_STOP_HIT,
  TRANSIT_BUS_STOP,
] as const;
const RAIL_LAYERS = [TRANSIT_RAIL_LINE, TRANSIT_RAIL_STOP] as const;

const BUS_MIN_ZOOM = 9;
const RAIL_MIN_ZOOM = 8;
const STOP_MIN_ZOOM = 12;

let protocol: Protocol | null = null;

function ensureProtocol(): void {
  if (protocol) return;
  protocol = new Protocol();
  try {
    maplibregl.addProtocol("pmtiles", protocol.tile);
  } catch {
    // The history module or a hot reload already registered it.
  }
}

function firstSymbolLayerId(map: MLMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === "symbol") return layer.id;
  }
  return undefined;
}

function ensureSources(map: MLMap): void {
  ensureProtocol();
  if (!map.getSource(TRANSIT_LINES_SOURCE)) {
    map.addSource(TRANSIT_LINES_SOURCE, {
      type: "vector",
      url: transitTileUrl(TRANSIT_LINES_FILE),
      attribution: "© OpenStreetMap contributors",
    });
  }
  if (!map.getSource(TRANSIT_STOPS_SOURCE)) {
    map.addSource(TRANSIT_STOPS_SOURCE, {
      type: "vector",
      url: transitTileUrl(TRANSIT_STOPS_FILE),
      attribution: "© OpenStreetMap contributors",
    });
  }
}

function addLineLayer(
  map: MLMap,
  id: string,
  sourceLayer: string,
  minzoom: number,
  paint: Record<string, unknown>,
  beforeId: string | undefined,
): void {
  if (map.getLayer(id)) return;
  map.addLayer(
    {
      id,
      type: "line",
      source: TRANSIT_LINES_SOURCE,
      "source-layer": sourceLayer,
      minzoom,
      layout: { "line-cap": "round", "line-join": "round" },
      paint,
    } as never,
    beforeId,
  );
}

function addStopLayer(
  map: MLMap,
  id: string,
  sourceLayer: string,
  paint: Record<string, unknown>,
  beforeId: string | undefined,
): void {
  if (map.getLayer(id)) return;
  map.addLayer(
    {
      id,
      type: "circle",
      source: TRANSIT_STOPS_SOURCE,
      "source-layer": sourceLayer,
      minzoom: STOP_MIN_ZOOM,
      paint,
    } as never,
    beforeId,
  );
}

function setVisibility(map: MLMap, ids: readonly string[], visible: boolean): void {
  for (const id of ids) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}

/**
 * Add or update the VPS transit tiles. Idempotent: safe on every style swap,
 * toggle and recovery tick. Bus and rail share the line archive but use
 * separate source layers; stops come from the second archive.
 */
export function ensureTransitTileLayers(
  map: MLMap,
  { bus, rail }: { bus: boolean; rail: boolean },
): void {
  ensureSources(map);
  const beforeId = firstSymbolLayerId(map);

  addLineLayer(
    map,
    TRANSIT_BUS_CASING,
    "bus_routes",
    BUS_MIN_ZOOM,
    {
      "line-color": THEME.casing,
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        9, 1.2,
        12, 2.2,
        14, 3.4,
        17, 4.8,
      ],
      "line-opacity": [
        "interpolate", ["linear"], ["zoom"],
        9, 0.3,
        12, 0.55,
      ],
    },
    beforeId,
  );
  addLineLayer(
    map,
    TRANSIT_BUS_UNDERLAY,
    "bus_routes",
    BUS_MIN_ZOOM,
    {
      "line-color": BUS_LINE_COLOR,
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        9, 0.4,
        12, 0.8,
        14, 1.4,
        17, 2.0,
      ],
      "line-opacity": [
        "interpolate", ["linear"], ["zoom"],
        9, 0.18,
        12, 0.28,
      ],
    },
    beforeId,
  );
  addLineLayer(
    map,
    TRANSIT_BUS_LINE,
    "bus_routes",
    BUS_MIN_ZOOM,
    {
      "line-color": BUS_LINE_COLOR,
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        9, 0.5,
        12, 1.0,
        14, 1.8,
        17, 2.6,
      ],
      "line-opacity": [
        "interpolate", ["linear"], ["zoom"],
        9, 0.55,
        12, 0.82,
      ],
      "line-dasharray": [3, 1.1],
    },
    beforeId,
  );
  addLineLayer(
    map,
    TRANSIT_RAIL_LINE,
    "rail_routes",
    RAIL_MIN_ZOOM,
    {
      "line-color": THEME.info,
      "line-width": [
        "interpolate", ["linear"], ["zoom"],
        8, 0.5,
        9, 0.8,
        12, 1.5,
        16, 2.6,
      ],
      "line-opacity": [
        "interpolate", ["linear"], ["zoom"],
        8, 0.45,
        9, 0.6,
        12, 0.78,
      ],
    },
    beforeId,
  );
  addStopLayer(
    map,
    TRANSIT_BUS_STOP_HIT,
    "bus_stops",
    {
      "circle-radius": 20,
      "circle-color": THEME.casing,
      "circle-opacity": 0,
      "circle-stroke-width": 0,
    },
    beforeId,
  );
  addStopLayer(
    map,
    TRANSIT_BUS_STOP,
    "bus_stops",
    {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 4.5,
        14, 6,
        17, 7.5,
      ],
      "circle-color": BUS_LINE_COLOR,
      "circle-stroke-color": THEME.casing,
      "circle-stroke-width": 1.7,
    },
    beforeId,
  );
  addStopLayer(
    map,
    TRANSIT_RAIL_STOP,
    "rail_stops",
    {
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        12, 4,
        14, 5.5,
        17, 7,
      ],
      "circle-color": THEME.info,
      "circle-stroke-color": THEME.casing,
      "circle-stroke-width": 1.5,
    },
    beforeId,
  );

  setVisibility(map, BUS_LAYERS, bus);
  setVisibility(map, RAIL_LAYERS, rail);
}

export function removeTransitTileLayers(map: MLMap): void {
  for (const id of [
    TRANSIT_RAIL_STOP,
    TRANSIT_BUS_STOP,
    TRANSIT_BUS_STOP_HIT,
    TRANSIT_RAIL_LINE,
    TRANSIT_BUS_LINE,
    TRANSIT_BUS_UNDERLAY,
    TRANSIT_BUS_CASING,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [TRANSIT_STOPS_SOURCE, TRANSIT_LINES_SOURCE]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}
