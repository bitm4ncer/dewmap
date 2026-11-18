# UI & UX rework — Graphite flat theme

Date: 2026-11-18
Status: awaiting approval
Demo: `docs/theme-demo/index.html`

## Intent

BiosphereOne currently ships a warm near-black UI with a lime accent,
hairline borders, glows and a logo in the top bar. The goal is one
coherent, quiet, modern flat system across the whole product:

- cool grey surfaces ("Graphite")
- one pigeon blue/grey accent
- no borders, no shadows — hierarchy only through surface steps,
  transparency and blur
- the logo disappears from the UI
- map markers, routes, controls and indicators use the same palette

The map itself (satellite imagery) stays photographic; the theme owns the
chrome around it and every vector overlay drawn on top.

## Goals

1. Replace the warm olive/lime token set with the Graphite token set.
2. Remove every hairline border, divider and shadow from UI chrome.
3. Make every button, toggle, slider, input, chip, tab, badge and row
   follow the new system — no local one-offs left.
4. Theme all MapLibre paint colors that are currently hardcoded (rail
   layers, sector outline, landmarks, route/transit/walk lines, waypoints,
   search pin).
5. Remove the logo from the top bar and let search take the space.
6. Keep the UI accessible: AA contrast, visible keyboard focus without
   borders, reduced-motion support.
7. Keep the app building and shipping as a static export.

## Non-goals

- No light theme, no theme switch, no per-pane color identity. One theme.
- No layout or navigation changes (panes, sheet, panel width stay).
- No recoloring of the scientific data legends (NDVI, WorldCover, Natura
  2000 class colors). Those are data semantics, not chrome.
- No tinting or recoloring of satellite raster tiles.
- No new fonts, icon set, or animation language.
- No new features; this is presentation only.

## Anti-goals

- A UI that is technically themed but still shows borders, dividers or
  glows.
- Flatness bought with unreadable low-contrast labels.
- A single accent smeared over every selected row so the interface turns
  into a blue wall.
- Mixed old/new styles shipped pane by pane.

## Constraints

- Next.js 16 static export, React 19, Tailwind 4, MapLibre GL 5.
- All tokens live in `src/app/globals.css`; components use the `var(--…)`
  tokens or Tailwind arbitrary values that reference them.
- **MapLibre paint values are JS strings** and cannot read CSS custom
  properties. A TS mirror of the map-relevant tokens is required.
- No emojis anywhere (`npm run check:no-emoji`).
- `prefers-reduced-motion: reduce` must keep working.
- The UI has to remain legible over bright satellite imagery.

## Approaches considered

**A. Token-first, one coherent sweep (chosen).** Replace the token block and
the shared primitives in `globals.css`, add a TS token mirror for MapLibre,
then sweep the components and finally the map layers in one branch. One
visual QA pass, one consistent result. Cost: a large diff.

**B. Pane by pane.** Recolor Map, then Routes, then Biosphere, then
History. Lower per-step risk, but the shipped app shows two visual
languages for the duration, and borders have to be removed in every pane
separately anyway. Rejected: the brief explicitly asks for one system.

**C. Swap CSS variables only.** Fastest, but leaves 133 border
declarations and every shadow in place. It cannot deliver "keine Borders".
Rejected.

## Design

### Surface ramp

Five steps, no lines between them:

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#121619` | page / map letterbox |
| `--surf-0` | `#161B1E` | shell, sheet body |
| `--surf-1` | `#1B2125` | cards, panels, list containers |
| `--surf-2` | `#222A2F` | controls, inputs, chips, secondary buttons |
| `--surf-3` | `#2B3439` | hover, pressed, track, thumb wells |

Rules: a surface may only contain one step up/down. Interactive elements
sit on `surf-2`; hover moves to `surf-3`; selected is `accent-soft` with
`accent` text. No element gets a border, ring or divider to separate it
from its parent — spacing and one ramp step do that.

### Ink and accent

