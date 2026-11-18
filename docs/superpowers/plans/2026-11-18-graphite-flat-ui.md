# Graphite Flat UI Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the warm lime UI with one flat, borderless Graphite theme — five surface steps, one pigeon-blue accent, glass over the map, a single warm-red own-position marker, and no logo.

**Architecture:** CSS custom properties in `src/app/globals.css` remain the single styling source; a new `src/lib/theme.ts` mirrors the map-relevant values for MapLibre paint, guarded by a drift test. Work proceeds token → CSS primitives → shell → components → map layers → panes → cleanup, so every commit ships a working app.

**Tech Stack:** Next.js 16 static export, React 19, Tailwind 4, MapLibre GL 5, Zustand, Vitest (node environment, `src/**/*.test.ts` only).

**Spec:** `docs/superpowers/specs/2026-11-18-ui-theme-rework-design.md`
**Visual reference:** `docs/theme-demo/index.html`

---

## Global Constraints

- Token values are exact: `--bg #121619`, `--surf-0 #161B1E`, `--surf-1 #1B2125`, `--surf-2 #222A2F`, `--surf-3 #2B3439`, `--ink #E9EEF0`, `--ink-dim #A7B4BA`, `--ink-mute #909EA5`, `--accent #8DACBB`, `--accent-ink #0F1416`, `--accent-soft rgba(141,172,187,.14)`, `--accent-strong rgba(141,172,187,.28)`, `--warn #D8A25F`, `--danger #DE8A7E`, `--info #8FBCDE`, `--locator #C98274`, `--glass rgba(14,18,21,.84)`, `--glass-strong rgba(14,18,21,.92)`, `--map-casing #0B0E10`.
- No visible borders anywhere in chrome: no `border` with a non-zero width, no divider lines, no elevation shadows. Hierarchy = surface ramp + transparency + blur. Map marker rings are `box-shadow` rings, never borders.
- Shadows are allowed only as `0 0 0` rings for focus/selection, and on map markers for legibility.
- `ink-mute` never appears on glass; on glass use `ink` / `ink-dim`.
- Text on an accent fill is always `--accent-ink`; white on accent is forbidden.
- `--locator` is used only by the own-position marker and its cone/accuracy circle.
- Logo removed from the UI; `src/app/icon.svg`, `favicon.ico`, `apple-icon.png`, `manifest.ts` icons stay.
- No emojis (`npm run check:no-emoji`).
- `prefers-reduced-motion` keeps working.
- Data legends (NDVI, WorldCover, Natura 2000, NO2, forest loss) keep their semantic colors; only their chrome is themed.
- Third-party basemap styles are not restyled. Default vector basemap stays `streets-dark`.
- Tests live under `src/**/*.test.ts` (Vitest `node` environment, `fs` available).

**Branch:** create `feat/graphite-flat-ui` from current HEAD before Task 1.
**Dev server:** already runs at `http://localhost:3100`; otherwise `npm run dev`.

---

## Review Focus

1. **Glass over a white/cloud tile** — controls must still read; text on glass is `ink`/`ink-dim`, never `ink-mute`. Pinned by the glass-contrast test in Task 1 and the glass rules in Task 2.
2. **Focus on an accent-filled button** — a single accent ring disappears; the two-ring focus rule must keep a dark separator. Pinned by the global focus rule assertion in Task 2.
3. **Long panels without dividers** — rows must remain scannable through spacing, hover fills and selected fills. Pinned by Task 2 row/list rules and the pane browser pass in Task 6.
4. **Mobile sheet over the map** — it is a reading surface, so it must stay solid `surf-0`, while desktop chrome uses glass. Pinned by the sheet assertion in Task 2.
5. **Map on bright imagery** — routes, markers and labels need dark casing and AA-safe text. Pinned by the map-token test in Task 5 and the bright-tile pass in Task 7.

---

## File Structure

