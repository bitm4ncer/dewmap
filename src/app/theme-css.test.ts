import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

interface Block { selector: string; body: string }
const blocks: Block[] = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ selector: m[1].trim(), body: m[2] }))
  .filter((b) => !b.selector.startsWith("%"));

const declarations = blocks.flatMap((b) =>
  b.body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(":");
    return { selector: b.selector, prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
  }),
);

describe("flat CSS invariants", () => {
  it("has no visible borders", () => {
    const bad = declarations.filter(
      (d) => /^border(-(top|right|bottom|left))?$/.test(d.prop) && !/^(0|none)\b/.test(d.value),
    );
    expect(bad).toEqual([]);
  });

  it("has no elevation shadows", () => {
    const allowed = /live-location-dot|ui-status-dot|tl-dot|focus-visible|:focus/;
    const bad = declarations.filter((d) => {
      if (d.prop !== "box-shadow" || allowed.test(d.selector)) return false;
      const layers = d.value.split(/,(?![^(]*\))/);
      return layers.some((l) => !l.trim().startsWith("0 0 0"));
    });
    expect(bad).toEqual([]);
  });

  it("keeps geolocate icons dark on the accent fill", () => {
    const rule = blocks.find((b) => b.selector.includes("geolocate-active .maplibregl-ctrl-icon"));
    expect(rule?.body).toContain("brightness(0)");
  });

  it("keeps search focus soft and free of an inner ring", () => {
    const pill = blocks.find((b) => b.selector === ".ui-search-pill:focus-within");
    expect(pill?.body).toContain("var(--accent-soft)");
    expect(pill?.body).not.toContain("0 0 0 2px var(--surf-0)");
    expect(css).toContain(".ui-search-pill input:focus-visible");
  });

  it("keeps the focus ring visible inside clipped containers", () => {
    for (const sel of [".hud-tab-row:focus-within", ".hud-basemap-switch:focus-within", ".ui-search-dropdown:focus-within"]) {
      expect(css).toContain(sel);
    }
  });

  it("uses a two-ring focus indicator", () => {
    expect(css).toContain("0 0 0 2px var(--surf-0)");
    expect(css).toContain("0 0 0 4px var(--accent)");
    expect(css).not.toContain("outline: 2px solid var(--accent)");
  });

  it("has glass with blur, and a solid mobile sheet", () => {
    expect(css).toContain("--glass:");
    expect(css).toContain("--glass-strong:");
    expect(css.match(/backdrop-filter:\s*blur/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(css).not.toContain("--hairline");
    expect(css).not.toContain("--shadow-float");
    expect(css).not.toContain("--shadow-modal");
  });

  it("has no legacy hud aliases or pane tints", () => {
    expect(css).not.toMatch(/--hud-(surface|text|accent|border|warn|danger)/);
    expect(css).not.toContain("[data-pane=");
  });

  it("keeps mobile form text at 16px to stop focus zoom", () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*?input:not\(\[type="range"\]\)[\s\S]*?font-size: 16px !important/);
  });

  it("lets the drag height override every snap state", () => {
    const stateRules = blocks.filter((b) => b.selector.includes("data-sheet-state="));
    expect(stateRules.every((b) => !/(^|;)\s*height:/.test(b.body))).toBe(true);
    expect(css).toContain("height: var(--sheet-h, var(--sheet-base))");
  });

  it("keeps the mobile sheet solid", () => {
    const sheet = blocks.filter((b) => b.selector.includes(".hud-bottom-sheet"));
    expect(sheet.some((b) => b.body.includes("var(--surf-0)"))).toBe(true);
    expect(sheet.some((b) => b.body.includes("backdrop-filter"))).toBe(false);
  });

  it("uses the warm locator only for own position", () => {
    const users = blocks.filter((b) => b.body.includes("var(--locator)"));
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((b) => /live-location|user-location-accuracy|map-edge-hint/.test(b.selector))).toBe(true);
  });

  it("pulses the locator slowly to 1.5", () => {
    expect(css).toContain("live-location-pulse 2.6s");
    expect(css).toMatch(/@keyframes live-location-pulse \{[\s\S]*?scale\(1\.5\)/);
  });

  it("keeps row separators out of the UI", () => {
    expect(css).not.toMatch(/\.ui-row\s*\+\s*\.ui-row\s*\{[^}]*border/);
    expect(css).not.toContain(".ui-divider");
  });
});
