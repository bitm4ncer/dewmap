import { categoryLabel } from "./categories";
import type { HistoricSiteDetail, HistoricSiteTile } from "./types";
import {
  fetchWikidataImage,
  fetchWikipediaSummaryFromQid,
  type WikipediaSummary,
} from "./wikipedia";

const HISTORY_EMOJI_RE =
  /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]/gu;

/** Wikidata/Wikipedia text occasionally carries emoji; history popups use
 *  only our SVG icon set, never platform emoji. */
export function stripHistoryEmoji(value: string): string {
  return value.replace(HISTORY_EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

/** Inline external-link icon; keeps popups free of Unicode arrow glyphs. */
export function externalLinkIcon(): string {
  return '<svg class="hud-popup-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M9 3h4v4M13 3 7 9M6 4H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

export function escapeHistoryHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function siteDetailHeader(
  site: HistoricSiteTile,
  lang: "en" | "de" = "en",
): string {
  const date =
    site.inception === undefined
      ? "date unknown"
      : `${site.inception}${site.dissolved !== undefined ? `–${site.dissolved}` : ""}`;
  const name = escapeHistoryHtml(stripHistoryEmoji(site.name));
  const badges = [
    site.heritage ? "Heritage" : "",
    site.unesco ? "UNESCO" : "",
  ]
    .filter(Boolean)
    .map((label) => `<span class="hud-popup-badge">${label}</span>`)
    .join("");
  return `
    <div class="hud-popup-header">
      <span class="hud-popup-title">${name}</span>
      <span class="hud-popup-meta">${escapeHistoryHtml(categoryLabel(site.category, lang))} · ${date}</span>
      ${badges ? `<span class="hud-popup-badges">${badges}</span>` : ""}
    </div>
  `;
}

export function siteDetailLinks(
  site: HistoricSiteTile,
  coordinates?: [number, number],
): string {
  const links: string[] = [];
  if (site.qid) {
    links.push(
      `<a class="hud-popup-link" href="https://www.wikidata.org/wiki/${escapeHistoryHtml(site.qid)}" target="_blank" rel="noopener noreferrer">Wikidata ${externalLinkIcon()}</a>`,
    );
  }
  links.push(
    `<a class="hud-popup-link" href="https://www.openstreetmap.org/search?query=${encodeURIComponent(
      coordinates ? `${coordinates[1]},${coordinates[0]}` : site.name,
    )}" target="_blank" rel="noopener noreferrer">OSM ${externalLinkIcon()}</a>`,
  );
  links.push(
    `<a class="hud-popup-link" href="https://www.openhistoricalmap.org/" target="_blank" rel="noopener noreferrer">OHM ${externalLinkIcon()}</a>`,
  );
  return `<div class="hud-popup-links">${links.join("")}</div>`;
}

interface DetailLookups {
  summary: (qid: string) => Promise<WikipediaSummary | null>;
  image: (qid: string) => Promise<string | null>;
}

export async function fetchSiteDetail(
  site: HistoricSiteTile,
  lookups: DetailLookups = {
    summary: fetchWikipediaSummaryFromQid,
    image: fetchWikidataImage,
  },
): Promise<HistoricSiteDetail> {
  if (!site.qid) return { summary: null, image: null };
  const [summary, image] = await Promise.all([
    lookups.summary(site.qid),
    lookups.image(site.qid),
  ]);
  return { summary, image };
}