- `src/lib/theme.ts` — new: `THEME` object, the only JS source of map/token colors; also exports `VIA_PALETTE`.
- `src/lib/theme.test.ts` — new: token drift, contrast, forbidden-token checks.
- `src/app/theme-css.test.ts` — new: borderless/shadowless/glass/focus invariants parsed from `globals.css`.
- `src/components/shell.test.ts` — new: logo-related strings absent.
- `src/components/chrome.test.ts` — new: no corner marks, pane tape, scanlines, Tailwind borders in components.
- `src/lib/map-theme.test.ts` — new: every hex in map-layer files comes from `THEME`.
- `src/components/hiking/routes.test.ts` — new: generated pastel palette and route-color fills are gone.
- `src/app/globals.css` — tokens and every UI primitive.
- `src/app/layout.tsx` — `themeColor`.
- `src/components/Map.tsx` — shell, top bar, pane tabs, popups, map controls, search pin, paint colors.
- `src/components/hud/*`, `src/components/planner/*`, `src/components/hiking/*`, `src/components/*.tsx` — component sweep.

---

### Task 1: Theme tokens, TS mirror, drift and contrast tests

**Files:**
- Create: `src/lib/theme.ts`
- Create: `src/lib/theme.test.ts`
- Modify: `src/app/globals.css:40-131`
- Modify: `src/app/layout.tsx:29`
- Modify: `src/app/manifest.ts`

**Interfaces:**
- Produces: `THEME` (as const) with keys `bg, surface0, surface1, surface2, surface3, ink, inkDim, inkMute, accent, accentInk, accentSoft, accentStrong, warn, danger, info, locator, glass, glassStrong, casing, white`; `VIA_PALETTE: readonly string[]` (six tones). Later tasks import both.

- [ ] **Step 1: Write the failing test** — `src/lib/theme.test.ts`

```ts
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
  const [, a] = glass.match(/rgba\(([^)]+)\)/)![1].split(",").map((v) => parseFloat(v));
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
  ["--locator", "#C98274", THEME.locator],
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
    expect(manifest).toContain('"background_color": "#121619"');
    expect(manifest).toContain('"theme_color": "#121619"');
  });

  it("ships six cool route tones", () => {
    expect(VIA_PALETTE).toEqual([
      "#7E8F9A", "#8FA89A", "#9AA3B8", "#A79A8F", "#8FA6B5", "#B3A6B0",
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/theme.test.ts`
Expected: FAIL — cannot resolve `./theme`.

- [ ] **Step 3: Create `src/lib/theme.ts`**

Export `THEME` with exactly the values from Global Constraints (`surface0` … `surface3`, `accentSoft`/`accentStrong` as `rgba(...)`, `glass`, `glassStrong`, `casing`, `white: "#FFFFFF"`), `as const`, and
`export const VIA_PALETTE = ["#7E8F9A", "#8FA89A", "#9AA3B8", "#A79A8F", "#8FA6B5", "#B3A6B0"] as const;`
Add a header comment: this file mirrors the CSS root tokens; `theme.test.ts` guards drift.

- [ ] **Step 4: Replace the root token block and pane tints in `globals.css`**

Keep the existing geometry/motion tokens (`--r-*`, `--ease`, `--dur-*`, `--panel-w`, z-scale, safe areas). Replace surfaces/ink/accent/warn/danger/info; add `--accent-soft`, `--accent-strong`, `--accent-ink`, `--locator`, `--glass`, `--glass-strong`, `--map-casing`. Write the rgba tokens exactly as `rgba(141,172,187,.14)`, `rgba(141,172,187,.28)`, `rgba(14,18,21,.84)` and `rgba(14,18,21,.92)` — the test compares strings. Delete `--hue-lime/sage/cream/olive` and the per-pane tint values (set every `[data-pane]` to `--pane-tint: var(--accent)`).

Keep the old structural tokens for one more task so the app still renders correctly: `--hairline: transparent`, `--hairline-strong: transparent`, `--shadow-float: none`, `--shadow-modal: none`, `--surf-glass: var(--glass)`, `--surf-glass-solid: var(--glass-strong)`. Task 2 deletes them together with their uses.

Keep the legacy block `--hud-*` **for now**, remapped to the new tokens (`--hud-border: transparent`, `--hud-surface: var(--surf-1)`, `--hud-text: var(--ink)`, …) so intermediate commits still render. Task 7 deletes it. Set every `[data-pane]` rule to `--pane-tint: var(--accent)` until Task 7 removes them.

- [ ] **Step 5: Update `layout.tsx` and `manifest.ts`**

