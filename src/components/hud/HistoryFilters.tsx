"use client";

import { HISTORIC_CATEGORIES, categoryLabel } from "@/lib/history/categories";
import type { HistoricCategory } from "@/lib/history/types";

interface HistoryFiltersProps {
  categories: readonly HistoricCategory[];
  onCategoriesChange: (categories: HistoricCategory[]) => void;
}

export function HistoryFilters({
  categories,
  onCategoriesChange,
}: HistoryFiltersProps) {
  const active = new Set(categories);
  const toggle = (category: HistoricCategory) => {
    const next = new Set(active);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    onCategoriesChange(HISTORIC_CATEGORIES.filter((item) => next.has(item)));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="hud-label">Category</span>
      <div
        className="hud-variant-chips no-scrollbar"
        role="group"
        aria-label="Historic site categories"
      >
        {HISTORIC_CATEGORIES.map((category) => {
          const on = active.has(category);
          return (
            <button
              key={category}
              type="button"
              aria-pressed={on}
              data-active={on}
              className="hud-variant-chip"
              onClick={() => toggle(category)}
            >
              {categoryLabel(category, "de")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