| Token | Value | Contrast check |
|---|---|---|
| `--ink` | `#E9EEF0` | 13.9:1 on s1 |
| `--ink-dim` | `#A7B4BA` | 7.7:1 on s1 |
| `--ink-mute` | `#909EA5` | 5.9:1 on s1, 5.3:1 on s2, 4.6:1 on s3 |
| `--accent` | `#8DACBB` | 6.8:1 on s1 |
| `--accent-ink` | `#0F1416` | 7.6:1 on accent |
| `--accent-soft` | `rgba(141,172,187,.14)` | selected fills |
| `--accent-strong` | `rgba(141,172,187,.28)` | focus glow, halos |
| `--warn` | `#D8A25F` | 7.2:1 on s1 |
| `--danger` | `#DE8A7E` | 6.2:1 on s1 |
| `--info` | `#8FBCDE` | 8.1:1 on s1 |
| `--locator` | `#E4574A` | own position only |

`--locator` is the **only warm hue in the product** and is reserved
exclusively for the user's own position marker. No other map dot, route,
marker or indicator may use it. `--danger` stays for error text, icons and
badges but is never rendered as a filled point.

`ink-mute` is deliberately lighter than the demo's original `#7A888F`:
that value failed AA on `surf-2` and on hovered rows (`surf-3`) for
9–11px labels.

Text on an accent fill is always `--accent-ink`; white on the accent is
2.4:1 and is forbidden.

### Glass and blur

Only for chrome that floats over the map:

| Token | Value |
|---|---|
| `--glass` | `rgba(14,18,21,.84)` |
| `--glass-strong` | `rgba(14,18,21,.92)` |

Applied with `backdrop-filter: blur(18px) saturate(1.08)` (strong:
`blur(22px)`). Applies to: top bar search pill, basemap segmented control,
map controls, desktop drawer, navigation overlay, toasts, map popups.
Static in-panel cards use solid `surf-1` — no blur inside blur. The
mobile sheet is solid `surf-0`, because it is a full-height reading
surface. Its peek/half/full states can be changed by a vertical swipe on
the sheet header (grabber and tab row), or by pulling down from the top of
the panel body: at least 10 px of clearly vertical movement drags the
sheet; horizontal movement remains a tab tap. A completed drag never falls
through as a click on the tab underneath.
surface, not a floating control.

**Text over glass.** The values above are the worst case: glass at `.84`
over a white tile composites to about `#35393C`. There `ink` is 9.8:1,
`ink-dim` 5.4:1 and `accent` 4.8:1, but `ink-mute` is only 4.0:1.
Therefore: **no `ink-mute` text on glass.** Primary text uses `ink`,
secondary text, placeholders and attributions use `ink-dim`. `ink-mute`
is only allowed inside solid `surf-1`/`surf-2` containers. This keeps AA
without turning the glass into an opaque panel.

### Removed

Delete the following tokens and all uses: `--hairline`,
`--hairline-strong`, `--shadow-float`, `--shadow-modal`, `--hue-lime`,
`--hue-sage`, `--hue-cream`, `--hue-olive`, `[data-pane]` tints,
`.pane-tape`, `.hud-scanlines`, corner-mark spans/classes, all
`--hud-border*` aliases. Replace with ramp + `accent-soft` + glass.

### Radii, type, motion

- Radii unchanged: card 14–16, sheet 24, button 10–12, pill 999. Pick
  14/20/10.
- Type unchanged (Geist sans/mono). Kickers 9–10px uppercase, tracking
  `.13em`, `ink-mute`. Body 11.5–13px. Numerals/coordinates in mono.
- Motion unchanged (`--dur-fast/base/slow`, `--ease`). No shadows in
  transitions; only background/color/opacity/transform.

### Focus

Focus is a solid 3:1+ indicator, not a tinted halo: two stacked rings.

```css
outline: none;
box-shadow: 0 0 0 2px var(--surf-0), 0 0 0 4px var(--accent);
```

The dark inner ring separates the accent ring from accent-filled primary
buttons; the accent ring measures 6.1:1 on `surf-2` and 4.8:1 over glass
on a white tile. `--accent-strong` stays a fill/halo token and is never
the sole focus indicator. Applies to every focusable element, including
inputs and map control buttons.

