import type { HistoricCategory, HistoricSourceStatus } from "./types";

export interface PanelSummaryInput {
  status: HistoricSourceStatus;
  count: number;
  total: number;
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
  filters,
}: PanelSummaryInput): string {
  if (status === "loading") return "loading…";
  if (status === "error") return "global dataset unavailable";
  if (status !== "ready") return "";

  const parts: string[] = [`${count > 0 ? count : total} sites`];
  if (filters.heritageOnly) parts.push("heritage");
  if (filters.unescoOnly) parts.push("UNESCO");
  if (filters.categories.length > 0) {
    parts.push(
      `${filters.categories.length} ${
        filters.categories.length === 1 ? "category" : "categories"
      }`,
    );
  }
  return parts.join(" · ");
}
