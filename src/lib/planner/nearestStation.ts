import { geocodeStops } from "@/lib/routing/providers/motis";
import { haversineM } from "@/lib/routing/geo";

export interface NearestStation {
  name: string;
  lat: number;
  lon: number;
  city?: string;
  distanceM: number;
}

const cache = new Map<string, { at: number; value: NearestStation | null }>();
const inFlight = new Map<string, Promise<NearestStation | null>>();
const TTL_MS = 5 * 60 * 1000;

function pickNearest(
  stops: { name: string; lat: number; lon: number; city?: string }[],
  lat: number,
  lon: number,
): NearestStation | null {
  let best: NearestStation | null = null;
  for (const stop of stops) {
    const distanceM = haversineM([lon, lat], [stop.lon, stop.lat]);
    if (
      best == null ||
      distanceM < best.distanceM
    ) {
      best = {
        name: stop.name,
        lat: stop.lat,
        lon: stop.lon,
        ...(stop.city ? { city: stop.city } : {}),
        distanceM,
      };
    }
  }
  return best;
}

/**
 * Find a nearby transit stop for a geocoded address.
 *
 * MOTIS already exposes a CORS-enabled stop index, so we ask it for stops
 * matching the address/city and pick the closest candidate by distance.
 * This avoids a second provider (Overpass) and stays within the same
 * transit data source that powers routing. The result is best-effort: if
 * the stop index is incomplete, the caller routes from the address anyway.
 */
export async function findNearestStation(
  lat: number,
  lon: number,
  addressName?: string,
  city?: string,
): Promise<NearestStation | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${(city ?? "").toLowerCase()}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const queries: string[] = [];
      if (addressName) queries.push(`${addressName} ${city ?? ""}`.trim());
      if (city) queries.push(city);
      const seen = new Set<string>();
      const candidates: {
        name: string;
        lat: number;
        lon: number;
        city?: string;
      }[] = [];
      for (const query of queries) {
        const stops = await geocodeStops(query, undefined, 40);
        for (const stop of stops) {
          const id = `${stop.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          candidates.push({
            name: stop.name,
            lat: stop.lat,
            lon: stop.lon,
            ...(stop.city ? { city: stop.city } : {}),
          });
        }
        const nearest = pickNearest(candidates, lat, lon);
        if (nearest && nearest.distanceM <= 8000) {
          if (cache.size > 100) cache.clear();
          cache.set(key, { at: Date.now(), value: nearest });
          return nearest;
        }
      }
      const value = pickNearest(candidates, lat, lon);
      const bounded = value && value.distanceM <= 15_000 ? value : null;
      if (cache.size > 100) cache.clear();
      cache.set(key, { at: Date.now(), value: bounded });
      return bounded;
    } catch (err) {
      console.warn("[nearest-station]", err);
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
