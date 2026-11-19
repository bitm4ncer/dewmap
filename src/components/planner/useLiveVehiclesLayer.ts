"use client";

import { useEffect } from "react";
import {
  Popup,
  type Map as MLMap,
  type MapGeoJSONFeature,
} from "maplibre-gl";
import {
  fetchLiveVehicles,
  formatClock,
  isAbortError,
  isProviderError,
  type LiveVehicle,
} from "@/lib/routing";
import { useTransit } from "@/lib/planner/transitStore";
import { registerFeatureTaps } from "@/lib/map/featureTaps";
import { THEME } from "@/lib/theme";

const SRC = "live-vehicles";
const HALO = "live-vehicles-halo";
const DOTS = "live-vehicles-dots";
const LABELS = "live-vehicles-labels";

function ensureSource(map: MLMap, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(SRC) as unknown as
    | { setData?: (next: GeoJSON.FeatureCollection) => void }
    | undefined;
  if (source?.setData) {
    source.setData(data);
    return;
  }
  map.addSource(SRC, { type: "geojson", data });
}

function removeAll(map: MLMap) {
  try {
    for (const id of [LABELS, DOTS, HALO]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SRC)) map.removeSource(SRC);
  } catch {
    // Map teardown can invalidate the style between the checks.
  }
}

function features(vehicles: LiveVehicle[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: vehicles.map((vehicle) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [vehicle.lon, vehicle.lat],
      },
      properties: {
        id: vehicle.id,
        line: vehicle.line,
        mode: vehicle.modeLabel,
        color: vehicle.color,
        textColor: vehicle.textColor,
        delay: vehicle.delayMin,
        realTime: vehicle.realTime,
        from: vehicle.fromName,
        to: vehicle.toName,
        fromTz: vehicle.fromTz ?? "",
        toTz: vehicle.toTz ?? "",
        departure: vehicle.departure,
        arrival: vehicle.arrival,
      },
    })),
  };
}