### Control specs

| Control | Rest | Hover | Active/Selected | Disabled |
|---|---|---|---|---|
| Primary button | accent fill, accent-ink text | accent + 8% white | scale .98 | opacity .4 |
| Secondary button | surf-2, ink-dim | surf-3, ink | — | opacity .4 |
| Icon button | surf-2 (glass over map) | surf-3 | accent-soft + accent | opacity .4 |
| Switch | track surf-3, thumb surf-1 | — | track accent, thumb accent-ink | opacity .4 |
| LED toggle | surf-3, pip ink-mute | — | accent, pip accent-ink right-aligned | opacity .4 |
| Slider | track surf-3, fill accent, thumb ink | thumb grows 1px | — | opacity .4 |
| Input | surf-2, no border | — | focus glow | opacity .4 |
| Chip | surf-2, ink-dim | surf-3, ink | accent-soft + accent | opacity .4 |
| Segmented (over map) | glass container, ink-dim | — | accent fill, accent-ink | — |
| Segmented (in panel) | surf-2 container | — | surf-1 + ink, or accent-soft + accent | — |
| Badge | surf-2, ink-dim | — | tone fills via color-mix 15% | — |
| List row | transparent | surf-2 | accent-soft + accent title | opacity .4 |
| Tab (pane) | transparent, ink-mute | surf-2, ink | accent-soft, accent icon+label | — |

Pane tabs lose their per-pane identity dots; all panes share the accent.

### Logo removal

- Delete the `<img className="ui-logo">` in `Map.tsx` and the `.ui-logo`
  rules.
- Delete `ICON_BASE_PATH` if it becomes unused.
- Keep `src/app/icon.svg`, `favicon.ico`, `apple-icon.png` and
  `manifest.ts` icons: these are the installed-app icon, not UI chrome.
- Top bar starts with the search pill; on desktop it grows to its existing
  560px max and stays left-aligned.

### Map and indicators

Create `src/lib/theme.ts` exporting the map-relevant colors (hex strings
matching the CSS tokens), plus a unit test that reads `globals.css` and
asserts each value is present, so CSS and TS cannot drift silently.

- **Casing** under every line/circle: `#0B0E10`.
- **Sector outline**: accent, 2px, opacity .9. No fill.
- **Search pin**: accent fill, `--surf-0` inner dot, dark drop shadow for
  legibility. Hover scale 1.06.
- **Live location marker (own position)**: fill `--locator` `#E4574A`,
  white ring, dark drop shadow, heading cone in `--locator` at 55%
  opacity, and a constant-size heading arrow above the dot (locator fill,
  white casing) that appears once a compass heading exists. Accuracy circle
  `--locator` at 16%. Slow, subtle pulse: scale
  1 → 1.5 with opacity .3 → 0 over 2.6s, `prefers-reduced-motion`
  respected. This is the only warm-red point in the UI.
- **Rail**: rail `#8DACBB`, light rail `#A9C3CF`, tram `#7E9FB0`, narrow
  gauge `#9DB0A8`, stations accent, labels `--ink` with `#0B0E10` halo.
- **History landmarks**: Wikidata `#C08FA3` (dusty rose), OSM `#7FB3C4`
  (steel teal), labels `--ink`.
- **Hiking routes**: start accent, end `--warn`; alternative/via palette
  becomes six desaturated cool tones:
  `#7E8F9A`, `#8FA89A`, `#9AA3B8`, `#A79A8F`, `#8FA6B5`, `#B3A6B0`.
  Keeps routes distinguishable without escaping the theme. In the Routes
  pane a selected candidate card uses the list-row treatment (accent-soft
  fill, accent title) and shows its route color as an 8px dot; no card is
  flooded with its route color. The elevation chart strokes with the
  card's `currentColor`. Via-waypoint chips use the same six tones and
  drop the generated pastel/glow palette.
- **Planner**: car route accent, transit `--info`, walk `--ink-dim`
  dashed, waypoints accent with dark casing, labels `--ink`.
