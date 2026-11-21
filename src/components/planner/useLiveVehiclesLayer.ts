"use client";

import { useEffect, useRef } from "react";
import {
  Popup,
  type IControl,
  type Map as MLMap,
  type MapGeoJSONFeature,
} from "maplibre-gl";
import {
  LIVE_MIN_ZOOM,
  LIVE_POLL_MS,
  MAX_LIVE_VEHICLES,
  alertGateAction,
  alertStopCandidates,
  commitAlertGate,
  fetchAreaAlerts,
  fetchLiveVehiclesChunked,
  filterLiveVehicles,
  formatClock,
  isAbortError,
  isProviderError,
  lineKey,
  pollDelayForPayload,
  resetAlertGate,
  type AlertGate,
  type LiveVehicle,
  type TransitAlert,
} from "@/lib/routing";
import { formatAlertPeriod } from "@/lib/planner/transitFormat";
import { useTransit } from "@/lib/planner/transitStore";
import { registerFeatureTaps } from "@/lib/map/featureTaps";
import { THEME } from "@/lib/theme";

const SRC = "live-vehicles";
const HALO = "live-vehicles-halo";
const DOTS = "live-vehicles-dots";
const FERRY = "live-vehicles-ferry";
const LABELS = "live-vehicles-labels";
const ALERT_SRC = "live-alerts";
const ALERT_HALO = "live-alerts-halo";
const ALERT_LABEL = "live-alerts-label";

const MAX_ALERT_MARKERS = 24;

interface StatusState {
  visible: boolean;
  count: number;
  total: number;
  ferries: number;
  updatedAt: number | null;
  error: string | null;
  zoomLow: boolean;
}

function clock(value: number | null): string {
  if (!value) return "--:--";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Compact map-corner status so live vehicles are recognizable while the panel
 * is closed. Informational only, so it never blocks a map gesture.
 */
class LiveStatusControl implements IControl {
  private container?: HTMLDivElement;
  private dot?: HTMLSpanElement;
  private label?: HTMLSpanElement;
  private meta?: HTMLSpanElement;

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    // Readable on demand via aria-label/title; not a live region, otherwise
    // every 45 s poll would announce "updated HH:MM" to screen readers.
    container.setAttribute("role", "img");
    container.style.cssText = [
      "display:none",
      "align-items:center",
      "gap:6px",
      "padding:5px 9px",
      "margin:0 0 8px 0",
      "border-radius:999px",
      "background:var(--glass)",
      "border:1px solid var(--surf-3)",
      "color:var(--ink)",
      "font:11px/1.2 system-ui,sans-serif",
      "letter-spacing:.02em",
      "backdrop-filter:blur(8px)",
      "pointer-events:none",
      "white-space:nowrap",
    ].join(";");

    const dot = document.createElement("span");
    dot.style.cssText =
      "width:6px;height:6px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);flex:none";
    const label = document.createElement("span");
    label.style.cssText = "font-weight:600";
    const meta = document.createElement("span");
    meta.style.cssText =
      "color:var(--ink-mute);font-variant-numeric:tabular-nums";

    container.append(dot, label, meta);
    this.container = container;
    this.dot = dot;
    this.label = label;
    this.meta = meta;
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = undefined;
  }

  update(state: StatusState): void {
    const container = this.container;
    if (!container) return;
    if (!state.visible) {
      container.style.display = "none";
      return;
    }
    container.style.display = "inline-flex";
    const dot = this.dot;
    const label = this.label;
    const meta = this.meta;
    if (!dot || !label || !meta) return;

    if (state.error) {
      dot.style.background = "var(--warn)";
      dot.style.boxShadow =
        "0 0 0 3px color-mix(in srgb, var(--warn) 18%, transparent)";
      label.textContent = "LIVE";
      meta.textContent = "unavailable";
      container.setAttribute(
        "aria-label",
        `Live vehicles unavailable: ${state.error}`,
      );
      container.title = state.error;
      return;
    }

    dot.style.background = "var(--accent)";
    dot.style.boxShadow = "0 0 0 3px var(--accent-soft)";
    label.textContent = "LIVE";
    if (state.zoomLow) {
      meta.textContent = `zoom in to ${LIVE_MIN_ZOOM}+`;
      container.setAttribute(
        "aria-label",
        `Live vehicles are on. Zoom in to level ${LIVE_MIN_ZOOM} to load them.`,
      );
      container.title = `Zoom in to level ${LIVE_MIN_ZOOM} to load live vehicles.`;
      return;
    }
    if (state.count === 0) {
      meta.textContent = "no vehicles in view";
      container.setAttribute(
        "aria-label",
        "Live vehicles are on. No vehicles in view.",
      );
      container.title = "Live vehicles are on. No vehicles in view.";
      return;
    }
    const ferryNote =
      state.ferries > 0
        ? ` · ${state.ferries} ${state.ferries === 1 ? "ferry" : "ferries"}`
        : "";
    meta.textContent = `${state.count}${ferryNote} · ${clock(state.updatedAt)}`;
    container.setAttribute(
      "aria-label",
      `Live vehicles on. ${state.count} of ${state.total} shown in view${ferryNote}. Updated ${clock(state.updatedAt)}.`,
    );
    container.title = `${state.count} of ${state.total} live vehicles in view${ferryNote}. Updated ${clock(state.updatedAt)}.`;
  }
}

