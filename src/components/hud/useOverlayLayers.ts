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
import { useEffect, useMemo } from "react";
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

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      reconcileOverlays(map, activeEntries);
    };
    if (map.isStyleLoaded()) apply();
    map.on("style.load", apply);
    // The initial `style.load` can fire before this effect registers.
    map.once("idle", apply);
    return () => {
      cancelled = true;
      map.off("style.load", apply);
      map.off("idle", apply);
    };
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

  useEffect(() => {
    if (!map) return;
    const cleanups = interactive.map(({ definition, resolved }) => {
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
  }, [map, interactive]);
}