function addLayers(map: MLMap, data: GeoJSON.FeatureCollection) {
  ensureSource(map, data);
  if (!map.getLayer(HALO)) {
    map.addLayer({
      id: HALO,
      type: "circle",
      source: SRC,
      paint: {
        "circle-radius": 11,
        "circle-color": ["coalesce", ["get", "color"], THEME.info],
        "circle-opacity": 0.24,
        "circle-blur": 1,
      },
    });
  }
  if (!map.getLayer(DOTS)) {
    map.addLayer({
      id: DOTS,
      type: "circle",
      source: SRC,
      paint: {
        "circle-radius": 5.5,
        "circle-color": ["coalesce", ["get", "color"], THEME.info],
        "circle-stroke-color": THEME.casing,
        "circle-stroke-width": 2,
      },
    });
  }
  if (!map.getLayer(LABELS)) {
    map.addLayer({
      id: LABELS,
      type: "symbol",
      source: SRC,
      minzoom: 10,
      layout: {
        "text-field": ["get", "line"],
        "text-size": 10,
        "text-offset": [0, -1.35],
        "text-anchor": "bottom",
        "text-optional": true,
      },
      paint: {
        "text-color": THEME.ink,
        "text-halo-color": THEME.casing,
        "text-halo-width": 1.7,
      },
    });
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function popupHtml(properties: Record<string, unknown>): string {
  const fromTz = String(properties.fromTz ?? "");
  const toTz = String(properties.toTz ?? "");
  const departure = String(properties.departure ?? "");
  const arrival = String(properties.arrival ?? "");
  const delay = Number(properties.delay ?? 0);
  const live = Boolean(properties.realTime);
  const time = (iso: string, tz: string) =>
    iso ? formatClock(iso, undefined, tz || undefined) : "";
  return `<div style="max-width:240px;font:12px/1.45 system-ui,sans-serif">
    <strong>${escapeHtml(properties.line)}</strong>
    <span style="color:#666"> · ${escapeHtml(properties.mode)}</span>
    <div style="margin-top:3px">${escapeHtml(properties.from)} → ${escapeHtml(properties.to)}</div>
    <div style="color:#666">${time(departure, fromTz)} – ${time(arrival, toTz)}</div>
    <div style="margin-top:3px;color:${delay > 0 ? "#9a5a00" : "#2f6b3f"}">
      ${live ? "Live" : "Timetable"}${delay > 0 ? ` · +${delay} min` : ""}
    </div>
    <div style="margin-top:3px;color:#888">Position interpolated between stops.</div>
  </div>`;
}

function liveError(err: unknown): string {
  if (isProviderError(err) && err.kind === "rate-limit") {
    return "Live vehicles paused by the transit service. Retrying shortly.";
  }
  return "Live vehicle positions are unavailable right now.";
}

/**
 * Keep a live-vehicle layer in sync with the current map window.
 *
 * Requests run every 30 s while the tab is visible and the toggle is on. A
 * rate-limit response backs off to the service's retry-after time.
 */
export function useLiveVehiclesLayer(map: MLMap | null) {
  const enabled = useTransit((s) => s.liveVehicles);

  useEffect(() => {
    if (!map) return;
    if (!enabled) {
      removeAll(map);
      useTransit.getState().setLiveVehicleStatus(0, null);
      useTransit.getState().setLiveVehiclesError(null);
      return;
    }

    let alive = true;
    let inFlight = false;
    let timer: number | undefined;
    let moveTimer: number | undefined;
    let lastFetchAt = 0;
    let controller: AbortController | null = null;
    let current: LiveVehicle[] = [];

    const setStatus = (count: number, at: number | null) =>
      useTransit.getState().setLiveVehicleStatus(count, at);

    const apply = () => {
      if (!alive) return;
      try {
        addLayers(map, features(current));
      } catch {
        // A basemap style swap can remove the source mid-add; the
        // style.load handler rebuilds it.
      }
    };

    const load = async (): Promise<number> => {
      if (!alive || inFlight) return 30_000;
      if (
        typeof document !== "undefined"
        && document.visibilityState !== "visible"
      ) {
        return 30_000;
      }
      const zoom = map.getZoom();
      if (zoom < 8) {
        current = [];
        apply();
        setStatus(0, Date.now());
        useTransit.getState().setLiveVehiclesError(null);
        return 30_000;
      }

      const bounds = map.getBounds();
      lastFetchAt = Date.now();
      inFlight = true;
      controller = new AbortController();
      try {
        const vehicles = await fetchLiveVehicles({
          south: bounds.getSouth(),
          west: bounds.getWest(),
          north: bounds.getNorth(),
          east: bounds.getEast(),
          zoom,
          signal: controller.signal,
        });
        if (!alive) return 30_000;
        current = vehicles;
        apply();
        setStatus(vehicles.length, Date.now());
        useTransit.getState().setLiveVehiclesError(null);
        return 30_000;
      } catch (err) {
        if (!alive || isAbortError(err)) return 30_000;
        current = [];
        apply();
        setStatus(0, null);
        useTransit.getState().setLiveVehiclesError(liveError(err));
        return isProviderError(err) && err.kind === "rate-limit"
          ? Math.max(60_000, (err.retryAfterS ?? 120) * 1000)
          : 60_000;
      } finally {
        inFlight = false;
        controller = null;
      }
    };

    const loop = async () => {
      const delay = await load();
      if (!alive) return;
      timer = window.setTimeout(() => {
        void loop();
      }, delay);
    };

    const openVehiclePopup = (feature: MapGeoJSONFeature) => {
      new Popup({ offset: 12, closeButton: true })
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
    // Taps resolve through the central pipeline with pixel tolerance and
    // instant feedback; claiming the click also stops the bare-map place
    // card from opening on top of the vehicle popup.
    const unregisterTaps = registerFeatureTaps(map, {
      id: "live-vehicles",
      layers: [DOTS, HALO],
      tolerancePx: 18,
      onFeature: openVehiclePopup,
    });
    let started = false;
    const start = () => {
      if (!alive || started) return;
      started = true;
      apply();
      void loop();
    };
    const onStyle = () => {
      apply();
      start();
    };
    const onMove = () => {
      if (!alive || inFlight || Date.now() - lastFetchAt < 5_000) return;
      if (moveTimer) window.clearTimeout(moveTimer);
      moveTimer = window.setTimeout(() => {
        if (alive && !inFlight) void load();
      }, 500);
    };

    // Fetch immediately; layer creation is retried on `style.load` if the
    // basemap is still settling. Waiting only for `load` can hang because
    // that event may already have fired before this effect ran.
    start();
    map.on("style.load", onStyle);
    map.on("moveend", onMove);
    map.on("mouseenter", DOTS, onEnter);
    map.on("mouseleave", DOTS, onLeave);

    return () => {
      alive = false;
      unregisterTaps();
      controller?.abort();
      if (timer) window.clearTimeout(timer);
      if (moveTimer) window.clearTimeout(moveTimer);
      map.off("style.load", onStyle);
      map.off("moveend", onMove);
      map.off("mouseenter", DOTS, onEnter);
      map.off("mouseleave", DOTS, onLeave);
      removeAll(map);
      useTransit.getState().setLiveVehicleStatus(0, null);
    };
  }, [enabled, map]);
}