`layout.tsx` `themeColor` becomes `#121619`. In `manifest.ts` set both
`background_color` and `theme_color` to `#121619`. Icons and the rest of
the manifest stay.

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/lib/theme.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/theme.ts src/lib/theme.test.ts src/app/globals.css src/app/layout.tsx src/app/manifest.ts
git commit -m "feat(theme): add Graphite tokens and map color mirror"
```

---

### Task 2: Borderless, shadowless CSS primitives

**Files:**
- Create: `src/app/theme-css.test.ts`
- Modify: `src/app/globals.css` (all sections, root excluded)

**Interfaces:**
- Produces: CSS classes used unchanged by components: `.hud-panel`, `.hud-label`, `.led-toggle`, `.hud-bottom-nav*`, `.hud-sheet-tabs`, `.hud-sheet-tab`, `.hud-panel-tab`, `.hud-icon-btn`, `.hud-bottom-sheet`, `.hud-handle`, `.hud-drawer-open`, `.hud-tab-row`, `.hud-tab`, `.hud-basemap-btn`, `.hud-variant-chip`, `.hud-basemap-switch*`, `.hud-btn-primary`, `.hud-btn-ghost`, `.hud-switch`, `.hud-search*`, `.hud-popup*`, `.ui-topbar`, `.ui-search-pill`, `.ui-search-dropdown`, `.ui-search-row`, `.ui-panel-header`, `.ui-panel-title`, `.ui-card`, `.ui-section`, `.ui-kicker`, `.ui-row*`, `.ui-segmented`, `.ui-seg`, `.ui-input`, `.ui-fab`, `.ui-badge`, `.ui-status-dot`, `.ui-empty`, `.ui-skeleton`, `.ui-toast`, `.glass`.

- [ ] **Step 1: Write the failing test** — `src/app/theme-css.test.ts`

```ts
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

  it("keeps the mobile sheet solid", () => {
    const sheet = blocks.filter((b) => b.selector.includes(".hud-bottom-sheet"));
    expect(sheet.some((b) => b.body.includes("var(--surf-0)"))).toBe(true);
    expect(sheet.some((b) => b.body.includes("backdrop-filter"))).toBe(false);
  });

  it("keeps row separators out of the UI", () => {
    expect(css).not.toMatch(/\.ui-row\s*\+\s*\.ui-row\s*\{[^}]*border/);
    expect(css).not.toContain(".ui-divider");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/theme-css.test.ts`
Expected: FAIL — border declarations (`.hud-panel`, `.ui-search-pill`, …) and shadow tokens are still present.

- [ ] **Step 3: Rewrite the primitives**

Rules, applied to every block in `globals.css`:

- Remove all `border`, `border-top/right/bottom/left`, `box-shadow` except the allowed rings; remove `.hud-panel::before/::after` corner pseudo-elements, `.hud-corner-*`, `.pane-tape`, `.hud-scanlines`, `.ui-divider`.
- Elevation: cards/panels `--surf-1`; controls `--surf-2`; hover/pressed `--surf-3`; selected `--accent-soft` + `--accent`; disabled `opacity: .4`.
- Rows lose dividers; use `padding: 8px 0`, and a hover fill (`background: var(--surf-2); border-radius: 8px`). `.ui-row + .ui-row` becomes spacing only.
- Glass: `.ui-search-pill`, `.ui-search-dropdown`, `.hud-basemap-switch`, `.hud-drawer-open`, `.maplibregl-ctrl-group`, `.ui-toast`, `.hud-popup .maplibregl-popup-content` get `background: var(--glass); backdrop-filter: blur(18px) saturate(1.08); -webkit-backdrop-filter: …`. Desktop drawer/sidebar gets `var(--glass-strong)` + `blur(22px)`; **`.hud-bottom-sheet` (mobile) gets solid `var(--surf-0)` and no backdrop-filter**. `.hud-sidebar .hud-panel` stays solid `var(--surf-1)`.
- Global focus rule:

```css
:where(button, a, input, select, textarea, [tabindex]):focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--surf-0), 0 0 0 4px var(--accent);
}
```

- Inputs: `background: var(--surf-2)`; focus adds the same ring, no border.
- `.ui-search-kbd`: `background: var(--surf-2)`, no border.
- MapLibre controls (attribution, scale, zoom): glass background, `ink-dim` text, no border/shadow.
- Convert the `.live-location-dot` white border into a `box-shadow` ring now (colour stays accent; Task 6 swaps it to `--locator`).
- Popups: glass-strong, no border, no shadow; radius 14.
- Keep all class names and selectors intact so components do not change in this task.
- Text on glass uses `ink` / `ink-dim` only. `ink-mute` is forbidden on any selector that also declares `backdrop-filter`.
- Radii, type scale and motion tokens stay as they are (card 14, sheet 20, button 10, pill 999; Geist family; existing durations/easing). Do not introduce a shadow to compensate for the missing border.

- [ ] **Step 4: Run the whole suite**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/theme-css.test.ts
git commit -m "feat(theme): rebuild UI primitives without borders or shadows"
```

