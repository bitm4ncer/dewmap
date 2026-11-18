import { describe, expect, it } from "vitest";
import { panelSummary } from "./panel-state";

describe("panelSummary", () => {
  it("reports loading and error states", () => {
    expect(
      panelSummary({
        status: "loading",
        count: 0,
        total: 0,
        filters: { heritageOnly: false, unescoOnly: false, categories: [] },
      }),
    ).toBe("loading…");
    expect(
      panelSummary({
        status: "error",
        count: 0,
        total: 0,
        filters: { heritageOnly: false, unescoOnly: false, categories: [] },
      }),
    ).toBe("global dataset unavailable");
  });

  it("prefers the viewport count and falls back to the total", () => {
    const base = {
      status: "ready" as const,
      total: 199,
      filters: { heritageOnly: false, unescoOnly: false, categories: [] },
    };
    expect(panelSummary({ ...base, count: 12 })).toBe("12 sites");
    expect(panelSummary({ ...base, count: 0 })).toBe("199 sites");
  });

  it("mentions active filters", () => {
    expect(
      panelSummary({
        status: "ready",
        count: 3,
        total: 199,
        filters: { heritageOnly: true, unescoOnly: true, categories: ["castle"] },
      }),
    ).toBe("3 sites · heritage · UNESCO · 1 category");
  });
});
