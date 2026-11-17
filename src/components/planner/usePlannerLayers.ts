"use client";

import { useEffect } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { useCar } from "@/lib/planner/carStore";
import { useTransit } from "@/lib/planner/transitStore";
import type { RoutePlan } from "@/lib/routing";

const SRC = "planner-route";
const CASING = "planner-route-casing";
const LINE = "planner-route-line";
const WALK = "planner-route-walk";
const STOPS = "planner-stops";
const STOP_DOTS = "planner-stop-dots";

const ACCENT = "#d8ef6a";
const TRANSIT = "#8cc8ff";
const WALK_COLOR = "#b9bbad";
const INK = "#f4f3ea";

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

function carFeature(route: RoutePlan): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: route.coordinates.map(([lon, lat]) => [lon, lat]),
        },
        properties: {},
      },
    ],
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
  const legs = journey.transit?.legs ?? [];
  for (const leg of legs) {
    if (leg.coordinates.length < 2) continue;
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: leg.coordinates.map(([lon, lat]) => [lon, lat]),
      },
      properties: { mode: leg.mode, line: leg.line ?? "" },
    };
    (leg.mode === "walk" ? walk : ride).push(feature);
    for (const stop of [leg.from, leg.to]) {
      stops.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [stop.lon, stop.lat] },
        properties: { name: stop.name },
      });
    }
  }
  return {
    ride: { type: "FeatureCollection", features: ride },
    walk: { type: "FeatureCollection", features: walk },
    stops: { type: "FeatureCollection", features: stops },
  };
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
      for (const id of [STOP_DOTS, WALK, LINE, CASING, "planner-endpoints-layer"]) {
        remove(map, id, "layer");
      }
      for (const id of [STOPS, SRC, "planner-route-walk-src", "planner-endpoints"]) {
        remove(map, id, "source");
      }

      if (mode === "car") {
        const route = carRoutes.find((r) => r.id === carSelected);
        if (!route) return;
        ensureSource(map, SRC, carFeature(route));
        map.addLayer({
          id: CASING,
          type: "line",
          source: SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#0e0f0c",
            "line-width": 9,
            "line-opacity": 0.9,
          },
        });
        map.addLayer({
          id: LINE,
          type: "line",
          source: SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ACCENT, "line-width": 5 },
        });
        ensureSource(map, STOPS, pointFeatures(carWaypoints));
        map.addLayer({
          id: STOP_DOTS,
          type: "circle",
          source: STOPS,
          paint: {
            "circle-radius": 6,
            "circle-color": ACCENT,
            "circle-stroke-color": "#0e0f0c",
            "circle-stroke-width": 2,
          },
        });
        return;
      }

      if (mode === "transit") {
        const journey = transitJourneys.find((j) => j.id === transitSelected);
        if (!journey) return;
        const { ride, walk, stops } = transitFeatures(journey);
        ensureSource(map, SRC, ride);
        map.addLayer({
          id: LINE,
          type: "line",
          source: SRC,
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": TRANSIT, "line-width": 5 },
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
            "circle-radius": 4,
            "circle-color": INK,
            "circle-stroke-color": "#0e0f0c",
            "circle-stroke-width": 1.5,
          },
        });

        // From / to markers sit above stop dots.
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
                "circle-stroke-color": "#13140d",
                "circle-stroke-width": 3,
              },
            });
          }
        }
      }
    };

    if (map.isStyleLoaded()) apply();
    map.on("style.load", apply);
    return () => {
      map.off("style.load", apply);
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
