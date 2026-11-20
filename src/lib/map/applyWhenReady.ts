/** The slice of the MapLibre map this helper needs. */
export interface MapLike {
  isStyleLoaded(): boolean;
  /** Mirrors MapLibre's `Listener`: it passes the event object. */
  once(event: string, listener: (...args: never[]) => void): unknown;
  off(event: string, listener: (...args: never[]) => void): unknown;
}

/**
 * Runs `apply` now and, while tiles are still streaming, once more when the
 * map goes idle.
 *
 * `isStyleLoaded()` turns false as soon as a source has tiles in flight, and
 * `"load"` only ever fires once per map — gating the first apply on either
 * leaves stale layers on the map after a mode switch. The idle retry is the
 * event that actually repeats.
 */
/**
 * MapLibre's `once`/`off` are an overload set, which a minimal structural type
 * cannot match. One documented cast keeps every call site readable.
 */
export function asMapLike(map: unknown): MapLike {
  return map as MapLike;
}

export function applyWhenReady(map: MapLike, apply: () => void): () => void {
  const run = () => {
    try {
      apply();
    } catch {
      // A style swap can remove a source between the check and addLayer.
    }
  };

  run();
  if (map.isStyleLoaded()) return () => {};

  const retry = () => run();
  map.once("idle", retry);
  return () => map.off("idle", retry);
}
