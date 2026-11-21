/**
 * One-time migration of data written under the old BiosphereOne and
 * KugelMaps brands.
 *
 * Runs before any Zustand store is created, copies (never deletes) the
 * legacy values, and is a no-op when the new key already exists. KugelMaps
 * is the newer brand, so its values win over older BiosphereOne values.
 * Users keep their basemap, saved routes, favourites, settings and POI
 * caches across the rebrand.
 */
const LEGACY_KEYS: ReadonlyArray<readonly [legacy: string, next: string]> = [
  // KugelMaps (2026-11-18 → 2026-11-21), newest first.
  ["kugelmaps:settings", "dewmap:settings"],
  ["kugelmaps:car", "dewmap:car"],
  ["kugelmaps:transit", "dewmap:transit"],
  ["kugelmaps:hiking", "dewmap:hiking"],
  ["kugelmaps.routesMode", "dewmap.routesMode"],
  ["kugelmaps.geo.autoTrack", "dewmap.geo.autoTrack"],
  ["kugelmaps.saved-places", "dewmap.saved-places"],
  ["kugelmaps.poi-view.v2", "dewmap.poi-view.v2"],
  // BiosphereOne, the oldest brand.
  ["biosphere1:settings", "dewmap:settings"],
  ["biosphere1:car", "dewmap:car"],
  ["biosphere1:transit", "dewmap:transit"],
  ["biosphere1:hiking", "dewmap:hiking"],
  ["biosphere.routesMode", "dewmap.routesMode"],
  ["biosphere.geo.autoTrack", "dewmap.geo.autoTrack"],
  ["biosphere.poi-view.v2", "dewmap.poi-view.v2"],
];

/**
 * Per-place caches: the POI detail cache and its cluster view. Newest
 * brand first so a KugelMaps cache is preferred over an older one.
 */
const LEGACY_PREFIXES: ReadonlyArray<
  readonly [legacy: string, next: string]
> = [
  ["kugelmaps.poi.v2.", "dewmap.poi.v2."],
  ["biosphere.poi.v2.", "dewmap.poi.v2."],
  ["kugelmaps.poi.v1.", "dewmap.poi.v1."],
  ["biosphere.poi.v1.", "dewmap.poi.v1."],
];

let done = false;

function copyIfAbsent(storage: Storage, legacy: string, next: string) {
  const value = storage.getItem(legacy);
  if (value !== null && storage.getItem(next) === null) {
    storage.setItem(next, value);
  }
}

export function migrateLegacyStorage() {
  if (done || typeof window === "undefined") return;
  done = true;

  try {
    const storage = window.localStorage;

    for (const [legacy, next] of LEGACY_KEYS) {
      copyIfAbsent(storage, legacy, next);
    }

    // Snapshot the keys first: copying adds new keys while we iterate.
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key) keys.push(key);
    }
    for (const [legacyPrefix, nextPrefix] of LEGACY_PREFIXES) {
      for (const key of keys) {
        if (!key.startsWith(legacyPrefix)) continue;
        copyIfAbsent(
          storage,
          key,
          nextPrefix + key.slice(legacyPrefix.length),
        );
      }
    }
  } catch {
    // Private mode or disabled storage: keep the app usable.
  }
}
