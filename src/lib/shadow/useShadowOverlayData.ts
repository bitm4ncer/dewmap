"use client";

/**
 * Wires the shadow layer into the map: viewport tracking, tile loading,
 * worker dispatch and the overlay store.
 *
 * Mounted once by the map shell. Everything it does is gated on the overlay
 * toggle, so an off layer costs one map listener and nothing else.
 *
 * Runs are snapshot-based: a new viewport or slider position aborts the
 * loader, terminates the worker and starts over. The previous mask stays on
 * the map until the new one arrives, so dragging the slider does not flicker.
 */
import { useEffect, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { useOverlays } from "@/lib/overlays/store";
import { createPmtilesBuildingSource, loadBuildingsForBbox } from "./buildings";
import { shadowErrorOutcome } from "./errors";
import { PILOT_SOURCE_IDS, PILOT_TILES_URL } from "./pilot";
import {
  SHADOW_OVERLAY_ID,
  setShadowOverlayImage,
  setShadowOverlaySources,
} from "./overlay";
import { msUntilNextNowBucket, shouldRefreshNow } from "./now";
import { serializeBuildings } from "./render";
import { shadowTimeFor, useShadowRuntime, useShadowSettings } from "./state";
import type { Bbox } from "./types";
import { planShadowWindow } from "./window";
import { ShadowWorkerClient } from "./workerClient";

const TILE_ZOOM_OFFSET = 1;
const RUN_DEBOUNCE_MS = 120;

/** Tile zoom read from the archive: one level finer than the map, 14–16. */
export function tileZoomFor(zoom: number): number {
  return Math.min(16, Math.max(14, Math.round(zoom) + TILE_ZOOM_OFFSET));
}

function viewportKey(zoom: number, bbox: Bbox): string {
  return `${zoom.toFixed(2)}|${bbox.map((value) => value.toFixed(5)).join(",")}`;
}

/** Empty reasons map to their own copy; a generic "no buildings" hides bugs. */
function emptyMessage(reason: "no-buildings" | "night" | "too-large"): string {
  if (reason === "night") return "Sun below the horizon — no cast shadows.";
  if (reason === "too-large") return "This window is too large to render — zoom in.";
  return "No buildings in this view.";
}

export function useShadowOverlayData(map: MLMap | null): void {
  const enabled = useOverlays((state) => state.enabled[SHADOW_OVERLAY_ID] ?? false);
  const offsetMinutes = useShadowSettings((state) => state.offsetMinutes);

  const clientRef = useRef<ShadowWorkerClient | null>(null);
  const cacheRef = useRef(new Map());
  const viewportRef = useRef<string>("");
  const lastRunAtRef = useRef(0);
  /** Bumped by the "now" timer and by focus/visibility, never by a render loop. */
  const [nowTick, setNowTick] = useState(0);

  // The viewport lives in the runtime store (the panel needs zoom + phase).
  useEffect(() => {
    if (!map) return;
    let disposed = false;
    const update = () => {
      if (disposed) return;
      const bounds = map.getBounds();
      const bbox: Bbox = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ];
      const zoom = map.getZoom();
      const key = viewportKey(zoom, bbox);
      // A pan fires moveend with a new bbox; a resize fires with the same one.
      if (key === viewportRef.current) return;
      viewportRef.current = key;
      useShadowRuntime.getState().setViewport(zoom, bbox);
    };
    update();
    for (const event of ["load", "moveend", "zoomend"] as const) map.on(event, update);
    return () => {
      disposed = true;
      for (const event of ["load", "moveend", "zoomend"] as const) map.off(event, update);
    };
  }, [map]);

  const viewport = useShadowRuntime((state) => state.bbox);
  const zoom = useShadowRuntime((state) => state.zoom);

  // "Now" mode follows the clock: recompute on the next 5-minute boundary while
  // the page is visible, and on returning to the tab (at most once a minute).
  // A slider offset is a deliberate point in time and never refreshes.
  useEffect(() => {
    if (!enabled || offsetMinutes !== 0) return;
    const visible = () =>
      typeof document === "undefined" || document.visibilityState === "visible";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timer = setTimeout(() => {
        if (visible()) setNowTick((tick) => tick + 1);
        schedule();
      }, msUntilNextNowBucket());
    };
    const onWake = () => {
      if (
        shouldRefreshNow({
          enabled,
          offsetMinutes,
          visible: visible(),
          msSinceRender: Date.now() - lastRunAtRef.current,
        })
      ) {
        setNowTick((tick) => tick + 1);
      }
    };
    schedule();
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [enabled, offsetMinutes]);

  useEffect(() => {
    if (!clientRef.current) clientRef.current = new ShadowWorkerClient();
    const client = clientRef.current;

    if (!enabled) {
      client.cancel();
      setShadowOverlayImage(null);
      useShadowRuntime.getState().off();
      return;
    }
    if (!map || !viewport) return;

    const plan = planShadowWindow(viewport, zoom);
    if (plan.kind === "zoomed-out") {
      client.cancel();
      setShadowOverlayImage(null);
      useShadowRuntime.getState().zoomedOut("Zoom in to 14");
      return;
    }
    if (plan.kind === "outside" || !plan.bbox) {
      client.cancel();
      setShadowOverlayImage(null);
      useShadowRuntime
        .getState()
        .outside("Outside the Düsseldorf pilot — no building heights here yet.");
      return;
    }

    const runtime = useShadowRuntime.getState();
    // First run after switching on has no mask to preserve, so it starts
    // immediately; a slider drag is debounced and keeps the old mask.
    const hasMask = runtime.phase === "ready" || runtime.phase === "loading";
    runtime.begin(hasMask ? "Updating shadows…" : "Rendering shadows…");

    const controller = new AbortController();
    let cancelled = false;
    const time = shadowTimeFor(offsetMinutes);
    lastRunAtRef.current = Date.now();
    const bbox = plan.bbox;
    const resolutionM = plan.resolutionM;

    const run = async () => {
      try {
        const loaded = await loadBuildingsForBbox(bbox, {
          source: createPmtilesBuildingSource(PILOT_TILES_URL),
          zoom: tileZoomFor(zoom),
          cache: cacheRef.current,
          signal: controller.signal,
        });
        if (cancelled) return;
        if (loaded.buildings.length === 0) {
          setShadowOverlayImage(null);
          useShadowRuntime
            .getState()
            .empty("empty", "No buildings in this view.", null);
          return;
        }
        if (cancelled) return;
        const response = await client.run({
          bbox,
          timeMs: time.getTime(),
          resolutionM,
          buildings: serializeBuildings(loaded.buildings),
        });
        if (cancelled) return;

        if (response.type === "result") {
          setShadowOverlayImage({ url: response.pngUrl, bbox: response.bbox });
          useShadowRuntime.getState().ready({
            sun: response.sun,
            stats: {
              buildings: response.stats.buildingCount,
              shadowFraction: response.stats.shadowFraction,
              computeMs: response.stats.computeMs,
              encodeMs: response.stats.encodeMs,
              resolutionM: response.resolutionM,
              width: response.width,
              height: response.height,
              tiles: loaded.tiles.length - loaded.cacheHits,
              tileBytes: loaded.bytes,
              cacheHits: loaded.cacheHits,
              partial: plan.partial,
            },
          });
        } else if (response.type === "empty") {
          setShadowOverlayImage(null);
          useShadowRuntime
            .getState()
            .empty(
              response.reason === "night" ? "night" : "empty",
              emptyMessage(response.reason),
              response.sun,
            );
        } else {
          useShadowRuntime.getState().fail(
            response.code === "no-canvas"
              ? "This browser cannot encode the shadow image."
              : `Shadow render failed: ${response.message}`,
          );
        }
      } catch (error) {
        if (cancelled) return;
        const outcome = shadowErrorOutcome(error);
        // A timeout is not an abort: say so and keep the last mask on screen
        // as a stale-but-honest state.
        if (outcome.ignore) return;
        useShadowRuntime.getState().fail(outcome.message ?? "Shadow render failed.");
      }
    };

    const timer = setTimeout(() => {
      void run();
    }, hasMask ? RUN_DEBOUNCE_MS : 0);

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
      client.cancel();
    };
  }, [enabled, map, viewport, zoom, offsetMinutes, nowTick]);

  // One-time: attribution follows the data source actually in use.
  useEffect(() => {
    setShadowOverlaySources(PILOT_SOURCE_IDS);
  }, []);

  useEffect(() => {
    return () => {
      clientRef.current?.terminate();
      clientRef.current = null;
    };
  }, []);
}
