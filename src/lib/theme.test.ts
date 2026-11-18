import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME, VIA_PALETTE } from "./theme";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const manifest = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");

function token(name: string): string {
  const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`missing token ${name}`);
  return m[1].trim();
}
function toRgb(value: string): [number, number, number] {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgba = value.match(/rgba?\(([^)]+)\)/);
  if (!rgba) throw new Error(`unsupported color ${value}`);
  const [r, g, b] = rgba[1].split(",").map((v) => parseFloat(v));
  return [r, g, b];
}
function lum([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(toRgb(a)), lum(toRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function over(glass: string, bg: string): string {
  const parts = glass.match(/rgba\(([^)]+)\)/)![1].split(",").map((v) => parseFloat(v));
  const a = parts[3];
  const [gr, gg, gb] = toRgb(glass);
  const [br, bg2, bb] = toRgb(bg);
  const mix = (g: number, b: number) => Math.round(a * g + (1 - a) * b);
  return `rgb(${mix(gr, br)},${mix(gg, bg2)},${mix(gb, bb)})`;
}

const PAIRS: [string, string, string][] = [
  ["--bg", "#121619", THEME.bg],
  ["--surf-0", "#161B1E", THEME.surface0],
  ["--surf-1", "#1B2125", THEME.surface1],
  ["--surf-2", "#222A2F", THEME.surface2],
  ["--surf-3", "#2B3439", THEME.surface3],
  ["--ink", "#E9EEF0", THEME.ink],
  ["--ink-dim", "#A7B4BA", THEME.inkDim],
  ["--ink-mute", "#909EA5", THEME.inkMute],
  ["--accent", "#8DACBB", THEME.accent],
  ["--accent-ink", "#0F1416", THEME.accentInk],
  ["--accent-soft", "rgba(141,172,187,.14)", THEME.accentSoft],
  ["--accent-strong", "rgba(141,172,187,.28)", THEME.accentStrong],
  ["--glass", "rgba(14,18,21,.84)", THEME.glass],
  ["--glass-strong", "rgba(14,18,21,.92)", THEME.glassStrong],
  ["--warn", "#D8A25F", THEME.warn],
  ["--danger", "#DE8A7E", THEME.danger],
  ["--info", "#8FBCDE", THEME.info],
  ["--locator", "#E4574A", THEME.locator],
  ["--map-casing", "#0B0E10", THEME.casing],
];

describe("Graphite tokens", () => {
  it.each(PAIRS)("defines %s as %s", (name, value) => {
    expect(token(name).toLowerCase()).toBe(value.toLowerCase());
  });

  it("mirrors every CSS token in THEME", () => {
    const values = new Set(Object.values(THEME).map((v) => v.toLowerCase()));
    for (const [, value] of PAIRS) {
      expect(values.has(value.toLowerCase())).toBe(true);
    }
  });

  it("keeps text AA on solid surfaces", () => {
    expect(contrast(THEME.inkMute, THEME.surface2)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(THEME.inkMute, THEME.surface3)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(THEME.inkDim, THEME.surface1)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps accent text legible on accent fill", () => {
    expect(contrast(THEME.accentInk, THEME.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(THEME.white, THEME.accent)).toBeLessThan(3); // why white is banned
  });

  it("keeps glass readable over a white tile, and bans ink-mute there", () => {
    const composite = over(THEME.glass, "#FFFFFF");
    expect(contrast(THEME.inkDim, composite)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(THEME.accent, composite)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(THEME.inkMute, composite)).toBeLessThan(4.5);
  });

  it("remove the old warm language", () => {
    expect(css.toLowerCase()).not.toContain("d8ef6a");
    expect(css.toLowerCase()).not.toContain("f4f3ea");
    expect(css).not.toMatch(/--hue-(lime|sage|cream|olive)/);
  });

  it("themes the installed-app chrome", () => {
    expect(manifest).toContain('background_color: "#121619"');
    expect(manifest).toContain('theme_color: "#121619"');
  });

  it("ships six cool route tones", () => {
    expect(VIA_PALETTE).toEqual([
      "#7E8F9A", "#8FA89A", "#9AA3B8", "#A79A8F", "#8FA6B5", "#B3A6B0",
    ]);
  });
});
