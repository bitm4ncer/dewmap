"use client";

import { useEffect } from "react";
import { THEME } from "@/lib/theme";
import {
  Popup,
  type Map as MLMap,
  type MapGeoJSONFeature,
} from "maplibre-gl";
import { useCar } from "@/lib/planner/carStore";
import { useTransit } from "@/lib/planner/transitStore";
import { registerFeatureTaps } from "@/lib/map/featureTaps";
import {
  bestJourneyId,
  lineColor,
  lineLabel,
  lineTextColor,
  stopLabel,
} from "@/lib/planner/transitFormat";
import {
  formatRouteLabel,
  type RoutePlan,
  type TransitLeg,
  type TransitStopRef,
} from "@/lib/routing";

const SRC = "planner-route";
const CASING = "planner-route-casing";
const LINE = "planner-route-line";
const LINE_LABELS = "planner-line-labels";
const WALK = "planner-route-walk";
const ALT = "planner-route-alt";
const ALT_HIT = "planner-route-alt-hit";
const ALT_CASING = "planner-route-alt-casing";
const LABELS = "planner-route-labels";
const LABELS_SRC = "planner-route-labels-src";
const STOPS = "planner-stops";
const STOP_DOTS = "planner-stop-dots";
const STOP_HIT = "planner-stop-hit";
const STOP_LABELS = "planner-stop-labels";

const ACCENT = THEME.accent;
const TRANSIT = THEME.info;
const WALK_COLOR = THEME.inkDim;
const INK = THEME.ink;

type Data =
  | GeoJSON.Feature
  | GeoJSON.FeatureCollection
  | GeoJSON.Geometry;

function ensureSource(map: MLMap, id: string, data: Data) {
  const src = map.getSource(id) as unknown as
    | { setData?: (d: Data) => void }
    | undefined;
  if (src?.setData) {
    src.setData(data);
    return;
  }
  map.addSource(id, { type: "geojson", data });
}

function remove(map: MLMap, id: string, kind: "layer" | "source") {
  if (kind === "layer" && map.getLayer(id)) map.removeLayer(id);
  if (kind === "source" && map.getSource(id)) map.removeSource(id);
}

function carLabelFeatures(
  routes: RoutePlan[],
  selectedId: string | null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.map((route) => {
      const point =
        route.coordinates[Math.floor(route.coordinates.length / 2)] ??
        route.coordinates[0];
      return {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [point[0], point[1]] },
        properties: {
          id: route.id,
          selected: route.id === selectedId,
          label: formatRouteLabel(route.distanceKm, route.durationMin),
        },
      };
    }),
  };
}

function carFeatures(
  routes: RoutePlan[],
  selectedId: string | null,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.map((route) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: route.coordinates.map(([lon, lat]) => [lon, lat]),
      },
      properties: {
        id: route.id,
        selected: route.id === selectedId,
        label: formatRouteLabel(route.distanceKm, route.durationMin),
      },
    })),
  };
}

function stopFeature(
  stop: TransitStopRef,
  properties: Record<string, unknown>,
): GeoJSON.Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
    properties: {
      name: stopLabel(stop),
      stopId: stop.stopId ?? "",
      city: stop.city ?? "",
      platform: stop.platform ?? "",
      description: stop.description ?? "",
      tz: stop.tz ?? "",
      ...properties,
    },
  };
}

