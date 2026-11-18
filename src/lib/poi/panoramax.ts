export interface PanoramaxStreetView {
  provider: "Panoramax";
  id: string;
  lon: number;
  lat: number;
  thumbUrl?: string;
  sdUrl?: string;
  capturedAt?: string;
  license: string;
  licenseUrl?: string;
  attribution: string;
  viewerUrl: string;
  sourceUrl: string;
}

interface PanoramaxLink {
  rel?: string;
  href?: string;
  title?: string;
}

interface PanoramaxAsset {
  href?: string;
}

interface PanoramaxFeature {
  id?: string;
  geometry?: { coordinates?: number[] };
  properties?: {
    datetime?: string;
    created?: string;
    license?: string;
    "view:azimuth"?: number;
    "geovisio:status"?: string;
    "geovisio:producer"?: string;
    [key: string]: unknown;
  };
  assets?: Record<string, PanoramaxAsset | undefined>;
  links?: PanoramaxLink[];
}

interface PanoramaxResponse {
  features?: PanoramaxFeature[];
}

const SEARCH_URL = "https://api.panoramax.xyz/api/search";
// The instance frontends expose /photo.html; the hosted GeoVisio photo viewer
// is the stable, embeddable front-end that works without a Panoramax account.
const VIEWER_URL = "https://viewer.geovisio.fr/photo.html";
const DEFAULT_LICENSE = "CC BY-SA 4.0";
const DEFAULT_LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "").trim();
}

function absoluteAssetUrl(href: string | undefined): string | undefined {
  if (!href) return undefined;
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, VIEWER_URL).href;
  } catch {
    return undefined;
  }
}

function featureLink(feature: PanoramaxFeature, rel: string): PanoramaxLink | undefined {
  return feature.links?.find((link) => link.rel === rel);
}

function featureCoordinates(
  feature: PanoramaxFeature,
): { lon: number; lat: number } | null {
  const coords = feature.geometry?.coordinates;
  if (
    !Array.isArray(coords) ||
    coords.length < 2 ||
    typeof coords[0] !== "number" ||
    typeof coords[1] !== "number"
  ) {
    return null;
  }
  return { lon: coords[0], lat: coords[1] };
}

function toStreetView(
  feature: PanoramaxFeature,
  fallback: { lon: number; lat: number },
): PanoramaxStreetView | null {
  const status = feature.properties?.["geovisio:status"];
  if (typeof status === "string" && status !== "ready") return null;
  if (!feature.id) return null;

  const coords = featureCoordinates(feature) ?? fallback;
  const licenseLink = featureLink(feature, "license");
  const viaLink = featureLink(feature, "via");
  const license =
    (typeof feature.properties?.license === "string" &&
      feature.properties.license.trim()) ||
    (licenseLink?.title
      ? stripTags(licenseLink.title).replace(/^License for this object \((.+)\)$/i, "$1")
      : DEFAULT_LICENSE);
  const producer = feature.properties?.["geovisio:producer"];
  const attribution =
    typeof producer === "string" && producer.trim()
      ? `© ${stripTags(producer)} / Panoramax`
      : "© Panoramax contributors";

  const thumbUrl = absoluteAssetUrl(feature.assets?.thumb?.href);
  const sdUrl = absoluteAssetUrl(feature.assets?.sd?.href);
  const viewerUrl = `${VIEWER_URL}?pic=${encodeURIComponent(feature.id)}&focus=pic&nav=seq`;

  return {
    provider: "Panoramax",
    id: feature.id,
    lon: coords.lon,
    lat: coords.lat,
    ...(thumbUrl ? { thumbUrl } : {}),
    ...(sdUrl ? { sdUrl } : {}),
    ...(feature.properties?.datetime || feature.properties?.created
      ? { capturedAt: feature.properties.datetime ?? feature.properties.created }
      : {}),
    license,
    licenseUrl: licenseLink?.href ?? DEFAULT_LICENSE_URL,
    attribution,
    viewerUrl,
    sourceUrl:
      viaLink?.href ??
      `https://api.panoramax.xyz/#focus=pic&pic=${encodeURIComponent(feature.id)}`,
  };
}

/**
 * Find the closest Panoramax picture that looks toward a place.
 *
 * Panoramax's `place_position` search is deliberately built for this: it
 * only returns pictures where the camera points at the place (within
 * `place_fov_tolerance`). No API key is required and image URLs are stable.
 *
 * https://api.panoramax.xyz/api/search?place_position=...
 */
async function searchStreetView(
  lon: number,
  lat: number,
  distance: string,
  fovTolerance: string,
  signal?: AbortSignal,
): Promise<PanoramaxStreetView | null> {
  const url = new URL(SEARCH_URL);
  url.searchParams.set("place_position", `${lon},${lat}`);
  url.searchParams.set("place_distance", distance);
  url.searchParams.set("place_fov_tolerance", fovTolerance);
  url.searchParams.set("limit", "5");

  let response: Response;
  try {
    response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let data: PanoramaxResponse;
  try {
    data = (await response.json()) as PanoramaxResponse;
  } catch {
    return null;
  }

  const features = Array.isArray(data.features) ? data.features : [];
  // A flat picture with a known heading is better for a facade than a 360°
  // panorama. Keep 360° as a fallback so places are not dropped entirely.
  const ordered = [
    ...features.filter(
      (feature) => typeof feature.properties?.["view:azimuth"] === "number",
    ),
    ...features.filter(
      (feature) => typeof feature.properties?.["view:azimuth"] !== "number",
    ),
  ];

  for (const feature of ordered) {
    const result = toStreetView(feature, { lon, lat });
    if (result) return result;
  }
  return null;
}

/**
 * Find a Panoramax picture for a place.
 *
 * First try a real facade shot (within 50 m, looking towards the place).
 * If that fails, fall back to the nearest picture within 100 m regardless
 * of its heading. This also makes long-press crosshair inspection work in
 * places where the building centroid has no direct facade capture.
 */
export async function findPanoramaxStreetView(
  lon: number,
  lat: number,
  signal?: AbortSignal,
): Promise<PanoramaxStreetView | null> {
  const facade = await searchStreetView(lon, lat, "3-50", "60", signal);
  if (facade) return facade;
  return searchStreetView(lon, lat, "3-100", "180", signal);
}