function ensureSource(map: MLMap, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(id) as unknown as
    | { setData?: (next: GeoJSON.FeatureCollection) => void }
    | undefined;
  if (source?.setData) {
    source.setData(data);
    return;
  }
  map.addSource(id, { type: "geojson", data });
}

function removeAll(map: MLMap) {
  try {
    for (const id of [ALERT_LABEL, ALERT_HALO, LABELS, FERRY, DOTS, HALO]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [SRC, ALERT_SRC]) {
      if (map.getSource(id)) map.removeSource(id);
    }
  } catch {
    // Map teardown can invalidate the style between the checks.
  }
}

function features(
  vehicles: LiveVehicle[],
  alertLines: readonly string[],
): GeoJSON.FeatureCollection {
  const alerts = new Set(alertLines.map((line) => lineKey(line)));
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
        modeRaw: vehicle.mode,
        group: vehicle.modeGroup,
        color: vehicle.color,
        textColor: vehicle.textColor,
        delay: vehicle.delayMin,
        realTime: vehicle.realTime,
        source: vehicle.source,
        phase: vehicle.phase,
        alert: alerts.has(lineKey(vehicle.line)),
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

function alertFeatures(alerts: TransitAlert[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: alerts
      .filter((alert) => alert.stops.length > 0)
      .slice(0, MAX_ALERT_MARKERS)
      .map((alert) => {
        const stop = alert.stops[0];
        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [stop.lon, stop.lat] as [number, number],
          },
          properties: {
            id: alert.id,
            header: alert.header,
            description: alert.description ?? "",
            severity: alert.severity,
            lines: alert.lines.join(", "),
            stops: alert.stops.map((entry) => entry.name).join(" · "),
            period: formatAlertPeriod(alert),
            url: alert.url ?? "",
          },
        };
      }),
  };
}