---

### Task 3: Top bar and logo removal

**Files:**
- Create: `src/components/shell.test.ts`
- Modify: `src/components/Map.tsx:3313-3333`, `3919`
- Modify: `src/app/globals.css` `.ui-topbar`, `.ui-logo`

**Interfaces:**
- Consumes: `.ui-topbar`, `.ui-topbar--with-panel`, `.ui-search-wrap` from Task 2.
- Produces: top bar whose first child is the search wrap; `ICON_BASE_PATH` gone.

- [ ] **Step 1: Write the failing test** — `src/components/shell.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const map = readFileSync(new URL("./Map.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("shell", () => {
  it("has no logo in the top bar", () => {
    expect(map).not.toContain("ui-logo");
    expect(map).not.toContain("ICON_BASE_PATH");
    expect(css).not.toContain(".ui-logo");
  });

  it("keeps the search as the first top-bar element", () => {
    const topbar = map.slice(map.indexOf("ui-topbar"), map.indexOf("<SearchBox"));
    expect(topbar).not.toContain("<img");
    expect(topbar).not.toContain("<BasemapSwitch");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/components/shell.test.ts`
Expected: FAIL — `ui-logo` and `ICON_BASE_PATH` still exist.

- [ ] **Step 3: Implement**

Delete the logo `<img>` block and the `ICON_BASE_PATH` constant (line 3919 if unused elsewhere). Delete `.ui-logo` CSS; adjust `.ui-topbar` gap/padding so the search starts at the same 12/14px inset, and keep `.ui-topbar--with-panel` right padding. On desktop keep `.ui-search-wrap { flex: 0 1 560px }`.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/components/shell.test.ts && npm run typecheck`
Expected: PASS.
Browser: reload `http://localhost:3100`; the globe is gone, search is first, basemap switch still on the right.

- [ ] **Step 5: Commit**

```bash
git add src/components/Map.tsx src/components/shell.test.ts src/app/globals.css
git commit -m "feat(shell): remove logo and lead the top bar with search"
```

---

### Task 4: Chrome components — corner marks, tape, Tailwind borders

**Files:**
- Create: `src/components/chrome.test.ts`
- Modify: `src/components/hud/HudPanel.tsx:23-31`
- Modify: `src/components/Map.tsx:3340-3366`, `3492-3495`, `4770-4790` (DebugHud)
- Modify: `src/components/CredentialsModal.tsx:70`, `87`, `134`, `151`
- Modify: `src/components/hud/HikingPanel.tsx:925`
- Modify: `src/components/hud/DataSourcesPanel.tsx:89`
- Modify: `src/components/SettingsGear.tsx`, `src/components/SidebarToggle.tsx`, `src/components/PaneToggle.tsx` if they carry border/ring utilities

**Interfaces:**
- Consumes: `.hud-panel`, `.ui-input`, `.ui-row`, `.hud-icon-btn` from Task 2.
- Produces: no decorative chrome markup left in TSX.

- [ ] **Step 1: Write the failing test** — `src/components/chrome.test.ts`

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("./", import.meta.url).pathname;
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}
const files = walk(root).map((p) => ({ path: p, text: readFileSync(p, "utf8") }));

