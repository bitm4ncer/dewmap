"use client";

/**
 * React binding for the shadow overlay store.
 *
 * `useOverlayLayers` (parallel branch) memoises the resolved overlays on
 * `[enabled, opacity, radarFrames, radarIndex, warnings]`. A worker result
 * changes none of those, so the map would keep the old polygons. Adding
 * `useShadowOverlayVersion()` to that dependency list is the whole fix:
 *
 *   const shadowVersion = useShadowOverlayVersion();
 *   // ...later, in the existing useMemo:
 *   }, [enabled, opacity, radarFrames, radarIndex, warnings, shadowVersion]);
 *
 * The hook is a `useSyncExternalStore` binding, not a custom cache, so it
 * works with concurrent rendering and server snapshots.
 */
import { useSyncExternalStore } from "react";
import { getShadowVersion, subscribeShadowData } from "./overlay";

export function useShadowOverlayVersion(): number {
  return useSyncExternalStore(subscribeShadowData, getShadowVersion, getShadowVersion);
}
