"use client";

import { useEffect } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { useHiking } from "@/lib/hiking/store";
import { THEME, VIA_PALETTE } from "@/lib/theme";
import { registerFeatureTaps } from "@/lib/map/featureTaps";
import type { RouteCandidate, Waypoint } from "@/lib/hiking/types";
import { formatRouteLabel } from "@/lib/routing";

const WAYPOINT_SOURCE = "hiking-waypoints";
const WAYPOINT_HALO_LAYER = "hiking-waypoints-halo";
const WAYPOINT_DOT_LAYER = "hiking-waypoints-dot";
const WAYPOINT_LABEL_LAYER = "hiking-waypoints-label";
const ROUTE_SOURCE = "hiking-routes";
const ROUTE_LAYER_PRIMARY = "hiking-routes-primary";
const ROUTE_LAYER_CASING = "hiking-routes-casing";
const ROUTE_LAYER_ALT = "hiking-routes-alt";
const ROUTE_LAYER_ALT_CASING = "hiking-routes-alt-casing";
const ROUTE_LAYER_LABELS = "hiking-routes-labels";
const ROUTE_LABEL_SOURCE = "hiking-route-labels";
const ROUTE_LAYER_ALT_HIT = "hiking-routes-alt-hit";

export const COLOR_START = THEME.accent;
export const COLOR_END = THEME.warn;

/** Six cool tones shared by alternative routes and via waypoints. */
export function viaColor(index: number): string {
  return VIA_PALETTE[index % VIA_PALETTE.length];
}

export function colorForCandidate(index: number): string {
  return viaColor(index);
}

const HIKING_Z_ORDER: string[] = [
  ROUTE_LAYER_ALT_CASING,
  ROUTE_LAYER_ALT,
  ROUTE_LAYER_ALT_HIT,
  ROUTE_LAYER_CASING,
  ROUTE_LAYER_PRIMARY,
  ROUTE_LAYER_LABELS,
  WAYPOINT_HALO_LAYER,
  WAYPOINT_DOT_LAYER,
  WAYPOINT_LABEL_LAYER,
];

type GeoJsonData =
  | GeoJSON.Feature
  | GeoJSON.FeatureCollection
  | GeoJSON.Geometry;

function ensureSource(map: MLMap, id: string, data: GeoJsonData) {
  const src = map.getSource(id) as unknown as
    | { setData?: (d: GeoJsonData) => void }
    | undefined;
  if (src?.setData) {
    src.setData(data);
    return;
  }
  map.addSource(id, { type: "geojson", data });
}

function removeLayerIfExists(map: MLMap, id: string) {
  if (map.getLayer(id)) map.removeLayer(id);
}
function removeSourceIfExists(map: MLMap, id: string) {
  if (map.getSource(id)) map.removeSource(id);
}

function raiseHikingLayers(map: MLMap) {
  for (const id of HIKING_Z_ORDER) {
    if (map.getLayer(id)) {
      try {
        map.moveLayer(id);
      } catch {
        /* ignore — style is mid-swap */
      }
    }
  }
}

function waypointFeatures(waypoints: Waypoint[]): GeoJSON.FeatureCollection {
  const last = waypoints.length - 1;
  return {
    type: "FeatureCollection",
    features: waypoints.map((w, i) => {
      const role = i === 0 ? "start" : i === last ? "end" : "via";
      const color =
        role === "start"
          ? COLOR_START
          : role === "end"
            ? COLOR_END
            : viaColor(i);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [w.lon, w.lat] },
        properties: {
          id: w.id,
          index: i,
          number: String(i + 1),
          role,
          color,
        },
      };
    }),
  };
}

function routeFeatures(
  candidates: RouteCandidate[],
  selectedId: string | null,
  finalized: boolean,
): GeoJSON.FeatureCollection {
  // When finalized, drop the alts entirely so they don't render.
  const visible = finalized
    ? candidates.filter((c) => c.id === selectedId)
    : candidates;
  return {
    type: "FeatureCollection",
    features: visible.map((c) => {
      // Use the candidate's index in the FULL candidate list (not the
      // filtered `visible` list) so the colour mapping stays stable
      // when alternatives are dropped after finalize.
      const fullIndex = candidates.findIndex((x) => x.id === c.id);
      return {
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: c.coordinates.map(([lon, lat]) => [lon, lat]),
        },
        properties: {
          id: c.id,
          selected: c.id === selectedId,
          color: colorForCandidate(Math.max(0, fullIndex)),
          label: formatRouteLabel(c.distanceKm, c.durationMin),
        },
      };
    }),
  };
}