- **Live-timeline scrubber dots**: accent for available, accent-soft for
  unavailable, accent + halo for the active day. No lime.
- **Snapshot calendar cloud-cover dots stay semantic**: accent = clear,
  `--warn` = partly, `--danger` = cloudy, with the existing three-state
  legend. The lime is replaced, the encoding is not.
- **Attribution / scale / MapLibre chrome**: glass background, ink-dim
  text, no border.

### Data legends stay semantic

NDVI ramps, ESA WorldCover classes, Natura 2000 categories and the NO2 /
forest-loss gradients keep their established colors. Only their container
chrome (radius, background, label color) follows the theme. Reason:
users compare these against external references.

### Basemaps

Keep the catalog. Defaults stay `esri-imagery` (photo) and
`streets-dark` (vector). No raster tinting. Third-party vector styles
(CARTO streets/positron/voyager, OHM history, EOX terrain, OpenTopoMap)
are **not** restyled: they load from remote `style.json` files and
surgery on them is fragile and out of scope. They stay user-selectable
alternatives; the themed default is `streets-dark`, and our own overlays
keep the theme on top of every basemap.

## Component sweep

Must be checked and converted:

- `src/app/globals.css` — tokens + all primitives (~190 selectors, 133
  border declarations)
- `src/components/Map.tsx` — top bar, panel, sheet, sheet tabs, panel
  tabs, drawer reopen, popups, debug HUD, basemap switch, timeline panel,
  map readout, search marker
- `src/components/hud/*` — HudPanel, all panes, DataSourcesPanel,
  HistoryTimeline, LedToggle
- `src/components/planner/*` — CarPanel, TransitPanel, PlacePicker and
  `usePlannerLayers`
- `src/components/hiking/*` — `useHikingLayers`, ElevationChart
- `src/components/*` — SearchBox, PaneToggle, SidebarToggle, SettingsGear,
  CredentialsModal, NavigationOverlay
- `src/app/layout.tsx` — `themeColor` becomes `#121619`; manifest and
  `appleWebApp` status bar stay

## Verification

- `npm run typecheck`, `npm run lint`, `npm run test`,
  `npm run check:no-emoji`, `npm run build`
- Browser pass at 1440×900 and 390×844:
  - no console errors
  - **DOM audit**: no element in chrome has `border-width > 0` or a
    `box-shadow` other than the focus/halo tokens
  - contrast spot-check on `ink-mute` labels over `surf-1/2`
  - focus visible via keyboard on every control type
- Manual flows: search + pin, basemap switch (photo/hybrid/vector),
  pane switching, every layer toggle, opacity sliders, timeline start /
  select / clear, route planning (car + transit), navigation overlay,
  credentials modal, mobile sheet open/close
- Screenshots of Map, Routes, Biosphere and History panes attached to the
  PR.

## Rollout

One branch, staged commits:

1. Tokens + primitives in `globals.css`; remove borders/shadows.
2. Top bar + logo removal + search.
3. Panel, sheet, tabs, rows, controls.
4. Pane-specific components (Map, Routes, Biosphere, History, planner,
   hiking).
5. MapLibre paint tokens + `src/lib/theme.ts` + drift test.
6. Verification pass and screenshots.

## Acceptance criteria

- No visible border or divider anywhere in the UI, at any breakpoint.
- One accent; selected/active states are calm, primary actions are the
  only solid accent fills besides over-map chrome.
- All text passes AA at its rendered size.
- Map overlays, markers and indicators use the theme tokens.
- The own-position marker is the only warm-red point in the UI; it pulses
  slowly and no other dot or marker uses `--locator`.
- Logo gone; search is the first element in the top bar.
- No emoji; reduced motion still honored.
- App builds and deploys as before.

## Left to the builder

- Whether to extract shared React primitives (`Button`, `Row`, `Switch`)
  or keep utility classes — no product impact.
- Exact commit split inside the staged sequence.
- Whether the demo's optional "Crisp" ramp ships as a CSS-only variant.
  Default is the Soft ramp above.
- Minor icon updates where a control's meaning is clearer with a different
  glyph.
