# Polish — /settings (credentials modal), after fix

- Route: `/?settings=1` (deep link in `src/app/page.tsx`)
- Viewports: 390x844, 1440x900 · Appearance: dark (the app has no light theme)
- Engine: chromium. Headless Chromium has no WebGL here, so the map never initialised;
  anything behind the modal is `unverified-visual`.
- Reflow: no horizontal scroll at 320 px. At 320x640 the dialog overflows by 53 px and
  scrolls internally — the content no longer fits a 320x640 screen.

## Delta (before -> after)

| Metric | Before | After |
| --- | --- | --- |
| Findings | 16 | 13 |
| P0/P1 | 2 | 0 |
| axe violations | 3 (1 critical, 1 serious, 1 moderate) | 1 (moderate) |
| Modal radii | 999px, 9999px, calc(infinity), 10px | 999px, 10px |
| Action heights | 44, 36, 26 | 44, 44, 36 |
| `show` label | lowercase | sentence case |

Remaining 13 findings are the known noise: 7x `vh-unit` (the shell is `fixed inset-0`),
3x `type-outlier` (the deliberate 16 px mobile input rule and the 13 px Cancel label),
`#_r_0_`, and one `axe:region` (moderate) from the missing `main` landmark.

## Applied

1. Link gets `underline underline-offset-2` — WCAG 1.4.1. axe `link-in-text-block` gone.
2. Cancel raised to 44 px (`inline-flex min-h-11 items-center justify-center`), `show` to
   36 px (`h-9`), so all three footer/field actions align.
3. Radii use the existing tokens: dialog `--r-sheet` (24 -> 20 px), all pills `--r-pill`
   (11 raw `999px` and 14 raw `9999px` in `globals.css` replaced by the token).
4. Focus returns to the trigger after close (`src/app/page.tsx`), with a fallback to
   `[aria-label="Open settings"]` for browsers that do not focus buttons on click.
5. Description split into a lead sentence plus a two-item list (OAuth client, type and
   web origins) — no more mid-constraint wrap at 1440.
6. Dead `text-[14px]` removed from both inputs; `.ui-input` (13.5 px) and the 16 px mobile
   rule remain the single source.
7. `Show`/`Hide` capitalised; aria-labels unchanged.
8. Secret field placeholder added, then shortened to `Your client secret` because the
   `sh-…` form collided with the `Show` chip at 390 px.

## Verification

- `npm test` 417 passed / 53 files.
- `npm run lint` clean.
- `tsc --noEmit`: no errors in the changed files. `src/lib/poi/poiClusterData.test.ts`
  still has 5 errors from the in-progress POI work in the tree.
- Focus return is implemented and typechecks, but was not exercised by a real gear click:
  the gear lives in sidebar -> History -> Snapshots, and the map cannot initialise without
  WebGL in headless Chromium, so that HUD never renders. Verify on a real browser.

## Backlog (unchanged, out of scope)

- P1 map shell: `.maplibregl-ctrl-geolocate` has no accessible name (critical in the dev
  overlay, absent in the last two runs — verify on a machine with WebGL).
- P2 map shell: no `main` landmark.
- P3: hardcoded `rgba(241,240,232,.06)` / `rgba(236,128,115,.08)` hover fills instead of
  `--ink`/`--danger` tints.