function transitFeatures(journey: RoutePlan): {
  ride: GeoJSON.FeatureCollection;
  walk: GeoJSON.FeatureCollection;
  stops: GeoJSON.FeatureCollection;
} {
  const ride: GeoJSON.Feature[] = [];
  const walk: GeoJSON.Feature[] = [];
  const stops: GeoJSON.Feature[] = [];
  const seenStops = new Map<string, GeoJSON.Feature>();
  const legs = journey.transit?.legs ?? [];

  for (const leg of legs) {
    if (leg.coordinates.length >= 2) {
      const feature: GeoJSON.Feature = {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: leg.coordinates.map(([lon, lat]) => [lon, lat]),
        },
        properties: {
          mode: leg.mode,
          line: leg.mode === "walk" ? "" : lineLabel(leg),
          color: leg.mode === "walk" ? WALK_COLOR : lineColor(leg),
          textColor: lineTextColor(leg),
          cancelled: leg.cancelled,
          direction: leg.headsign ?? stopLabel(leg.to),
          from: stopLabel(leg.from),
          to: stopLabel(leg.to),
          platform: leg.from.platform ?? "",
          agency: leg.agency ?? "",
        },
      };
      (leg.mode === "walk" ? walk : ride).push(feature);
    }

    for (const [stop, role] of [
      [leg.from, iPrecedingRole(legs, leg, "board")],
      [leg.to, iPrecedingRole(legs, leg, "alight")],
    ] as [TransitStopRef, string][]) {
      const key = stop.stopId ?? `${stop.name}@${stop.lat},${stop.lon}`;
      const existing = seenStops.get(key);
      const feature = stopFeature(stop, {
        role,
        line: leg.mode === "walk" ? "" : lineLabel(leg),
        color: leg.mode === "walk" ? WALK_COLOR : lineColor(leg),
        time: role === "board" ? leg.departure : leg.arrival,
        cancelled: leg.cancelled,
      });
      if (!existing) {
        seenStops.set(key, feature);
        stops.push(feature);
      } else {
        const rank: Record<string, number> = {
          intermediate: 0,
          alight: 1,
          board: 2,
          transfer: 3,
        };
        const existingRole = String(existing.properties?.role ?? "intermediate");
        if ((rank[role] ?? 0) > (rank[existingRole] ?? 0)) {
          existing.properties = { ...existing.properties, ...feature.properties };
        }
      }
    }

    for (const stop of leg.intermediateStops ?? []) {
      const key = stop.stopId ?? `${stop.name}@${stop.lat},${stop.lon}`;
      if (seenStops.has(key)) continue;
      const feature = stopFeature(stop, {
        role: "intermediate",
        line: leg.mode === "walk" ? "" : lineLabel(leg),
        color: lineColor(leg),
        time: stop.departure ?? stop.arrival ?? "",
        cancelled: stop.cancelled ?? leg.cancelled,
      });
      seenStops.set(key, feature);
      stops.push(feature);
    }
  }

  return {
    ride: { type: "FeatureCollection", features: ride },
    walk: { type: "FeatureCollection", features: walk },
    stops: { type: "FeatureCollection", features: stops },
  };
}

/**
 * A boarding stop should win over an earlier alighting role at the same
 * station; a transfer is both. Kept as a small function so the feature
 * builder stays readable.
 */
function iPrecedingRole(
  allLegs: TransitLeg[],
  leg: TransitLeg,
  fallback: "board" | "alight",
): "board" | "alight" | "transfer" {
  const index = allLegs.indexOf(leg);
  if (index > 0 && allLegs[index - 1]?.mode === "transit" && fallback === "board") {
    return "transfer";
  }
  if (index >= 0 && allLegs[index + 1]?.mode === "transit" && fallback === "alight") {
    return "transfer";
  }
  return fallback;
}