describe("component chrome", () => {
  it("has no corner marks, tape or scanlines", () => {
    const bad = files.filter((f) => /hud-corner|pane-tape|hud-scanlines/.test(f.text));
    expect(bad.map((f) => f.path)).toEqual([]);
  });

  it("has no Tailwind border/ring utilities", () => {
    const bad = files.filter((f) => /\bborder-[a-z0-9[]|\bborder-[trblxy]\b|\bring-\d/.test(f.text));
    expect(bad.map((f) => f.path)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/components/chrome.test.ts`
Expected: FAIL with the four current offenders.

- [ ] **Step 3: Implement**

- `HudPanel`: drop the two corner spans; keep the label row (label + spacer only).
- `Map.tsx`: remove corner spans from the rail loading pill; remove the pane-tape div; restyle `DebugHud` to `rounded-xl bg-[color:var(--surf-2)] p-2 …` with `text-[color:var(--warn)]`, deleting `border-2 border-red-500`, `bg-black/95`, `shadow-2xl`.
- `CredentialsModal`: remove `pane-tape`; replace the underlined link with `text-[color:var(--accent)] hover:opacity-80`; give both inputs `className="ui-input …"` and drop the `focus-visible:ring-*` utilities (global focus rule owns it).
- `HikingPanel:925`: replace `border-b … last:border-b-0` with `rounded-lg` + `hover:bg-[color:var(--surf-2)]`.
- `DataSourcesPanel:89`: replace `border-t … first:border-t-0` with `gap-2` spacing on the container.
- Grep for remaining `focus-visible:ring` utilities and delete them; the global rule applies.

- [ ] **Step 4: Verify**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS.
Browser: open each pane; no corner ticks, no dividers; keyboard Tab shows the two-ring focus everywhere.

- [ ] **Step 5: Commit**

```bash
git add src/components src/app
git commit -m "feat(chrome): remove decorative marks, tape and utility borders"
```

---

### Task 5: Map paint tokens, route palette, route cards

**Files:**
- Create: `src/lib/map-theme.test.ts`
- Create: `src/components/hiking/routes.test.ts`
- Modify: `src/components/Map.tsx` (paint colors, search pin SVG, sector)
- Modify: `src/components/hiking/useHikingLayers.ts`
- Modify: `src/components/planner/usePlannerLayers.ts`
- Modify: `src/components/hud/HikingPanel.tsx:21`, `346-350`, `701`
- Modify: `src/app/globals.css` `.hud-card-flat`

**Interfaces:**
- Consumes: `THEME`, `VIA_PALETTE` from Task 1; `THEME.casing` for all casings.
- Produces: `COLOR_START = THEME.accent`, `COLOR_END = THEME.warn`; `viaColor(index: number): string`; no `pastelForWaypoint`.
- Adds map-only `THEME` keys (not mirrored in CSS, so Task 1's mirror test ignores them): `lightRail: "#A9C3CF"`, `tram: "#7E9FB0"`, `narrowGauge: "#9DB0A8"`, `landmarkWikidata: "#C08FA3"`, `landmarkOsm: "#7FB3C4"`.

- [ ] **Step 1: Write the failing tests**

`src/lib/map-theme.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME } from "./theme";

const files = ["../components/Map.tsx", "../components/hiking/useHikingLayers.ts", "../components/planner/usePlannerLayers.ts"]
  .map((p) => readFileSync(new URL(p, import.meta.url), "utf8"));

const allowed = new Set(
  Object.values(THEME).filter((v) => v.startsWith("#")).map((v) => v.toLowerCase()),
);

describe("map paint colors", () => {
  it("uses only theme hexes in map-layer code", () => {
    const bad = files.flatMap((text) =>
      [...text.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0]).filter((h) => !allowed.has(h.toLowerCase())),
    );
    expect([...new Set(bad)]).toEqual([]);
  });
});
```

`src/components/hiking/routes.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("../hud/HikingPanel.tsx", import.meta.url), "utf8");
const layers = readFileSync(new URL("./useHikingLayers.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("route identity", () => {
  it("drops the generated pastel palette", () => {
    expect(panel).not.toContain("pastelForWaypoint");
    expect(layers).not.toContain("pastelForWaypoint");
  });
  it("never floods a card with its route color", () => {
    expect(css).not.toMatch(/background:\s*var\(--route-color/);
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/lib/map-theme.test.ts src/components/hiking/routes.test.ts`
Expected: FAIL — lime hexes, `pastelForWaypoint`, `--route-color` background.

- [ ] **Step 3: Replace Map.tsx paint values**

Import `THEME` and use: casing `THEME.casing` (rail casing, station stroke, label halo, rail labels); rail match: `rail: THEME.accent`, `light_rail: THEME.lightRail`, `subway: THEME.lightRail`, `tram: THEME.tram`, `narrow_gauge: THEME.narrowGauge`; station `THEME.accent`; labels `THEME.ink`; history landmarks `wikidata: THEME.landmarkWikidata`, otherwise `THEME.landmarkOsm`; landmark stroke `THEME.white`; sector outline `THEME.accent`. Search pin SVG: `fill="var(--accent)"`, inner circle `fill="var(--surf-0)"` (CSS vars work in inline SVG).

- [ ] **Step 4: Replace hiking and planner palettes**

In `useHikingLayers.ts`: delete `pastelForWaypoint`; `COLOR_START = THEME.accent`, `COLOR_END = THEME.warn`; `export function viaColor(index: number) { return VIA_PALETTE[index % VIA_PALETTE.length]; }`; replace the pastel array and every `pastelForWaypoint(...)` call with `viaColor(...)`; casings → `THEME.casing`; chip label text → `THEME.bg`.
In `usePlannerLayers.ts`: `ACCENT = THEME.accent`, `TRANSIT = THEME.info`, `WALK_COLOR = THEME.inkDim`, `INK = THEME.ink`, casings → `THEME.casing`.
In `HikingPanel.tsx`: import `viaColor` instead of `pastelForWaypoint`; line 701 and alternatives use `viaColor(index)`.

- [ ] **Step 5: Landmark legend vars**

In `globals.css` set `--landmark-wikidata: #C08FA3;` and `--landmark-osm: #7FB3C4;` so the History legend matches the map.

- [ ] **Step 6: Route cards**

`globals.css`: `.hud-card-flat[data-active="true"]` → `background: var(--accent-soft); color: var(--accent);` (delete `var(--route-color)` and the `!important`); delete the `*` color rule. In `HikingPanel` render the route color as an 8px dot in the card header (`style={{ background: routeColor }}` on a `h-2 w-2 rounded-full` span) and keep `--route-color` only as the elevation chart's `color` (currentColor).
Ensure `ElevationChart` stays `currentColor`-driven; inside an active card it now renders accent.

- [ ] **Step 7: Verify**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.
Browser: routes pane selected card is accent-soft with accent text; map alternatives use the six cool tones; rail/landmark/sector colors changed; no lime anywhere.

- [ ] **Step 8: Commit**

```bash
git add src/lib/map-theme.test.ts src/components/hiking/routes.test.ts src/components/Map.tsx src/components/hiking src/components/planner src/components/hud/HikingPanel.tsx src/app/globals.css src/lib/theme.ts
git commit -m "feat(map): theme paint colors and route identity"
```

---

### Task 6: Pane polish and own-position marker

**Files:**
- Modify: `src/app/globals.css` (live location, legends, sheet, popup, nav overlay)
- Modify: `src/components/hud/BiospherePanel.tsx` (legend chrome only)
- Modify: `src/components/hud/HistoryPanel.tsx`, `HistoryTimeline.tsx`
- Modify: `src/components/planner/CarPanel.tsx`, `TransitPanel.tsx`, `PlacePicker.tsx`
- Modify: `src/components/navigation/NavigationOverlay.tsx`
- Modify: `src/components/Map.tsx` (timeline calendar dots, timeline panel)

**Interfaces:**
- Consumes: tokens and primitives from Tasks 1–5.
- Produces: the own-position marker uses `--locator`; cloud-cover dots stay semantic.

- [ ] **Step 1: Own-position marker**

In `globals.css`: `.live-location-marker { color: var(--locator); }`, `.live-location-dot { background: var(--locator); box-shadow: 0 0 0 2.5px #fff, 0 1px 6px rgba(0,0,0,.55); }` (a ring via box-shadow, never a border), `.live-location-pulse { background: var(--locator); opacity: .3; animation: live-location-pulse 2.6s ease-out infinite; }`, `@keyframes` scale `1 → 1.5` with opacity `.3 → 0` (70% at 0), accuracy circle `background-color: var(--locator)`. The heading cone inherits `currentColor`.
Nothing else may reference `--locator` (`rg -n "locator" src` shows only these rules and `theme.ts`).

- [ ] **Step 2: Legends and panes**

- `BiospherePanel`: keep every gradient/class color literal; restyle only the containers (radius 10, `background: var(--surf-2)`, labels `ink-mute`) and the legend track (radius 999).
- `HistoryTimeline`/`HistoryPanel`: slider track `surf-3`, fill accent, active year accent; landmark legend uses `THEME.landmarkWikidata` / `landmarkOsm` via CSS (`--landmark-wikidata`, `--landmark-osm` re-pointed to the new hexes in Task 5).
- Planner panels: replace any remaining `hud-btn-*`/`ui-row` overrides that add borders; use `.ui-row`, `.ui-input`, `.hud-btn-primary` as-is; error/notice text uses `--danger` without a filled dot.
- `NavigationOverlay`: glass-strong surface, progress fill accent, turn arrow accent, close button `hud-icon-btn`.
- Timeline calendar dots in `Map.tsx` stay semantic: clear `var(--accent)`, partly `var(--warn)`, cloudy `var(--danger)`; active gets the 4px `accent-soft` halo. Live scrubber dots use accent steps.

- [ ] **Step 3: Verify visually**

Run: `npx vitest run && npm run typecheck && npm run lint`
Browser at 1440×900 and 390×844:
- own dot is the only warm-red point, pulses slowly, readable on satellite and on the bright basemap
- every pane: no borders, no dividers, rows scannable, legends intact
- mobile sheet is solid, tabs clear, close/expand visible
- navigation overlay, credentials modal, search dropdown, popups all glass with `ink`/`ink-dim` text
- keyboard focus ring visible on primary, ghost, icon, switch, slider, input

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/components
git commit -m "feat(ui): theme panes, legends and own-position marker"
```

---

### Task 7: Legacy cleanup and full verification

**Files:**
- Modify: `src/app/globals.css` (delete `--hud-*` aliases, `[data-pane]`, remaining pane tint variables)
- Modify: any component still reading removed aliases
- Create: `docs/superpowers/plans/2026-11-18-graphite-screenshots/` (screenshots, not committed if binary policy prefers; attach to PR)

**Interfaces:**
- Consumes: everything above.
- Produces: a stylesheet with no legacy aliases; verified build.

- [ ] **Step 1: Remove legacy aliases**

Delete the `--hud-*` block. Run `rg -n "hud-surface|hud-text|hud-accent|hud-border|hud-warn|hud-danger|pane-tint|data-pane" src` and replace each use with the new token or delete the rule. Delete `[data-pane="…"]` rules. Keep `data-active-pane` only if JS still needs it for orientation; if it only feeds tints, remove the attribute from `Map.tsx`.

- [ ] **Step 2: Extend the audits**

Add to `theme-css.test.ts`: `expect(css).not.toContain("--hud-")` and `expect(css).not.toContain("[data-pane=")`.
Run: `npx vitest run` — expected PASS.

- [ ] **Step 3: Full pipeline**

```bash
npm run typecheck
npm run lint
npm run test
npm run check:no-emoji
npm run build
```
Expected: all pass; static export written to `out/`.

- [ ] **Step 4: Browser audit**

At 1440×900 and 390×844, on `http://localhost:3100` (or the built export), run this in the console and expect `[]`:

```js
[...document.querySelectorAll('body *')].flatMap(el => {
  const cs = getComputedStyle(el);
  const borders = ['Top','Right','Bottom','Left'].filter(s =>
    parseFloat(cs['border'+s+'Width']) > 0 && cs['border'+s+'Style'] !== 'none');
  return borders.length ? [el.className + ' ' + borders.join(',')] : [];
})
```
Shadows are covered by the CSS unit test; do not re-check them here.

Exemptions: elements inside the map canvas, MapLibre attribution (glass), and `prefers-reduced-motion` off.

Flows: search + pin, all basemaps, pane switching, every toggle and slider, timeline start/select/clear, car + transit routing, navigation overlay, credentials modal, mobile sheet gestures.

- [ ] **Step 5: Screenshots**

Capture Map, Routes, Biosphere, History, timeline panel, mobile sheet. Attach to the PR.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(theme): remove legacy tokens and verify Graphite build"
```

---

## Self-Review Notes

- Spec coverage: tokens (T1), borderless primitives + glass + focus (T2), logo/top bar (T3), chrome markup (T4), map paint + route identity + cloud semantics (T5), panes/legends/locator + visual checks (T6), cleanup/build/audit (T7).
- The `#A9C3CF`, `#7E9FB0`, `#9DB0A8`, `#C08FA3`, `#7FB3C4` paint values must be added to `THEME` in Task 5 so `map-theme.test.ts` stays meaningful; they are map-only tokens, not UI tokens.
- `THEME.white` exists solely for landmark strokes and marker rings; it is not a UI text color.
- Task 6 intentionally keeps data-viz colors; do not "fix" them.