function addLayers(
  map: MLMap,
  data: GeoJSON.FeatureCollection,
  alerts: GeoJSON.FeatureCollection,
) {
  ensureSource(map, SRC, data);
  ensureSource(map, ALERT_SRC, alerts);

  if (!map.getLayer(ALERT_HALO)) {
    map.addLayer({
      id: ALERT_HALO,
      type: "circle",
      source: ALERT_SRC,
      paint: {
        "circle-radius": 11,
        "circle-color": THEME.warn,
        "circle-opacity": 0.2,
        "circle-blur": 1,
      },
    });
  }
  if (!map.getLayer(ALERT_LABEL)) {
    map.addLayer({
      id: ALERT_LABEL,
      type: "symbol",
      source: ALERT_SRC,
      layout: {
        "text-field": "!",
        "text-size": 12,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": THEME.warn,
        "text-halo-color": THEME.casing,
        "text-halo-width": 2.2,
      },
    });
  }
  if (!map.getLayer(HALO)) {
    map.addLayer({
      id: HALO,
      type: "circle",
      source: SRC,
      filter: ["!=", ["get", "group"], "FERRY"],
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
      filter: ["!=", ["get", "group"], "FERRY"],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          3.2,
          12,
          5.2,
          16,
          7,
        ],
        "circle-color": ["coalesce", ["get", "color"], THEME.info],
        "circle-stroke-color": [
          "case",
          ["get", "alert"],
          THEME.warn,
          THEME.casing,
        ],
        "circle-stroke-width": ["case", ["get", "alert"], 3, 2],
      },
    });
  }
  // Ferries get a double-ring marker so they read differently from buses
  // without inventing an icon or shipping a sprite.
  if (!map.getLayer(FERRY)) {
    map.addLayer({
      id: FERRY,
      type: "circle",
      source: SRC,
      filter: ["==", ["get", "group"], "FERRY"],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          8,
          4,
          12,
          6.4,
          16,
          8.5,
        ],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": ["coalesce", ["get", "color"], THEME.info],
        "circle-stroke-width": 2.4,
        "circle-opacity": 1,
      },
    });
  }
  if (!map.getLayer(LABELS)) {
    map.addLayer({
      id: LABELS,
      type: "symbol",
      source: SRC,
      minzoom: 11,
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

function safeUrl(value: unknown): string | null {
  const url = String(value ?? "").trim();
  return /^https?:\/\//i.test(url) ? url : null;
}

function popupHtml(properties: Record<string, unknown>): string {
  const fromTz = String(properties.fromTz ?? "");
  const toTz = String(properties.toTz ?? "");
  const departure = String(properties.departure ?? "");
  const arrival = String(properties.arrival ?? "");
  const delay = Number(properties.delay ?? 0);
  const live = Boolean(properties.realTime);
  const source = String(properties.source ?? "interpolated");
  const phase = String(properties.phase ?? "moving");
  const alert = Boolean(properties.alert);
  const time = (iso: string, tz: string) =>
    iso ? formatClock(iso, undefined, tz || undefined) : "";
  const positionNote =
    source === "gps"
      ? "GPS position from the operator feed."
      : phase === "dwell"
        ? "At the stop; position interpolated from the timetable."
        : "Position interpolated between stops from the timetable.";
  return `<div style="max-width:240px;font:12px/1.45 system-ui,sans-serif">
    <strong>${escapeHtml(properties.line)}</strong>
    <span style="color:var(--ink-mute)"> · ${escapeHtml(properties.mode)}</span>
    <div style="margin-top:3px">${escapeHtml(properties.from)} → ${escapeHtml(properties.to)}</div>
    <div style="color:var(--ink-mute)">${time(departure, fromTz)} – ${time(arrival, toTz)}</div>
    <div style="margin-top:3px;color:${delay > 0 ? "var(--warn)" : "var(--accent)"}">
      ${live ? "Live" : "Timetable"}${delay > 0 ? ` · +${delay} min` : ""}
    </div>
    ${alert ? `<div style="margin-top:3px;color:var(--warn)">Service alert on this line.</div>` : ""}
    <div style="margin-top:3px;color:var(--ink-mute)">${positionNote}</div>
  </div>`;
}

function alertPopupHtml(properties: Record<string, unknown>): string {
  const severity = String(properties.severity ?? "UNKNOWN_SEVERITY");
  const tone =
    severity === "SEVERE"
      ? "var(--danger)"
      : severity === "WARNING"
        ? "var(--warn)"
        : "var(--ink-mute)";
  const description = String(properties.description ?? "");
  const stops = String(properties.stops ?? "");
  const lines = String(properties.lines ?? "");
  const url = safeUrl(properties.url);
  return `<div style="max-width:270px;font:12px/1.45 system-ui,sans-serif">
    <div style="color:${tone};font-size:10px;letter-spacing:.06em;text-transform:uppercase">
      ${escapeHtml(severity === "UNKNOWN_SEVERITY" ? "Service alert" : severity)}
    </div>
    <strong>${escapeHtml(properties.header)}</strong>
    ${lines ? `<div style="margin-top:2px;color:var(--ink-mute)">${escapeHtml(lines)}</div>` : ""}
    <div style="margin-top:2px;color:var(--ink-mute)">${escapeHtml(properties.period)}</div>
    ${description ? `<div style="margin-top:5px;white-space:pre-line">${escapeHtml(description)}</div>` : ""}
    ${stops ? `<div style="margin-top:5px;color:var(--ink-mute)">Stops: ${escapeHtml(stops)}</div>` : ""}
    ${url ? `<div style="margin-top:5px"><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer noopener" style="color:var(--accent)">More information</a></div>` : ""}
  </div>`;
}

function liveError(err: unknown): string {
  if (isProviderError(err) && err.kind === "rate-limit") {
    return "Live vehicles paused by the transit service. Retrying shortly.";
  }
  return "Live vehicle positions are unavailable right now.";
}

function alertError(err: unknown): string {
  if (isProviderError(err) && err.kind === "rate-limit") {
    return "Disruptions paused by the transit service.";
  }
  return "Disruptions are unavailable right now.";
}

function jitter(ms: number): number {
  return Math.round(ms * (0.9 + Math.random() * 0.2));
}

/**
 * Keep a live-vehicle layer in sync with the current map window.
 *
 * Positions poll every 45 s (jittered) while the tab is visible, back off to
 * 60/90 s for large payloads, and refresh after a settled pan or a style
 * swap. Area alerts piggyback on the vehicle feed and refresh at most every
 * 5 minutes from three rail-first stops.
 */
export function useLiveVehiclesLayer(map: MLMap | null) {
  const enabled = useTransit((s) => s.liveVehicles);
  const groupsKey = useTransit((s) => s.liveVehicleGroups.join(","));
  const alertLinesKey = useTransit((s) => s.liveAlertLines.join("\u0001"));
  const applyRef = useRef<() => void>(() => {});

  // Filter and alert-line changes redraw without refetching.
  useEffect(() => {
    applyRef.current();
  }, [groupsKey, alertLinesKey]);

  useEffect(() => {
    if (!map) return;
    const control = new LiveStatusControl();
    map.addControl(control, "bottom-left");

    if (!enabled) {
      removeAll(map);
      const state = useTransit.getState();
      state.setLiveVehicleStatus(0, null);
      state.setLiveVehiclesError(null);
      state.setLiveVehiclesData([]);
      state.setLiveAlerts([], null);
      control.update({
        visible: false,
        count: 0,
        total: 0,
        ferries: 0,
        updatedAt: null,
        error: null,
        zoomLow: false,
      });
      return () => {
        try {
          map.removeControl(control);
        } catch {
          // Map already torn down.
        }
      };
    }

    let alive = true;
    let inFlight = false;
    let timer: number | undefined;
    let moveTimer: number | undefined;
    let lastFetchAt = 0;
    let lastPayloadBytes = 0;
    let alertGate: AlertGate = resetAlertGate();
    let alertsInFlight = false;
    let controller: AbortController | null = null;
    let alertController: AbortController | null = null;
    let current: LiveVehicle[] = [];

    const status = (options?: { zoomLow?: boolean }) => {
      const state = useTransit.getState();
      const shown = filterLiveVehicles(current, state.liveVehicleGroups);
      return {
        visible: true,
        count: shown.length,
        // F6/N2: the cap only limits rendering; the pill must report the
        // same unfiltered total as the panel.
        total: state.liveVehicleCount,
        ferries: shown.filter((vehicle) => vehicle.modeGroup === "FERRY").length,
        updatedAt: state.liveVehiclesUpdatedAt,
        error: state.liveVehiclesError,
        zoomLow: options?.zoomLow ?? state.liveVehiclesZoomLow,
      };
    };

    const apply = () => {
      if (!alive) return;
      const state = useTransit.getState();
      control.update(status());
      const shown = filterLiveVehicles(current, state.liveVehicleGroups);
      try {
        addLayers(
          map,
          features(shown, state.liveAlertLines),
          alertFeatures(state.liveAlerts),
        );
      } catch {
        // A basemap style swap can remove the source mid-add; the
        // style.load handler rebuilds it.
      }
    };
    applyRef.current = apply;

    const setStatus = (count: number, at: number | null, zoomLow = false) => {
      useTransit.getState().setLiveVehicleStatus(count, at, { zoomLow });
    };

    const loadAlerts = async (vehicles: LiveVehicle[]) => {
      if (!alive || alertsInFlight) return;
      const center = map.getCenter();
      const bounds = map.getBounds();
      const stops = alertStopCandidates(vehicles, {
        south: bounds.getSouth(),
        west: bounds.getWest(),
        north: bounds.getNorth(),
        east: bounds.getEast(),
      });
      const action = alertGateAction(alertGate, {
        stopCount: stops.length,
        center: { lat: center.lat, lon: center.lng },
        now: Date.now(),
      });
      if (action === "skip") return;
      // F2: leaving the sampled area must remove its markers, not keep the
      // previous city's alerts on a now-empty view.
      if (action === "clear") {
        alertGate = resetAlertGate();
        const state = useTransit.getState();
        if (
          state.liveAlerts.length > 0
          || state.liveAlertsUpdatedAt !== null
          || state.liveAlertsError !== null
        ) {
          // setLiveAlerts also clears liveAlertsError, so a stale error does
          // not survive on an empty view (N4).
          state.setLiveAlerts([], null);
          apply();
        }
        return;
      }
      alertsInFlight = true;
      alertController = new AbortController();
      try {
        const alerts = await fetchAreaAlerts({
          stops,
          signal: alertController.signal,
        });
        if (!alive) return;
        useTransit.getState().setLiveAlerts(alerts, Date.now());
        apply();
      } catch (err) {
        if (!alive || isAbortError(err)) return;
        useTransit.getState().setLiveAlertsError(alertError(err));
      } finally {
        alertsInFlight = false;
        alertController = null;
        alertGate = commitAlertGate(
          { lat: center.lat, lon: center.lng },
          Date.now(),
        );
      }
    };

    const load = async (): Promise<number> => {
      if (!alive || inFlight) return jitter(LIVE_POLL_MS);
      if (
        typeof document !== "undefined"
        && document.visibilityState !== "visible"
      ) {
        return jitter(LIVE_POLL_MS);
      }
      const zoom = map.getZoom();
      if (zoom < LIVE_MIN_ZOOM) {
        current = [];
        setStatus(0, Date.now(), true);
        useTransit.getState().setLiveVehiclesError(null);
        useTransit.getState().setLiveVehiclesData([]);
        useTransit.getState().setLiveAlerts([], null);
        // F3: a quick zoom-out/in must load alerts again immediately instead
        // of waiting out the 5-minute gate.
        alertGate = resetAlertGate();
        apply();
        return jitter(LIVE_POLL_MS);
      }

      const bounds = map.getBounds();
      lastFetchAt = Date.now();
      inFlight = true;
      controller = new AbortController();
      try {
        const { vehicles, bytes } = await fetchLiveVehiclesChunked({
          south: bounds.getSouth(),
          west: bounds.getWest(),
          north: bounds.getNorth(),
          east: bounds.getEast(),
          zoom,
          signal: controller.signal,
        });
        if (!alive) return jitter(LIVE_POLL_MS);
        lastPayloadBytes = bytes;
        // F6: keep the most relevant vehicles when the cap bites, but report
        // the true total instead of pretending the cut list is everything.
        const center = map.getCenter();
        const distance = (vehicle: LiveVehicle) =>
          (vehicle.lon - center.lng) ** 2
          + (vehicle.lat - center.lat) ** 2;
        current = [...vehicles]
          .sort((a, b) => distance(a) - distance(b))
          .slice(0, MAX_LIVE_VEHICLES);
        useTransit.getState().setLiveVehiclesData(current);
        setStatus(vehicles.length, Date.now());
        useTransit.getState().setLiveVehiclesError(null);
        apply();
        void loadAlerts(current);
        return jitter(pollDelayForPayload(lastPayloadBytes));
      } catch (err) {
        if (!alive || isAbortError(err)) return jitter(LIVE_POLL_MS);
        current = [];
        useTransit.getState().setLiveVehiclesData([]);
        setStatus(0, null);
        useTransit.getState().setLiveVehiclesError(liveError(err));
        apply();
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
      new Popup({ className: "hud-popup", offset: 12, closeButton: true })
        .setLngLat(
          (feature.geometry as GeoJSON.Point).coordinates as [number, number],
        )
        .setHTML(popupHtml(feature.properties ?? {}))
        .addTo(map);
    };
    const openAlertPopup = (feature: MapGeoJSONFeature) => {
      new Popup({ className: "hud-popup", offset: 14, closeButton: true })
        .setLngLat(
          (feature.geometry as GeoJSON.Point).coordinates as [number, number],
        )
        .setHTML(alertPopupHtml(feature.properties ?? {}))
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
    // card from opening on top of the popup.
    const unregisterTaps = registerFeatureTaps(map, {
      id: "live-vehicles",
      layers: [DOTS, FERRY, HALO],
      tolerancePx: 18,
      onFeature: openVehiclePopup,
    });
    const unregisterAlertTaps = registerFeatureTaps(map, {
      id: "live-alerts",
      layers: [ALERT_HALO, ALERT_LABEL],
      tolerancePx: 18,
      onFeature: openAlertPopup,
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
    map.on("mouseenter", FERRY, onEnter);
    map.on("mouseleave", DOTS, onLeave);
    map.on("mouseleave", FERRY, onLeave);

    return () => {
      alive = false;
      applyRef.current = () => {};
      unregisterTaps();
      unregisterAlertTaps();
      controller?.abort();
      alertController?.abort();
      if (timer) window.clearTimeout(timer);
      if (moveTimer) window.clearTimeout(moveTimer);
      map.off("style.load", onStyle);
      map.off("moveend", onMove);
      map.off("mouseenter", DOTS, onEnter);
      map.off("mouseenter", FERRY, onEnter);
      map.off("mouseleave", DOTS, onLeave);
      map.off("mouseleave", FERRY, onLeave);
      try {
        map.removeControl(control);
      } catch {
        // Map already torn down.
      }
      removeAll(map);
      const state = useTransit.getState();
      state.setLiveVehicleStatus(0, null);
      state.setLiveVehiclesData([]);
      state.setLiveAlerts([], null);
    };
  }, [enabled, map]);
}
