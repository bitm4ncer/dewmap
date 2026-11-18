import type {
  PoiFact,
  PoiOsmType,
  PoiSocial,
} from "./types";

const NOMINATIM = "https://nominatim.openstreetmap.org";
const MIN_INTERVAL_MS = 1100;
const TIMEOUT_MS = 15_000;

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  square?: string;
  house_number?: string;
  postcode?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  state?: string;
  country?: string;
}

interface NominatimPlace {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  category?: string;
  type?: string;
  extratags?: Record<string, string>;
  address?: NominatimAddress;
  namedetails?: Record<string, string>;
}

export interface RawPoi {
  osmType: PoiOsmType;
  osmId: number;
  lat: number;
  lon: number;
  name: string;
  category: string;
  city?: string;
  address?: string;
  website?: string;
  phone?: string;
  email?: string;
  description?: string;
  wikipediaTag?: string;
  wikidataId?: string;
  commonsFile?: string;
  imageUrl?: string;
  openingRaw?: string;
  socials: PoiSocial[];
  facts: PoiFact[];
  checked?: string;
  tags: Record<string, string>;
}

let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function schedule<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(async () => {
    const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
    return run();
  });
  chain = next.catch(() => undefined);
  return next;
}

async function request(
  url: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "Accept-Language": "de,en",
      },
    });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function typeFor(value: string): PoiOsmType {
  if (value === "way") return "W";
  if (value === "relation") return "R";
  return "N";
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const CATEGORY_LABELS: Record<string, string> = {
  supermarket: "Supermarket",
  convenience: "Convenience store",
  bakery: "Bakery",
  butcher: "Butcher",
  greengrocer: "Greengrocer",
  marketplace: "Market",
  restaurant: "Restaurant",
  cafe: "Café",
  fast_food: "Fast food",
  bar: "Bar",
  pub: "Pub",
  biergarten: "Beer garden",
  ice_cream: "Ice cream",
  pharmacy: "Pharmacy",
  hospital: "Hospital",
  doctors: "Doctor",
  dentist: "Dentist",
  clinic: "Clinic",
  veterinary: "Veterinarian",
  bank: "Bank",
  post_office: "Post office",
  library: "Library",
  museum: "Museum",
  gallery: "Gallery",
  attraction: "Attraction",
  viewpoint: "Viewpoint",
  artwork: "Artwork",
  memorial: "Memorial",
  monument: "Monument",
  castle: "Castle",
  ruins: "Ruins",
  archaeological_site: "Archaeological site",
  hotel: "Hotel",
  guest_house: "Guest house",
  hostel: "Hostel",
  camp_site: "Campsite",
  cinema: "Cinema",
  theatre: "Theatre",
  arts_centre: "Arts centre",
  nightclub: "Nightclub",
  park: "Park",
  garden: "Garden",
  playground: "Playground",
  sports_centre: "Sports centre",
  fitness_centre: "Fitness centre",
  swimming_pool: "Swimming pool",
  zoo: "Zoo",
  theme_park: "Theme park",
  parking: "Parking",
  fuel: "Fuel station",
  charging_station: "Charging station",
  toilets: "Toilets",
  tourist_information: "Tourist information",
  railway_station: "Railway station",
  bus_station: "Bus station",
  tram_stop: "Tram stop",
  subway_entrance: "Subway entrance",
  place_of_worship: "Place of worship",
  townhall: "Town hall",
  courthouse: "Courthouse",
  police: "Police",
  fire_station: "Fire station",
  university: "University",
  school: "School",
  kindergarten: "Kindergarten",
  community_centre: "Community centre",
  ert: "Emergency room",
};

function pretty(value: string): string {
  return (
    CATEGORY_LABELS[value] ??
    value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function categoryOf(
  tags: Record<string, string>,
  fallbackCategory?: string,
  fallbackType?: string,
): string {
  const keys = [
    "amenity",
    "tourism",
    "shop",
    "leisure",
    "historic",
    "office",
    "healthcare",
    "public_transport",
  ];
  for (const key of keys) {
    const value = tags[key];
    if (value && value !== "yes" && value !== "no") return pretty(value);
  }
  if (tags.railway === "station") return "Railway station";
  if (tags.railway === "halt") return "Railway stop";
  if (tags.highway) return "Street";
  if (tags.place) return pretty(tags.place);
  if (fallbackCategory === "highway") return "Street";

  const genericType = new Set([
    "yes",
    "no",
    "building",
    "house",
    "apartments",
    "residential",
    "garage",
    "garages",
    "shed",
    "roof",
    "construction",
  ]);
  if (fallbackType && !genericType.has(fallbackType)) {
    return pretty(fallbackType);
  }
  if (tags.building || tags["addr:housenumber"]) {
    return "Address";
  }
  if (
    fallbackCategory === "building"
    || fallbackCategory === "place"
    || (fallbackType && genericType.has(fallbackType))
  ) {
    return "Address";
  }
  if (fallbackCategory) return pretty(fallbackCategory);
  return "Place";
}

function addressOf(place: NominatimPlace): { city?: string; address?: string } {
  const a = place.address;
  if (!a) return {};
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb;
  const road = a.road ?? a.pedestrian ?? a.footway ?? a.square;
  const line1 = [road, a.house_number].filter(Boolean).join(" ");
  const line2 = [a.postcode, city].filter(Boolean).join(" ");
  const address = [line1, line2].filter(Boolean).join(", ") || undefined;
  return { city, address };
}

function normalizeUrl(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  return `https://${raw}`;
}

function socialFrom(
  value: string | undefined,
  label: string,
  build: (handle: string) => string,
): PoiSocial | null {
  const raw = value?.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return { label, url: raw };
  const handle = raw.replace(/^@/, "").replace(/^\/+/, "");
  if (!handle) return null;
  return { label, url: build(handle) };
}

function socialsOf(tags: Record<string, string>): PoiSocial[] {
  const entries: PoiSocial[] = [];
  const add = (s: PoiSocial | null) => {
    if (s && !entries.some((e) => e.url === s.url)) entries.push(s);
  };
  add(
    socialFrom(
      tags["contact:facebook"] ?? tags.facebook,
      "Facebook",
      (h) => `https://www.facebook.com/${h}`,
    ),
  );
  add(
    socialFrom(
      tags["contact:instagram"] ?? tags.instagram,
      "Instagram",
      (h) => `https://www.instagram.com/${h}`,
    ),
  );
  add(
    socialFrom(
      tags["contact:twitter"] ?? tags.twitter,
      "X",
      (h) => `https://x.com/${h}`,
    ),
  );
  add(
    socialFrom(
      tags["contact:mastodon"] ?? tags.mastodon,
      "Mastodon",
      (h) =>
        h.includes("@")
          ? `https://${h.split("@").slice(1).join("@")}/@${h.split("@")[0]}`
          : `https://mastodon.social/@${h}`,
    ),
  );
  add(
    socialFrom(
      tags["contact:telegram"] ?? tags.telegram,
      "Telegram",
      (h) => `https://t.me/${h}`,
    ),
  );
  add(
    socialFrom(
      tags["contact:youtube"] ?? tags.youtube,
      "YouTube",
      (h) => `https://www.youtube.com/${h.startsWith("@") ? h : `@${h}`}`,
    ),
  );
  add(
    socialFrom(
      tags["contact:linkedin"] ?? tags.linkedin,
      "LinkedIn",
      (h) => `https://www.linkedin.com/company/${h}`,
    ),
  );
  add(
    socialFrom(
      tags["contact:tiktok"] ?? tags.tiktok,
      "TikTok",
      (h) => `https://www.tiktok.com/@${h}`,
    ),
  );
  return entries;
}

const PAYMENT_LABELS: Record<string, string> = {
  "payment:cards": "Cards",
  "payment:credit_cards": "Credit cards",
  "payment:debit_cards": "Debit cards",
  "payment:contactless": "Contactless",
  "payment:cash": "Cash",
  "payment:maestro": "Maestro",
  "payment:visa": "Visa",
  "payment:mastercard": "Mastercard",
  "payment:amex": "Amex",
  "payment:apple_pay": "Apple Pay",
  "payment:google_pay": "Google Pay",
  "payment:paypal": "PayPal",
};

function factsOf(tags: Record<string, string>): PoiFact[] {
  const facts: PoiFact[] = [];
  const add = (label: string, value: string | undefined) => {
    if (value && !facts.some((f) => f.label === label)) {
      facts.push({ label, value });
    }
  };
  const wheelchair = tags.wheelchair;
  if (wheelchair === "yes") add("Wheelchair access", "Yes");
  else if (wheelchair === "limited") add("Wheelchair access", "Limited");
  else if (wheelchair === "no") add("Wheelchair access", "No");
  if (tags["toilets:wheelchair"] === "yes") add("Accessible toilet", "Yes");

  const payments = Object.entries(PAYMENT_LABELS)
    .filter(([key]) => tags[key] === "yes")
    .map(([, label]) => label);
  if (payments.length) add("Payment", payments.join(", "));

  add("Cuisine", tags.cuisine?.replace(/_/g, " "));
  add("Brand", tags.brand);
  add("Operator", tags.operator);
  add("Takeaway", tags.takeaway === "yes" ? "Yes" : undefined);
  add("Delivery", tags.delivery === "yes" ? "Yes" : undefined);
  add("Outdoor seating", tags.outdoor_seating === "yes" ? "Yes" : undefined);
  add(
    "Internet",
    tags.internet_access === "wlan" ? "Free Wi-Fi" : tags.internet_access,
  );
  add("Smoking", tags.smoking === "no" ? "No smoking" : tags.smoking);
  return facts;
}

function parsePlace(place: NominatimPlace): RawPoi | null {
  const tags = place.extratags ?? {};
  const osmType = place.osm_type ? typeFor(place.osm_type) : "N";
  const osmId = asNumber(place.osm_id);
  const lat = asNumber(place.lat);
  const lon = asNumber(place.lon);
  if (osmId === undefined || lat === undefined || lon === undefined) return null;

  const named =
    place.namedetails?.["name:de"] ??
    place.namedetails?.name ??
    place.name ??
    place.display_name?.split(",")[0];
  const { city, address } = addressOf(place);
  const addressName = address?.split(",")[0]?.trim();
  const name = asString(named) ?? addressName ?? "Address";
  const description =
    asString(tags.description) ??
    asString(tags["description:de"]) ??
    asString(tags.note);

  const website = normalizeUrl(
    tags["contact:website"] ?? tags.website ?? tags.url,
  );
  const phone = asString(tags["contact:phone"] ?? tags.phone);
  const email = asString(tags["contact:email"] ?? tags.email);

  const wikipediaTag = asString(tags.wikipedia);
  const wikidataId = asString(tags.wikidata);
  const commonsRaw = asString(tags.wikimedia_commons);
  const commonsFile = commonsRaw?.startsWith("File:")
    ? commonsRaw.slice(5).trim()
    : undefined;
  const imageUrl = normalizeUrl(asString(tags.image));

  return {
    osmType,
    osmId,
    lat,
    lon,
    name,
    category: categoryOf(tags, place.category, place.type),
    ...(city ? { city } : {}),
    ...(address ? { address } : {}),
    ...(website ? { website } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(description ? { description } : {}),
    ...(wikipediaTag ? { wikipediaTag } : {}),
    ...(wikidataId ? { wikidataId } : {}),
    ...(commonsFile ? { commonsFile } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(tags.opening_hours ? { openingRaw: tags.opening_hours } : {}),
    socials: socialsOf(tags),
    facts: factsOf(tags),
    ...(tags.check_date ? { checked: tags.check_date } : {}),
    tags,
  };
}

/** Test seam for parsing a single Nominatim place without network I/O. */
export function parseNominatimPlace(value: unknown): RawPoi | null {
  if (!value || typeof value !== "object") return null;
  return parsePlace(value as NominatimPlace);
}

function first(data: unknown): NominatimPlace | null {
  if (Array.isArray(data)) {
    return data.length ? (data[0] as NominatimPlace) : null;
  }
  if (data && typeof data === "object") {
    const value = data as NominatimPlace & { error?: unknown };
    return value.error ? null : value;
  }
  return null;
}

/** Fetch a full OSM feature by type/id. */
export async function lookupPoi(
  type: PoiOsmType,
  id: number,
  signal?: AbortSignal,
): Promise<RawPoi | null> {
  const params = new URLSearchParams({
    osm_ids: `${type}${id}`,
    format: "jsonv2",
    extratags: "1",
    addressdetails: "1",
    namedetails: "1",
    "accept-language": "de,en",
  });
  const data = await schedule(() =>
    request(`${NOMINATIM}/lookup?${params.toString()}`, signal),
  );
  const place = first(data);
  return place ? parsePlace(place) : null;
}

/** Reverse lookup for a map click. */
export async function reversePoi(
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<RawPoi | null> {
  const params = new URLSearchParams({
    lon: String(lon),
    lat: String(lat),
    format: "jsonv2",
    extratags: "1",
    addressdetails: "1",
    namedetails: "1",
    zoom: "18",
    "accept-language": "de,en",
  });
  const data = await schedule(() =>
    request(`${NOMINATIM}/reverse?${params.toString()}`, signal),
  );
  const place = first(data);
  return place ? parsePlace(place) : null;
}
