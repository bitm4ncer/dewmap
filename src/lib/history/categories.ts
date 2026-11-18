import categoryMap from "./category-map.json";
import type { HistoricCategory } from "./types";
import { HISTORIC_CATEGORIES } from "./types";

export { HISTORIC_CATEGORIES };
export type { HistoricCategory };

type CategoryMap = {
  wikidata: Record<string, HistoricCategory>;
  osm: Record<string, HistoricCategory>;
  labels: Record<HistoricCategory, { en: string; de: string }>;
  priority: HistoricCategory[];
};

const map = categoryMap as CategoryMap;

export function categoryFromWikidata(
  qids: readonly string[],
): HistoricCategory {
  const present = new Set(qids);
  for (const category of map.priority) {
    if (category === "other") continue;
    for (const [qid, mapped] of Object.entries(map.wikidata)) {
      if (mapped === category && present.has(qid)) return category;
    }
  }
  return "other";
}

export function categoryFromOsm(
  historic: string | undefined,
): HistoricCategory {
  if (!historic) return "other";
  return map.osm[historic] ?? "other";
}

export function categoryLabel(
  category: HistoricCategory,
  lang: "en" | "de",
): string {
  return map.labels[category]?.[lang] ?? map.labels.other[lang];
}

export function isSiteVisibleAtYear(
  site: { inception?: number; dissolved?: number },
  year: number,
): boolean {
  if (site.inception === undefined) return true;
  if (site.inception > year) return false;
  if (site.dissolved !== undefined && site.dissolved < year) return false;
  return true;
}
