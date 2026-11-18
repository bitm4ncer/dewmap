import { fetchWikipediaSummary } from "@/lib/history/wikipedia";
import { lookupPoi, reversePoi, type RawPoi } from "./nominatim";
import { parseOpeningHours } from "./openingHours";
import { fetchWikidata } from "./wikidata";
import type {
  PoiDetails,
  PoiImage,
  PoiSelection,
  PoiSocial,
} from "./types";

export type {
  PoiDetails,
  PoiImage,
  PoiOpening,
  PoiSelection,
  PoiSocial,
} from "./types";

const TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "biosphere.poi.v1.";
const memory = new Map<string, { at: number; value: PoiDetails }>();

function cacheKey(selection: PoiSelection): string {
  if (selection.osmType && selection.osmId) {
    return `${selection.osmType}${selection.osmId}`;
  }
  return `reverse:${selection.lon.toFixed(4)},${selection.lat.toFixed(4)}`;
}

function readCache(key: string): PoiDetails | null {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  if (hit) memory.delete(key);
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; value?: PoiDetails };
    if (
      typeof parsed.at !== "number" ||
      Date.now() - parsed.at >= TTL_MS ||
      !parsed.value
    ) {
      localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
      return null;
    }
    memory.set(key, { at: parsed.at, value: parsed.value });
    return parsed.value;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: PoiDetails): void {
  const entry = { at: Date.now(), value };
  memory.set(key, entry);
  if (memory.size > 60) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Quota or private mode: the in-memory cache still works.
  }
}

function commonsUrl(file: string, width = 900): string {
  const normalized = file.replace(/^File:/i, "").replace(/ /g, "_");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    normalized,
  )}?width=${width}`;
}

function commonsPage(file: string): string {
  const normalized = file.replace(/^File:/i, "").replace(/ /g, "_");
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(
    normalized,
  )}`;
}

function wikipediaTag(tag: string | undefined): {
  lang: string;
  title: string;
} | null {
  if (!tag) return null;
  const match = tag.match(/^([a-z]{2,3}):(.+)$/);
  if (match) return { lang: match[1], title: match[2] };
  return { lang: "de", title: tag };
}

function wikipediaUrl(lang: string, title: string): string {
  const path = encodeURIComponent(title.replace(/ /g, "_")).replace(
    /%2F/g,
    "/",
  );
  return `https://${lang}.wikipedia.org/wiki/${path}`;
}

function osmPath(type: PoiDetails["osmType"]): string {
  return type === "W" ? "way" : type === "R" ? "relation" : "node";
}

function mergeSocials(...groups: PoiSocial[][]): PoiSocial[] {
  const seen = new Set<string>();
  const out: PoiSocial[] = [];
  for (const group of groups) {
    for (const item of group) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      out.push(item);
    }
  }
  return out;
}

function isDisplayableImage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "photos.app.goo.gl"
      || host === "goo.gl"
      || host.endsWith("google.com")
      || host === "flickr.com"
      || host.endsWith(".flickr.com")
    ) {
      return false;
    }
    if (
      /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(parsed.pathname)
      || host === "commons.wikimedia.org"
      || host === "upload.wikimedia.org"
      || host === "thumb.wikimedia.org"
    ) {
      return true;
    }
    // Unknown hosts without an image extension are usually photo pages,
    // not direct images; keep the card clean instead of showing a broken hero.
    return false;
  } catch {
    return false;
  }
}

