import type { HistoricCategory, HistoricSourceStatus } from "./types";

export interface PanelSummaryInput {
  status: HistoricSourceStatus;
  count: number;
  total: number;
  /** Optional for callers/tests from before the viewport-count split. */
  siteZoom?: boolean;
  filters: {
    heritageOnly: boolean;
    unescoOnly: boolean;
    categories: readonly HistoricCategory[];
  };
}

export function panelSummary({
  status,
  count,
  total,
  siteZoom,
  filters,
}: PanelSummaryInput): string {
  if (status === "loading") return "loading…";
  if (status === "error") return "global dataset unavailable";
  if (status !== "ready") return "";

  const atSiteZoom = siteZoom ?? count > 0;
  const parts: string[] = [`${atSiteZoom ? count : total} sites`];
  if (filters.heritageOnly) parts.push("heritage");
  if (filters.unescoOnly) parts.push("UNESCO");
  if (atSiteZoom && filters.categories.length > 0) {
    parts.push(
      `${filters.categories.length} ${
        filters.categories.length === 1 ? "category" : "categories"
      }`,
    );
  }
  return parts.join(" · ");
}
