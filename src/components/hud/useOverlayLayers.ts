"use client";

/**
 * Keeps the registered overlays in sync with the map.
 *
 * This is the only React glue between the registry and MapLibre: it resolves
 * every enabled overlay against the current store state, hands the result to
 * `reconcileOverlays`, and re-runs that on `style.load` / `idle` so a basemap
 * swap never leaves a layer behind. Tap handling for overlays that define a
 * `popup` goes through the shared feature-tap pipeline.
 */
import { useEffect, useMemo, useRef } from "react";
import { Popup, type Map as MLMap, type MapGeoJSONFeature } from "maplibre-gl";
import { registerFeatureTaps } from "@/lib/map/featureTaps";
import { listOverlays } from "@/lib/overlays";
import {
  overlayLayerIds,
  reconcileOverlays,
  type ActiveOverlay,
} from "@/lib/overlays/apply";
import { registerWeatherOverlays } from "@/lib/overlays/definitions";
import { useOverlays, warningAreasOf } from "@/lib/overlays/store";

registerWeatherOverlays();

export function useOverlayLayers(map: MLMap | null): void {
  const enabled = useOverlays((s) => s.enabled);
  const opacity = useOverlays((s) => s.opacity);
  const radarFrames = useOverlays((s) => s.radarFrames);
  const radarIndex = useOverlays((s) => s.radarIndex);
  const warnings = useOverlays((s) => s.warnings);

  // Resolve the *enabled* set. This is the only dependency of the reconcile
  // effect: any state that changes a layer (frame, opacity, geometry) changes
  // an entry, so one effect covers the whole lifecycle.
  const activeEntries = useMemo<ActiveOverlay[]>(() => {
    const areas = warningAreasOf(warnings);
    return listOverlays()
      .filter((definition) => enabled[definition.id] === true)
      .map((definition) => ({
        definition,
        resolved: definition.resolve({
          opacity: opacity[definition.id] ?? definition.opacity,
          radar: radarFrames
            ? {
                frames: radarFrames.frames,
                index: radarIndex,
                image: radarFrames.image,
              }
            : null,
          warnings: areas,
        }),
      }));
  }, [enabled, opacity, radarFrames, radarIndex, warnings]);

  // The latest entries, without making the map listeners depend on them: a
  // radar frame changes `activeEntries` every 650 ms, and re-registering an
  // `once("idle")` listener on every frame left a growing pile of closures.
  const entriesRef = useRef(activeEntries);
  useEffect(() => {
    entriesRef.current = activeEntries;
  }, [activeEntries]);

  // Map lifecycle listeners: registered once per map instance.
  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      reconcileOverlays(map, entriesRef.current);
    };
    const onIdle = () => {
      map.off("idle", onIdle);
      apply();
    };
    if (map.isStyleLoaded()) apply();
    else map.on("idle", onIdle);
    map.on("style.load", apply);
    return () => {
      cancelled = true;
      map.off("style.load", apply);
      map.off("idle", onIdle);
    };
  }, [map]);

  // State changes: reconcile directly, no listener bookkeeping.
  useEffect(() => {
    if (!map) return;
    reconcileOverlays(map, activeEntries);
  }, [map, activeEntries]);

  // A closing tab must not leave sources behind for the next style load.
  useEffect(() => {
    if (!map) return;
    return () => {
      reconcileOverlays(map, []);
    };
  }, [map]);

  const interactive = useMemo(
    () => activeEntries.filter((entry) => Boolean(entry.definition.popup)),
    [activeEntries],
  );

  // `interactive` gets a new identity on every radar frame, but the tap groups
  // only depend on which overlays are on and how many layers they occupy.
  // Without this key the groups would be un- and re-registered every 650 ms
  // during playback.
  const tapKey = interactive
    .map((entry) => `${entry.definition.id}:${entry.resolved?.layers.length ?? 0}`)
    .join("|");
  const interactiveRef = useRef(interactive);
  useEffect(() => {
    interactiveRef.current = interactive;
  }, [interactive]);

  useEffect(() => {
    if (!map) return;
    const cleanups = interactiveRef.current.map(({ definition, resolved }) => {
      const layers = overlayLayerIds(definition.id, resolved?.layers.length ?? 0);
      return registerFeatureTaps(map, {
        id: `overlay-${definition.id}`,
        layers,
        tolerancePx: 14,
        hapticKind: "tap",
        onFeature: (feature: MapGeoJSONFeature, event) => {
          const popup = definition.popup;
          if (!popup) return;
          new Popup({ className: "hud-popup", offset: 10, closeButton: true })
            .setLngLat(event.lngLat)
            .setHTML(popup((feature.properties ?? {}) as Record<string, unknown>))
            .addTo(map);
        },
      });
    });
    return () => {
      for (const cleanup of cleanups) cleanup();
    };
  }, [map, tapKey]);
}