function routeLabelFeatures(
  candidates: RouteCandidate[],
  selectedId: string | null,
  finalized: boolean,
): GeoJSON.FeatureCollection {
  const visible = finalized
    ? candidates.filter((c) => c.id === selectedId)
    : candidates;
  return {
    type: "FeatureCollection",
    features: visible.map((c) => {
      const point = c.coordinates[Math.floor(c.coordinates.length / 2)] ?? c.coordinates[0];
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [point[0], point[1]] },
        properties: {
          id: c.id,
          selected: c.id === selectedId,
          label: formatRouteLabel(c.distanceKm, c.durationMin),
        },
      };
    }),
  };
}

export function useHikingLayers(map: MLMap | null, visible = true) {
  const hikingEnabled = useHiking((s) => s.enabled);
  const enabled = hikingEnabled && visible;
  const waypoints = useHiking((s) => s.waypoints);
  const candidates = useHiking((s) => s.candidates);
  const selectedCandidateId = useHiking((s) => s.selectedCandidateId);
  const finalized = useHiking((s) => s.finalized);
  const removeWaypoint = useHiking((s) => s.removeWaypoint);
  const selectCandidate = useHiking((s) => s.selectCandidate);

  // Re-raise hiking layers after a basemap or overlay style swap.
  useEffect(() => {
    if (!map) return;
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => raiseHikingLayers(map));
    };
    map.on("styledata", bump);
    return () => {
      cancelAnimationFrame(frame);
      map.off("styledata", bump);
    };
  }, [map]);

  // Waypoint pins (numbered)
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      if (!enabled || waypoints.length === 0) {
        removeLayerIfExists(map, WAYPOINT_LABEL_LAYER);
        removeLayerIfExists(map, WAYPOINT_DOT_LAYER);
        removeLayerIfExists(map, WAYPOINT_HALO_LAYER);
        removeSourceIfExists(map, WAYPOINT_SOURCE);
        return;
      }
      ensureSource(map, WAYPOINT_SOURCE, waypointFeatures(waypoints));
      if (!map.getLayer(WAYPOINT_HALO_LAYER)) {
        map.addLayer({
          id: WAYPOINT_HALO_LAYER,
          type: "circle",
          source: WAYPOINT_SOURCE,
          paint: {
            "circle-radius": 14,
            "circle-color": "transparent",
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2,
            "circle-stroke-opacity": 0.55,
          },
        });
      }
      if (!map.getLayer(WAYPOINT_DOT_LAYER)) {
        map.addLayer({
          id: WAYPOINT_DOT_LAYER,
          type: "circle",
          source: WAYPOINT_SOURCE,
          paint: {
            "circle-radius": 10,
            "circle-color": ["get", "color"],
            "circle-stroke-color": THEME.casing,
            "circle-stroke-width": 2,
            "circle-opacity": 0.95,
          },
        });
      }
      if (!map.getLayer(WAYPOINT_LABEL_LAYER)) {
        map.addLayer({
          id: WAYPOINT_LABEL_LAYER,
          type: "symbol",
          source: WAYPOINT_SOURCE,
          layout: {
            "text-field": ["get", "number"],
            "text-size": 11,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-font": ["Noto Sans Bold"],
          },
          paint: {
            "text-color": THEME.bg,
          },
        });
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
    map.on("style.load", apply);

    // Tap a waypoint to remove it. The pipeline resolves the tap with
    // tolerance across dot + halo and fires feedback before the removal.
    const unregisterTaps = registerFeatureTaps(map, {
      id: "hiking-waypoints",
      layers: [WAYPOINT_DOT_LAYER, WAYPOINT_HALO_LAYER],
      tolerancePx: 16,
      hapticKind: "tap",
      onFeature: (feature) => {
        const id = feature.properties?.id;
        if (typeof id === "string") removeWaypoint(id);
      },
    });
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    if (enabled && waypoints.length > 0) {
      map.on("mouseenter", WAYPOINT_DOT_LAYER, onEnter);
      map.on("mouseleave", WAYPOINT_DOT_LAYER, onLeave);
    }
    return () => {
      unregisterTaps();
      map.off("mouseenter", WAYPOINT_DOT_LAYER, onEnter);
      map.off("mouseleave", WAYPOINT_DOT_LAYER, onLeave);
      map.off("style.load", apply);
    };
  }, [map, enabled, waypoints, removeWaypoint]);

  // Routes (selected + alts), with alt-tap to switch.
  useEffect(() => {
    if (!map) return;
    const apply = () => {
      if (!enabled || candidates.length === 0) {
        removeLayerIfExists(map, ROUTE_LAYER_LABELS);
        removeSourceIfExists(map, ROUTE_LABEL_SOURCE);
        removeLayerIfExists(map, ROUTE_LAYER_ALT_HIT);
        removeLayerIfExists(map, ROUTE_LAYER_ALT);
        removeLayerIfExists(map, ROUTE_LAYER_ALT_CASING);
        removeLayerIfExists(map, ROUTE_LAYER_PRIMARY);
        removeLayerIfExists(map, ROUTE_LAYER_CASING);
        removeSourceIfExists(map, ROUTE_SOURCE);
        return;
      }
      ensureSource(
        map,
        ROUTE_SOURCE,
        routeFeatures(candidates, selectedCandidateId, finalized),
      );
      ensureSource(
        map,
        ROUTE_LABEL_SOURCE,
        routeLabelFeatures(candidates, selectedCandidateId, finalized),
      );
      if (!map.getLayer(ROUTE_LAYER_ALT_CASING)) {
        map.addLayer({
          id: ROUTE_LAYER_ALT_CASING,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["!", ["get", "selected"]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": THEME.casing,
            "line-width": 5,
            "line-opacity": 0.55,
          },
        });
      }
      if (!map.getLayer(ROUTE_LAYER_ALT)) {
        map.addLayer({
          id: ROUTE_LAYER_ALT,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["!", ["get", "selected"]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": THEME.accent,
            "line-width": 2.5,
            "line-opacity": 0.65,
            "line-dasharray": [2, 1.5],
          },
        });
      }
      if (!map.getLayer(ROUTE_LAYER_CASING)) {
        map.addLayer({
          id: ROUTE_LAYER_CASING,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "selected"], true],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": THEME.casing,
            "line-width": 7,
            "line-opacity": 0.8,
          },
        });
      }
      if (!map.getLayer(ROUTE_LAYER_PRIMARY)) {
        map.addLayer({
          id: ROUTE_LAYER_PRIMARY,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["==", ["get", "selected"], true],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": THEME.danger,
            "line-width": 4,
            "line-opacity": 0.95,
          },
        });
      }
      if (!map.getLayer(ROUTE_LAYER_ALT_HIT)) {
        map.addLayer({
          id: ROUTE_LAYER_ALT_HIT,
          type: "line",
          source: ROUTE_SOURCE,
          filter: ["!", ["get", "selected"]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": THEME.casing,
            "line-width": 24,
            "line-opacity": 0.01,
          },
        });
      }
      if (!map.getLayer(ROUTE_LAYER_LABELS)) {
        map.addLayer({
          id: ROUTE_LAYER_LABELS,
          type: "symbol",
          source: ROUTE_LABEL_SOURCE,
          layout: {
            "text-field": ["get", "label"],
            "text-size": 10.5,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-padding": 2,
          },
          paint: {
            "text-color": ["case", ["get", "selected"], THEME.ink, THEME.accent],
            "text-halo-color": THEME.casing,
            "text-halo-width": 2.5,
          },
        });
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
    map.on("style.load", apply);

    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    if (enabled && candidates.length > 0 && !finalized) {
      const unregisterAlt = registerFeatureTaps(map, {
        id: "hiking-alt-routes",
        layers: [ROUTE_LAYER_ALT_HIT],
        tolerancePx: 10,
        onFeature: (feature) => {
          const id = feature.properties?.id;
          if (typeof id === "string") selectCandidate(id);
        },
      });
      // Claiming taps on the selected route keeps the bare-map place
      // card from opening under the finger.
      const unregisterPrimary = registerFeatureTaps(map, {
        id: "hiking-selected-route",
        layers: [ROUTE_LAYER_PRIMARY],
        hapticKind: "tap",
        onFeature: () => {},
      });
      map.on("mouseenter", ROUTE_LAYER_ALT_HIT, onEnter);
      map.on("mouseleave", ROUTE_LAYER_ALT_HIT, onLeave);
      return () => {
        unregisterAlt();
        unregisterPrimary();
        map.off("mouseenter", ROUTE_LAYER_ALT_HIT, onEnter);
        map.off("mouseleave", ROUTE_LAYER_ALT_HIT, onLeave);
      };
    }
    return () => {
      map.off("style.load", apply);
    };
  }, [map, enabled, candidates, selectedCandidateId, finalized, selectCandidate]);
}
