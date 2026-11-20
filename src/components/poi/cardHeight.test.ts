import { describe, expect, it } from "vitest";
import { expandedCardHeight } from "./cardHeight";

describe("expandedCardHeight", () => {
  it("keeps the desktop panel below the top bar", () => {
    expect(expandedCardHeight(900, { desktop: true, peek: 88, topbar: 56 })).toBe(810);
  });

  it("stops under the search bar on a notched phone", () => {
    // 844 dvh, dock 88 + 34 inset, top bar 56 + 47 inset.
    const h = expandedCardHeight(844, { desktop: false, peek: 122, topbar: 103 });
    expect(h).toBe(607);
    expect(844 - 122 - h).toBeGreaterThanOrEqual(103);
  });

  it("keeps the 78dvh cap when there is room to spare", () => {
    expect(expandedCardHeight(844, { desktop: false, peek: 88, topbar: 56 })).toBe(658);
  });

  it("never exceeds the space between the dock and the top bar", () => {
    const h = expandedCardHeight(400, { desktop: false, peek: 122, topbar: 103 });
    expect(h).toBe(163);
  });
});
