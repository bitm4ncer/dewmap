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
import { registerShadowOverlay } from "@/lib/shadow/register";
import { useShadowOverlayVersion } from "@/lib/shadow/useShadowOverlay";
import { useOverlays, warningAreasOf } from "@/lib/overlays/store";

registerWeatherOverlays();
registerShadowOverlay();

export function useOverlayLayers(map: MLMap | null): void {
  const enabled = useOverlays((s) => s.enabled);
  const opacity = useOverlays((s) => s.opacity);
  const radarFrames = useOverlays((s) => s.radarFrames);
  const radarIndex = useOverlays((s) => s.radarIndex);
  const warnings = useOverlays((s) => s.warnings);
  // A worker result changes none of the store fields above; this counter is
  // the rerender trigger for the shadow layer (see src/lib/shadow/overlay.ts).
  const shadowVersion = useShadowOverlayVersion();

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
    // `shadowVersion` is not read above on purpose: it is the external-store
    // trigger that re-resolves the shadow layer when a worker result lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, opacity, radarFrames, radarIndex, warnings, shadowVersion]);

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
