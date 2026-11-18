import { categoryLabel } from "./categories";
import type { HistoricSiteDetail, HistoricSiteTile } from "./types";
import {
  fetchWikidataImage,
  fetchWikipediaSummaryFromQid,
  type WikipediaSummary,
} from "./wikipedia";

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
  const badges = [
    site.heritage ? "Heritage" : "",
    site.unesco ? "UNESCO" : "",
  ]
    .filter(Boolean)
    .map((label) => `<span class="hud-popup-badge">${label}</span>`)
    .join("");
  return `
    <div class="hud-popup-header">
      <span class="hud-popup-title">${escapeHistoryHtml(site.name)}</span>
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
      `<a class="hud-popup-link" href="https://www.wikidata.org/wiki/${escapeHistoryHtml(site.qid)}" target="_blank" rel="noopener noreferrer">Wikidata ↗</a>`,
    );
  }
  links.push(
    `<a class="hud-popup-link" href="https://www.openstreetmap.org/search?query=${encodeURIComponent(
      coordinates ? `${coordinates[1]},${coordinates[0]}` : site.name,
    )}" target="_blank" rel="noopener noreferrer">OSM ↗</a>`,
  );
  links.push(
    `<a class="hud-popup-link" href="https://www.openhistoricalmap.org/" target="_blank" rel="noopener noreferrer">OHM ↗</a>`,
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
