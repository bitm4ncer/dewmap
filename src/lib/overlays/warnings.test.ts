import { describe, expect, it } from "vitest";
import { THEME } from "../theme";
import {
  SEVERITY_COLORS,
  escapeHtml,
  severityColor,
  severityColorExpression,
  severityCounts,
  severityLabel,
  validityHint,
  warningPopupHtml,
  warningsSummary,
} from "./warnings";

describe("severity vocabulary", () => {
  it("uses the theme tokens for every level", () => {
    expect(SEVERITY_COLORS[1]).toBe(THEME.warningLevel1);
    expect(SEVERITY_COLORS[3]).toBe(THEME.warn);
    expect(SEVERITY_COLORS[4]).toBe(THEME.danger);
    expect(new Set(Object.values(SEVERITY_COLORS)).size).toBe(4);
  });

  it("falls back to the info tone for unexpected levels", () => {
    expect(severityColor(0)).toBe(THEME.info);
    expect(severityColor(9)).toBe(THEME.info);
    expect(severityLabel(2)).toBe("Weather warning");
    expect(severityLabel(99)).toBe("Weather warning");
  });

  it("builds a match expression keyed on the feature level", () => {
    const expression = severityColorExpression();
    expect(expression[0]).toBe("match");
    expect(expression[1]).toEqual(["get", "level"]);
    expect(expression).toContain(THEME.warningLevel4);
  });
});

describe("counts", () => {
  it("lists only non-zero levels, hardest first", () => {
    expect(severityCounts({ "1": 0, "2": 613, "3": 162, "4": 14 })).toEqual([
      { level: 4, count: 14 },
      { level: 3, count: 162 },
      { level: 2, count: 613 },
    ]);
  });

  it("survives missing counts", () => {
    expect(severityCounts(undefined)).toEqual([]);
    expect(severityCounts({})).toEqual([]);
  });
});

describe("validity hint", () => {
  const now = new Date("2026-11-21T10:00:00Z");

  it("says when a warning expires", () => {
    expect(validityHint("2026-11-21T10:00:00Z", now)).toBe("expired");
    expect(validityHint(null, now)).toBe("");
    expect(validityHint("not a date", now)).toBe("");
  });

  it("uses clock time for same-day endings and a date otherwise", () => {
    const sameDay = validityHint("2026-11-21T18:30:00Z", now);
    expect(sameDay).toMatch(/^until \d{2}:\d{2}$/);
    const otherDay = validityHint("2026-11-23T06:00:00Z", now);
    expect(otherDay).toMatch(/^until .*\d{1,2} Nov/);
  });
});

describe("summary", () => {
  it("names the worst active level", () => {
    expect(warningsSummary(0, 0)).toBe("No active warnings");
    expect(warningsSummary(3, 2)).toBe("3 warnings");
    expect(warningsSummary(12, 3)).toContain("severe level");
    expect(warningsSummary(789, 4)).toContain("extreme level");
  });
});

describe("popup html", () => {
  it("escapes every string it renders", () => {
    const html = warningPopupHtml({
      level: 4,
      label: "Extreme weather warning",
      headline: "<script>alert(1)</script>",
      area: "Kreis & Co",
      count: 2,
      from: "2026-11-21T08:00:00Z",
      to: "2026-11-21T18:00:00Z",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Kreis &amp; Co");
    expect(html).toContain(THEME.warningLevel4);
    expect(html).toContain("2 warnings");
  });

  it("escapes quotes and ampersands in helpers", () => {
    expect(escapeHtml('a "b" & <c>')).toBe("a &quot;b&quot; &amp; &lt;c&gt;");
  });
});
