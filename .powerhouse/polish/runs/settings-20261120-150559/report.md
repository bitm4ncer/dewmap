# Polish — /settings (credentials modal)

- Run: `settings-20261120-150559`
- Route: `/?settings=1` (deep link added in `src/app/page.tsx`, the modal is not a route)
- Viewports: 390x844, 1440x900 · Appearance: dark (the app has no light theme)
- Engine: chromium. Canvas map not inspected. Axe covers neither keyboard nor screen-reader output.
- Components: 24 · Findings: 16 (2 blocking) · Reflow at 320 px: no horizontal scroll (manual check)

The scan invents the whole page, so the map shell behind the modal contributes findings.
Only items marked *settings* below are in scope.

## Findings

| # | Sev | Rule | Where | Evidence | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 | axe:link-in-text-block | *settings* — Copernicus link in the description | Link contrast vs surrounding text 1.13:1, no underline (hover only changes opacity) | Add `underline underline-offset-2`, keep the accent colour |
| 2 | P1 | axe:button-name | out of scope — `.maplibregl-ctrl-geolocate` | critical, control has no accessible name | Separate fix in the map shell |
| 3 | P2 | consistency | *settings* — action row | Save 71x44, Cancel 73x36, show 54x26 | One secondary height (44 px on touch), give `show` 32-36 px with padding |
| 4 | P2 | consistency | *settings* — radii | Close 999px, Save/Cancel/show 9999px, inputs 10px, dialog 24px | One pill token for all pill shapes |
| 5 | P2 | accessibility | *settings* — close path | Focus drops to body after close; gear is not refocused | Keep a trigger ref and refocus on unmount |
| 6 | P2 | layout-ia | *settings* — description block | Two instructions in one 14 px paragraph; wraps mid-constraint at 1440 | Lead sentence + two-line list (type, web origins) |
| 7 | P2 | consistency | *settings* — `input.ui-input` | `text-[14px]` is dead: unlayered `.ui-input` sets 13.5 px, mobile gets 16 px via an `!important` iOS rule | Drop the class or move the size into `.ui-input` |
| 8 | P2 | axe:region | out of scope — app root | No `main` landmark | Separate fix in the shell |
| 9 | P3 | slop | *settings* — show/hide | Lowercase "show"/"hide" vs "Cancel", "Save" | Sentence case |
| 10 | P3 | accessibility | *settings* — secret field | No placeholder or format hint, unlike Client ID | Add the `sh-…` hint or a short label note |

Noise rejected: `vh-unit` x5 (the shell is `fixed inset-0`, height == innerHeight by design),
`radius-outlier` on `#_r_0_`, and the axe `region` hits on maplibre controls.
The Client ID field's `surf-3` background is its focus state, not a token mismatch.

## Decisions

- ACCEPT 1, 3, 4, 5, 6, 7, 9, 10.
- DEFER 2 and 8: real, but map shell, not settings. Trigger: next shell-level pass.
- No P0.

## Finding -> edit

| # | File |
| --- | --- |
| 1 | `src/components/CredentialsModal.tsx` (link className) |
| 3 | `src/components/CredentialsModal.tsx` (footer buttons) |
| 4 | `src/components/CredentialsModal.tsx`, `src/app/globals.css` (pill token) |
| 5 | `src/app/page.tsx` (trigger ref) |
| 6 | `src/components/CredentialsModal.tsx` (description markup) |
| 7 | `src/components/CredentialsModal.tsx`, `src/app/globals.css` (`.ui-input`) |
| 9 | `src/components/CredentialsModal.tsx` (toggle label) |
| 10 | `src/components/CredentialsModal.tsx` (secret input) |

## Backlog

- Map shell: accessible name for the geolocate control (P1).
- Map shell: wrap content in a `main` landmark (P2).
- Close path: consider `inert` on the background instead of the manual Tab handler (P3).
