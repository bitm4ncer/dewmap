import type { PoiSocial } from "./types";

interface WdSnak {
  datavalue?: { value?: unknown };
}

interface WdClaim {
  mainsnak?: WdSnak;
}

interface WdEntity {
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<string, WdClaim[]>;
  sitelinks?: Record<string, { title?: string; url?: string }>;
}

export interface WikidataInfo {
  description?: string;
  website?: string;
  imageFile?: string;
  wikipediaTitle?: string;
  wikipediaUrl?: string;
  socials: PoiSocial[];
}

function claimString(entity: WdEntity, property: string): string | undefined {
  const claims = entity.claims?.[property];
  for (const claim of claims ?? []) {
    const value = claim.mainsnak?.datavalue?.value;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function social(
  label: string,
  value: string | undefined,
  build: (v: string) => string,
): PoiSocial | null {
  return value ? { label, url: build(value) } : null;
}

/**
 * Fetch the small Wikidata subset that is useful for a place card:
 * description, official website, Commons image and social accounts.
 */
export async function fetchWikidata(
  id: string,
  signal?: AbortSignal,
): Promise<WikidataInfo | null> {
  if (!/^Q\d+$/.test(id)) return null;
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: id,
    props: "claims|descriptions|sitelinks/urls",
    languages: "de|en",
    sitefilter: "dewiki|enwiki",
    format: "json",
    origin: "*",
  });
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(
      `https://www.wikidata.org/w/api.php?${params.toString()}`,
      {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      entities?: Record<string, WdEntity>;
    };
    const entity = data.entities?.[id];
    if (!entity) return null;

    const description =
      entity.descriptions?.de?.value ?? entity.descriptions?.en?.value;
    const website = claimString(entity, "P856");
    const imageFile = claimString(entity, "P18");
    const wikiLink =
      entity.sitelinks?.dewiki ?? entity.sitelinks?.enwiki;
    const socials = [
      social("X", claimString(entity, "P2002"), (v) => `https://x.com/${v}`),
      social(
        "Instagram",
        claimString(entity, "P2003"),
        (v) => `https://www.instagram.com/${v}`,
      ),
      social(
        "Facebook",
        claimString(entity, "P2013"),
        (v) => `https://www.facebook.com/${v}`,
      ),
      social(
        "YouTube",
        claimString(entity, "P2397"),
        (v) =>
          v.startsWith("UC")
            ? `https://www.youtube.com/channel/${v}`
            : `https://www.youtube.com/@${v}`,
      ),
      social(
        "LinkedIn",
        claimString(entity, "P4264"),
        (v) => `https://www.linkedin.com/company/${v}`,
      ),
      social(
        "TikTok",
        claimString(entity, "P7085"),
        (v) => `https://www.tiktok.com/@${v}`,
      ),
    ].filter((s): s is PoiSocial => Boolean(s));

    return {
      ...(description ? { description } : {}),
      ...(website ? { website } : {}),
      ...(imageFile ? { imageFile } : {}),
      ...(wikiLink?.title ? { wikipediaTitle: wikiLink.title } : {}),
      ...(wikiLink?.url ? { wikipediaUrl: wikiLink.url } : {}),
      socials,
    };
  } catch (err) {
    if ((err as Error).name === "AbortError") return null;
    console.warn("[poi/wikidata]", err);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
