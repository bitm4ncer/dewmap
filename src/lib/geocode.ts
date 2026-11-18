export interface GeocodeResult {
  id: string;
  name: string;
  label: string;
  coordinates: [number, number];
  extent?: [number, number, number, number];
  type?: string;
  category?: string;
  city?: string;
  country?: string;
  postcode?: string;
  osmType?: "N" | "W" | "R";
  osmId?: number;
}

const PHOTON_URL = "https://photon.komoot.io/api/";

function distanceKm(a: [number, number], b: [number, number]): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Nearby results win over far string matches. Each API rank is worth
 * 20 km and the first 50 km are free, so a local supermarket outranks a
 * same-named village abroad without hiding a strong far city match.
 */
export function rankByProximity<T extends { coordinates: [number, number] }>(
  results: T[],
  nearby?: [number, number],
): T[] {
  if (!nearby || !Number.isFinite(nearby[0]) || !Number.isFinite(nearby[1])) {
    return results;
  }
  return results
    .map((result, rank) => ({
      result,
      score:
        rank * 20
        + Math.max(0, distanceKm(nearby, result.coordinates) - 50),
    }))
    .sort((a, b) => a.score - b.score)
    .map((entry) => entry.result);
}

interface PhotonFeature {
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    osm_id?: number;
    osm_type?: string;
    osm_key?: string;
    osm_value?: string;
    type?: string;
    name?: string;
    country?: string;
    state?: string;
    city?: string;
    postcode?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    extent?: [number, number, number, number];
  };
}

function buildLabel(p: PhotonFeature["properties"]): string {
  const parts: string[] = [];
  if (p.name) parts.push(p.name);
  if (p.housenumber && p.street && !p.name?.includes(p.street)) {
    parts.push(`${p.street} ${p.housenumber}`);
  } else if (p.street && !p.name?.includes(p.street)) {
    parts.push(p.street);
  }
  const place = p.city ?? p.district ?? p.state;
  if (place && !parts.includes(place)) parts.push(place);
  if (p.country && p.country !== place) parts.push(p.country);
  return parts.filter(Boolean).join(", ");
}

export function reverseAddressName(
  p: PhotonFeature["properties"],
): string {
  const street = p.street
    ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}`
    : "";
  // The caller adds the city separately (e.g. "Street 5 · City").
  return street || p.name || buildLabel(p);
}

const PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse";

/** Resolve coordinates to the nearest street address (Photon). */
export async function reverseGeocode(
  lon: number,
  lat: number,
  options: { signal?: AbortSignal; lang?: string } = {},
): Promise<GeocodeResult | null> {
  const params = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    limit: "1",
  });
  if (options.lang) params.set("lang", options.lang);
  try {
    const res = await fetch(`${PHOTON_REVERSE_URL}?${params}`, {
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { features: PhotonFeature[] };
    const f = data.features?.[0];
    if (!f) return null;
    const p = f.properties;
    const coordinates = f.geometry.coordinates;
    const osmType = p.osm_type?.toUpperCase();
    return {
      id: `${p.osm_type ?? "?"}-${p.osm_id ?? "reverse"}`,
      name: reverseAddressName(p),
      label: buildLabel(p) || reverseAddressName(p),
      coordinates,
      type: p.type,
      category: p.osm_value ?? p.osm_key,
      city: p.city ?? p.district,
      country: p.country,
      postcode: p.postcode,
      ...(osmType === "N" || osmType === "W" || osmType === "R"
        ? { osmType }
        : {}),
      ...(typeof p.osm_id === "number" ? { osmId: p.osm_id } : {}),
    } satisfies GeocodeResult;
  } catch {
    return null;
  }
}

export async function geocode(
  query: string,
  options: {
    limit?: number;
    signal?: AbortSignal;
    /** [lng, lat] — bias results toward this point (e.g., the current
     * map centre) so nearby supermarkets / cafés / attractions outrank
     * far-away string matches. */
    nearby?: [number, number];
    /** 0…1, higher = stronger proximity preference. Default 0.7. */
    locationBiasScale?: number;
    /** Preferred language for results (e.g., 'de', 'en'). */
    lang?: string;
  } = {},
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    q: trimmed,
    limit: String(options.limit ?? 6),
  });
  if (options.nearby) {
    const [lng, lat] = options.nearby;
    if (Number.isFinite(lng) && Number.isFinite(lat)) {
      params.set("lon", String(lng));
      params.set("lat", String(lat));
      params.set(
        "location_bias_scale",
        String(options.locationBiasScale ?? 0.7),
      );
    }
  }
  if (options.lang) params.set("lang", options.lang);

  const res = await fetch(`${PHOTON_URL}?${params}`, {
    signal: options.signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Geocoder error: ${res.status}`);

  const data = (await res.json()) as { features: PhotonFeature[] };
  const results = data.features.map((f, i) => {
    const p = f.properties;
    const coordinates = f.geometry.coordinates;
    const osmType = p.osm_type?.toUpperCase();
    const id = `${p.osm_type ?? "?"}-${p.osm_id ?? i}`;
    const label = buildLabel(p);
    return {
      id,
      name: p.name ?? label.split(",")[0] ?? "",
      label,
      coordinates,
      extent: p.extent,
      type: p.type,
      category: p.osm_value ?? p.osm_key,
      city: p.city ?? p.district,
      country: p.country,
      postcode: p.postcode,
      ...(osmType === "N" || osmType === "W" || osmType === "R"
        ? { osmType }
        : {}),
      ...(typeof p.osm_id === "number" ? { osmId: p.osm_id } : {}),
    } satisfies GeocodeResult;
  });
  return rankByProximity(results, options.nearby);
}

/** Pretty-print Photon's OSM value/key as a human-readable category badge. */
export function prettyCategory(category?: string): string | null {
  if (!category) return null;
  const map: Record<string, string> = {
    supermarket: "Supermarket",
    convenience: "Convenience",
    bakery: "Bakery",
    butcher: "Butcher",
    restaurant: "Restaurant",
    cafe: "Café",
    bar: "Bar",
    pub: "Pub",
    fast_food: "Fast food",
    fuel: "Gas station",
    parking: "Parking",
    pharmacy: "Pharmacy",
    hospital: "Hospital",
    bank: "Bank",
    atm: "ATM",
    post_office: "Post",
    hotel: "Hotel",
    hostel: "Hostel",
    guest_house: "Guesthouse",
    attraction: "Attraction",
    viewpoint: "Viewpoint",
    museum: "Museum",
    castle: "Castle",
    monument: "Monument",
    park: "Park",
    playground: "Playground",
    information: "Info",
    train_station: "Station",
    bus_stop: "Bus stop",
    station: "Station",
    peak: "Peak",
    waterfall: "Waterfall",
    spring: "Spring",
    beach: "Beach",
    place_of_worship: "Worship",
    school: "School",
    university: "University",
    library: "Library",
    cinema: "Cinema",
    theatre: "Theatre",
    house: "House",
    apartments: "Apartments",
    residential: "Residential",
    city: "City",
    town: "Town",
    village: "Village",
    suburb: "Suburb",
    hamlet: "Hamlet",
    state: "State",
    country: "Country",
  };
  if (map[category]) return map[category];
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
