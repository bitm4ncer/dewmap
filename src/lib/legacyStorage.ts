/**
 * One-time migration of data written under the old BiosphereOne brand.
 *
 * Runs before any Zustand store is created, copies (never deletes) the
 * legacy values, and is a no-op when the new key already exists. Users keep
 * their basemap, saved routes, favourites and settings across the rebrand.
 */
const LEGACY_KEYS: Record<string, string> = {
  "biosphere1:settings": "kugelmaps:settings",
  "biosphere1:car": "kugelmaps:car",
  "biosphere1:transit": "kugelmaps:transit",
  "biosphere1:hiking": "kugelmaps:hiking",
  "biosphere.routesMode": "kugelmaps.routesMode",
  "biosphere.geo.autoTrack": "kugelmaps.geo.autoTrack",
};

let done = false;

export function migrateLegacyStorage() {
  if (done || typeof window === "undefined") return;
  done = true;

  try {
    const storage = window.localStorage;

    for (const [legacy, next] of Object.entries(LEGACY_KEYS)) {
      const value = storage.getItem(legacy);
      if (value !== null && storage.getItem(next) === null) {
        storage.setItem(next, value);
      }
    }

    // The POI cache is keyed per place, so copy every legacy entry.
    const legacyPrefix = "biosphere.poi.v1.";
    const nextPrefix = "kugelmaps.poi.v1.";
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(legacyPrefix)) keys.push(key);
    }
    for (const key of keys) {
      const value = storage.getItem(key);
      const next = nextPrefix + key.slice(legacyPrefix.length);
      if (value !== null && storage.getItem(next) === null) {
        storage.setItem(next, value);
      }
    }
  } catch {
    // Private mode or disabled storage: keep the app usable.
  }
}