function mergeImages(...items: (PoiImage | null | undefined)[]): PoiImage[] {
  const seen = new Set<string>();
  const out: PoiImage[] = [];
  for (const item of items) {
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

/**
 * Load a place card from OSM (Nominatim extratags), enriched by Wikidata
 * and Wikipedia when the feature links to them. Everything is cached for
 * 24 hours; one tap costs one Nominatim request plus optional Wikimedia
 * requests, never a bulk download.
 */
export async function fetchPoiDetails(
  selection: PoiSelection,
  signal?: AbortSignal,
): Promise<PoiDetails | null> {
  const key = cacheKey(selection);
  const cached = readCache(key);
  if (cached) return cached;

  let raw: RawPoi | null = null;
  if (selection.osmType && selection.osmId) {
    raw = await lookupPoi(selection.osmType, selection.osmId, signal);
  }
  if (!raw) {
    raw = await reversePoi(selection.lon, selection.lat, signal);
  }
  if (!raw) return null;

  const brandQid = raw.tags["brand:wikidata"];
  const brandEntity = Boolean(
    brandQid && raw.wikidataId && brandQid === raw.wikidataId,
  );
  const wd = raw.wikidataId
    ? await fetchWikidata(raw.wikidataId, signal)
    : null;

  const wikiTag = brandEntity ? null : wikipediaTag(raw.wikipediaTag);
  const wikiTitle = brandEntity
    ? undefined
    : wikiTag?.title ?? wd?.wikipediaTitle;
  const wikiLang = wikiTag?.lang ?? "de";
  const wiki = wikiTitle
    ? await fetchWikipediaSummary(wikiTitle, wikiLang, signal)
    : null;

  const description =
    raw.description ??
    (brandEntity ? undefined : wd?.description) ??
    (brandEntity ? undefined : wiki?.extract) ??
    undefined;
  const opening = parseOpeningHours(raw.openingRaw);
  const category =
    raw.category && raw.category !== "Place"
      ? raw.category
      : selection.category ?? raw.category;

  const images = mergeImages(
    raw.imageUrl && isDisplayableImage(raw.imageUrl)
      ? {
          url: raw.imageUrl,
          credit: "OpenStreetMap image",
          href: raw.imageUrl,
        }
      : null,
    raw.commonsFile
      ? {
          url: commonsUrl(raw.commonsFile),
          href: commonsPage(raw.commonsFile),
          credit: "Wikimedia Commons",
        }
      : null,
    !brandEntity && wd?.imageFile
      ? {
          url: commonsUrl(wd.imageFile),
          href: commonsPage(wd.imageFile),
          credit: "Wikimedia Commons",
        }
      : null,
    !brandEntity && wiki?.thumbnail
      ? {
          url: wiki.thumbnail.source,
          href: wiki.url,
          credit: "Wikipedia",
        }
      : null,
  );

  const details: PoiDetails = {
    key,
    name:
      raw.name === "Unnamed place" && selection.name
        ? selection.name
        : raw.name,
    category,
    ...(raw.city || selection.city
      ? { city: raw.city ?? selection.city }
      : {}),
    ...(raw.address ? { address: raw.address } : {}),
    lat: raw.lat,
    lon: raw.lon,
    osmType: raw.osmType,
    osmId: raw.osmId,
    osmUrl: `https://www.openstreetmap.org/${osmPath(raw.osmType)}/${raw.osmId}`,
    ...(raw.website || wd?.website
      ? { website: raw.website ?? wd?.website }
      : {}),
    ...(raw.phone ? { phone: raw.phone } : {}),
    ...(raw.email ? { email: raw.email } : {}),
    ...(description ? { description } : {}),
    ...(wiki?.url || wd?.wikipediaUrl
      ? { wikipediaUrl: wiki?.url ?? wd?.wikipediaUrl }
      : wikiTag
        ? { wikipediaUrl: wikipediaUrl(wikiTag.lang, wikiTag.title) }
        : {}),
    ...(raw.wikidataId
      ? { wikidataUrl: `https://www.wikidata.org/wiki/${raw.wikidataId}` }
      : {}),
    ...(opening ? { opening } : {}),
    socials: mergeSocials(raw.socials, wd?.socials ?? []),
    facts: raw.facts,
    images,
    ...(raw.checked ? { checked: raw.checked } : {}),
    tags: raw.tags,
  };

  writeCache(key, details);
  return details;
}