function pointFeatures(points: { lon: number; lat: number }[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { index: i },
    })),
  };
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(properties: Record<string, unknown>): string {
  const role = String(properties.role ?? "");
  const roleLabel =
    role === "board" ? "Board" : role === "alight" ? "Alight" : role === "transfer" ? "Transfer" : "Stop";
  const line = String(properties.line ?? "");
  const platform = String(properties.platform ?? "");
  const time = String(properties.time ?? "");
  const timeZone = String(properties.tz ?? "");
  let timeLabel = "";
  if (time) {
    try {
      timeLabel = new Date(time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        ...(timeZone ? { timeZone } : {}),
      });
    } catch {
      timeLabel = new Date(time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
  }
  return `<div style="max-width:230px;font:12px/1.4 system-ui,sans-serif">
    <strong>${escapeHtml(properties.name)}</strong>
    <div style="color:#666">${roleLabel}${line ? ` · ${escapeHtml(line)}` : ""}</div>
    ${platform ? `<div>Platform ${escapeHtml(platform)}</div>` : ""}
    ${timeLabel ? `<div>${escapeHtml(timeLabel)}</div>` : ""}
  </div>`;
}

export function usePlannerLayers(map: MLMap | null, mode: "car" | "transit" | null) {
  const carRoutes = useCar((s) => s.routes);
  const carSelected = useCar((s) => s.selectedId);
  const carWaypoints = useCar((s) => s.waypoints);
  const transitJourneys = useTransit((s) => s.journeys);
  const transitSelected = useTransit((s) => s.selectedId);
  const transitFrom = useTransit((s) => s.from);
  const transitTo = useTransit((s) => s.to);

  useEffect(() => {
    if (!map) return;

    const apply = () => {
      for (const id of [
        STOP_LABELS,
        LINE_LABELS,
        STOP_DOTS,
        STOP_HIT,
        WALK,
        LABELS,
        ALT_HIT,
        ALT,
        ALT_CASING,
        LINE,
        CASING,
        "planner-endpoints-layer",
      ]) {
        remove(map, id, "layer");
      }
      for (const id of [
        STOPS,
        LABELS_SRC,
        "planner-route-walk-src",
        SRC,
        "planner-endpoints",
      ]) {
        remove(map, id, "source");
      }

      if (mode === "car") {
        const selected = carSelected ?? carRoutes[0]?.id ?? null;
        const route = carRoutes.find((r) => r.id === selected);
        if (!route) return;
        ensureSource(map, SRC, carFeatures(carRoutes, selected));
        ensureSource(map, LABELS_SRC, carLabelFeatures(carRoutes, selected));
        map.addLayer({
          id: ALT_CASING,
          type: "line",
          source: SRC,
          filter: ["!", ["get", "selected"]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": THEME.casing,
            "line-width": 5,
            "line-opacity": 0.55,
          },
        });
        map.addLayer({
          id: ALT,
          type: "line",
          source: SRC,
          filter: ["!", ["get", "selected"]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ACCENT,
            "line-width": 2.5,
            "line-opacity": 0.65,
            "line-dasharray": [2, 1.5],
          },
        });
        map.addLayer({
          id: ALT_HIT,
          type: "line",
          source: SRC,
          filter: ["!", ["get", "selected"]],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": THEME.casing,
            "line-width": 24,
            "line-opacity": 0.01,
          },
        });
        map.addLayer({
          id: CASING,
          type: "line",
          source: SRC,
          filter: ["==", ["get", "selected"], true],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": THEME.casing,
            "line-width": 9,
            "line-opacity": 0.9,
          },
        });
        map.addLayer({
          id: LINE,
          type: "line",
          source: SRC,
          filter: ["==", ["get", "selected"], true],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": THEME.danger, "line-width": 5 },
        });
        map.addLayer({
          id: LABELS,
          type: "symbol",
          source: LABELS_SRC,
          layout: {
            "text-field": ["get", "label"],
            "text-size": 10.5,
            "text-allow-overlap": true,
            "text-ignore-placement": true,
            "text-padding": 2,
          },
          paint: {
            "text-color": ["case", ["get", "selected"], INK, ACCENT],
            "text-halo-color": THEME.casing,
            "text-halo-width": 2.5,
          },
        });
        ensureSource(map, STOPS, pointFeatures(carWaypoints));
        map.addLayer({
          id: STOP_DOTS,
          type: "circle",
          source: STOPS,
          paint: {
            "circle-radius": 6,
            "circle-color": ACCENT,
            "circle-stroke-color": THEME.casing,
            "circle-stroke-width": 2,
          },
        });
        // Invisible, finger-sized tap target around each waypoint dot.
        map.addLayer({
          id: STOP_HIT,
          type: "circle",
          source: STOPS,
          paint: {
            "circle-radius": 16,
            "circle-color": THEME.casing,
            "circle-opacity": 0,
            "circle-stroke-width": 0,
          },
        });
        return;
      }

      if (mode === "transit") {
        const journey =
          transitJourneys.find((j) => j.id === transitSelected)
          ?? transitJourneys.find((j) => j.id === bestJourneyId(transitJourneys));
        if (!journey) return;
        const { ride, walk, stops } = transitFeatures(journey);
        ensureSource(map, SRC, ride);
        map.addLayer({
          id: CASING,
          type: "line",
          source: SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": THEME.casing,
            "line-width": 9,
            "line-opacity": 0.85,
          },
        });
        map.addLayer({
          id: LINE,
          type: "line",
          source: SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["coalesce", ["get", "color"], TRANSIT],
            "line-width": 5,
            "line-opacity": ["case", ["get", "cancelled"], 0.55, 1],
          },
        });
        map.addLayer({
          id: LINE_LABELS,
          type: "symbol",
          source: SRC,
          minzoom: 8,
          layout: {
            "symbol-placement": "line",
            "symbol-spacing": 220,
            "text-field": ["get", "line"],
            "text-size": 10,
            "text-rotation-alignment": "map",
            "text-pitch-alignment": "map",
            "text-keep-upright": false,
          },
          paint: {
            "text-color": ["coalesce", ["get", "textColor"], INK],
            "text-halo-color": THEME.casing,
            "text-halo-width": 2,
          },
        });
        if (walk.features.length > 0) {
          ensureSource(map, "planner-route-walk-src", walk);
          map.addLayer({
            id: WALK,
            type: "line",
            source: "planner-route-walk-src",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": WALK_COLOR,
              "line-width": 3,
              "line-dasharray": [2, 2],
            },
          });
        }
        ensureSource(map, STOPS, stops);
        map.addLayer({
          id: STOP_DOTS,
          type: "circle",
          source: STOPS,
          paint: {
            "circle-radius": [
              "case",
              ["==", ["get", "role"], "intermediate"],
              3,
              5.5,
            ],
            "circle-color": [
              "case",
              ["==", ["get", "role"], "intermediate"],
              ["coalesce", ["get", "color"], INK],
              INK,
            ],
            "circle-stroke-color": THEME.casing,
            "circle-stroke-width": 1.5,
          },
        });
        // Invisible, finger-sized tap target around each stop dot.
        map.addLayer({
          id: STOP_HIT,
          type: "circle",
          source: STOPS,
          paint: {
            "circle-radius": 15,
            "circle-color": THEME.casing,
            "circle-opacity": 0,
            "circle-stroke-width": 0,
          },
        });
        map.addLayer({
          id: STOP_LABELS,
          type: "symbol",
          source: STOPS,
          minzoom: 9,
          layout: {
            "text-field": ["get", "name"],
            "text-size": 10.5,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-optional": true,
          },
          paint: {
            "text-color": INK,
            "text-halo-color": THEME.casing,
            "text-halo-width": 1.6,
          },
        });

        const endpoints = [transitFrom, transitTo].filter(
          (p): p is NonNullable<typeof p> => p != null,
        );
        if (endpoints.length > 0) {
          ensureSource(map, "planner-endpoints", pointFeatures(endpoints));
          if (!map.getLayer("planner-endpoints-layer")) {
            map.addLayer({
              id: "planner-endpoints-layer",
              type: "circle",
              source: "planner-endpoints",
              paint: {
                "circle-radius": 7,
                "circle-color": ACCENT,
                "circle-stroke-color": THEME.casing,
                "circle-stroke-width": 3,
              },
            });
          }
        }
      }
    };

    const openStopPopup = (feature: MapGeoJSONFeature) => {      new Popup({ offset: 10, closeButton: true })
        .setLngLat(
          (feature.geometry as GeoJSON.Point).coordinates as [number, number],
        )
        .setHTML(popupHtml(feature.properties ?? {}))
        .addTo(map);
    };
    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };

    const safeApply = () => {
      try {
        apply();
      } catch {
        // A style swap can remove sources between the check and addLayer.
      }
    };

    if (map.isStyleLoaded()) safeApply();
    else map.once("load", safeApply);
    map.on("style.load", safeApply);

    // Taps resolve through the central pipeline with pixel tolerance:
    // stops get an invisible hit disc plus extra padding, alt routes a
    // wider hit line. Feedback (haptic + ripple) fires before the popup
    // or route switch happens.
    const unregisterStops = registerFeatureTaps(map, {
      id: "planner-stops",
      layers: [STOP_HIT, STOP_DOTS],
      tolerancePx: 18,
      onFeature: openStopPopup,
    });
    const unregisterAlt = registerFeatureTaps(map, {
      id: "planner-alt-routes",
      layers: [ALT_HIT],
      tolerancePx: 10,
      onFeature: (feature) => {
        const id = feature.properties?.id;
        if (typeof id !== "string") return;
        useCar.getState().selectRoute(id);
      },
    });
    // Claiming taps on the selected line keeps them from falling through
    // to the bare-map place card.
    const unregisterPrimary = registerFeatureTaps(map, {
      id: "planner-selected-route",
      layers: [LINE],
      hapticKind: "tap",
      onFeature: () => {},
    });
    map.on("mouseenter", STOP_DOTS, onEnter);
    map.on("mouseleave", STOP_DOTS, onLeave);
    map.on("mouseenter", ALT_HIT, onEnter);
    map.on("mouseleave", ALT_HIT, onLeave);
    return () => {
      unregisterStops();
      unregisterAlt();
      unregisterPrimary();
      map.off("load", safeApply);
      map.off("style.load", safeApply);
      map.off("mouseenter", STOP_DOTS, onEnter);
      map.off("mouseleave", STOP_DOTS, onLeave);
      map.off("mouseenter", ALT_HIT, onEnter);
      map.off("mouseleave", ALT_HIT, onLeave);
    };
  }, [
    map,
    mode,
    carRoutes,
    carSelected,
    carWaypoints,
    transitJourneys,
    transitSelected,
    transitFrom,
    transitTo,
  ]);
}
