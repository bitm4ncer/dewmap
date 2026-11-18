import type { PoiImage } from "./types";

const API = "https://commons.wikimedia.org/w/api.php";
const TIMEOUT_MS = 12_000;

interface ExtMetadataValue {
  value?: string;
}

interface ImageInfo {
  thumburl?: string;
  url?: string;
  descriptionurl?: string;
  extmetadata?: {
    Artist?: ExtMetadataValue;
    LicenseShortName?: ExtMetadataValue;
    LicenseUrl?: ExtMetadataValue;
  };
}

interface ApiResponse {
  query?: {
    pages?: Record<string, { imageinfo?: ImageInfo[] }>;
  };
}

const cache = new Map<string, { at: number; value: PoiImage }>();
const inFlight = new Map<string, Promise<PoiImage>>();
const TTL_MS = 24 * 60 * 60 * 1000;

function normalizeFile(file: string): string {
  return file.replace(/^File:/i, "").replace(/ /g, "_");
}

function decodeEntities(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim();
}

function fallback(file: string): PoiImage {
  const name = normalizeFile(file);
  return {
    url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
      name,
    )}?width=900`,
    href: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`,
    credit: "Wikimedia Commons",
  };
}

/**
 * Resolve a Commons file to a direct thumbnail URL plus attribution.
 *
 * `Special:FilePath` is a redirect and can be flaky behind proxies and
 * privacy tools. The Commons imageinfo API returns the final
 * `thumb.wikimedia.org` URL, the author and the licence in one request.
 */
export async function resolveCommonsImage(
  file: string,
  width = 900,
  signal?: AbortSignal,
): Promise<PoiImage> {
  const key = `${normalizeFile(file)}|${width}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: String(width),
      titles: `File:${normalizeFile(file)}`,
    });
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API}?${params.toString()}`, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Commons ${res.status}`);
      const data = (await res.json()) as ApiResponse;
      const pages = Object.values(data.query?.pages ?? {});
      const info = pages[0]?.imageinfo?.[0];
      if (!info) throw new Error("Commons image missing");
      const url = info.thumburl ?? info.url;
      if (!url) throw new Error("Commons URL missing");

      const artist = info.extmetadata?.Artist?.value
        ? decodeEntities(info.extmetadata.Artist.value)
        : undefined;
      const license = info.extmetadata?.LicenseShortName?.value
        ? decodeEntities(info.extmetadata.LicenseShortName.value)
        : undefined;
      const licenseUrl = info.extmetadata?.LicenseUrl?.value;
      const credit = [artist, license].filter(Boolean).join(" · ");
      const value: PoiImage = {
        url,
        href:
          info.descriptionurl ??
          `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(
            normalizeFile(file),
          )}`,
        credit: credit || "Wikimedia Commons",
        ...(license ? { license } : {}),
        ...(licenseUrl ? { licenseUrl } : {}),
      };
      if (cache.size > 80) cache.clear();
      cache.set(key, { at: Date.now(), value });
      return value;
    } catch (err) {
      if (signal?.aborted) throw err;
      // Keep a usable URL even when the metadata API is unavailable.
      return fallback(file);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}
