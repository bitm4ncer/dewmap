# Polish review packet

## Meta
- Engine: chromium
- Engine gap: Tauri/WebView2 and WebKit are not rendered; a Tauri dev server is a Chromium proxy.
- Routes: /?settings=1
- Viewports: 390x844, 1440x900
- Appearances: dark
- Limitations: canvas, shadow-dom
- Screenshots: 6 under screens/

## Intents
- /?settings=1 [provided]: Store the user's own Copernicus Data Space (Sentinel Hub) OAuth client so satellite imagery can be loaded directly from the browser, with no backend. (primary: Save credentials)

## Baseline
- Confidence: explicit (coverage 61%)
- Colors: rgba(0, 0, 0, 0) (22), rgb(167, 180, 186) (12), rgb(233, 238, 240) (10), rgb(144, 158, 165) (4), rgb(43, 52, 57) (4), rgb(141, 172, 187) (2), rgb(34, 42, 47) (2)
- Radii: 0px (16), 999px (8), 10px (4)
- Font sizes: 14px (8), 16px (8), 12px (6), 18px (2), 13px (2), 13.5px (2)
- Shadows: none (26), rgb(22, 27, 30) 0px 0px 0px 2px, rgb(141, 172, 187) 0px 0px 0px 4px (2)
- Radius outliers: none
- Type outliers: 18px, 13px, 13.5px

## Sections and actions
### /?settings=1
- 390x844 s3 form "" @ body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4
  actions: c7, c8, c9, c10, c11, c12, c13, c14
- 390x844 s1 aside "Routes" @ html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.relative.h-full:nth-of-type(1) > aside.hud-bottom-sheet.flex
  actions: none
- 390x844 s2 nav "" @ body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.relative.h-full:nth-of-type(1) > aside.hud-bottom-sheet.flex > nav.hud-sheet-tabs
  actions: none
- 1440x900 s1 form "" @ body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4
  actions: c21, c22, c23, c24, c25, c26, c27, c28

## Findings
| ID | Sev | Category | Where | Claim | Evidence | Rule | Fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| tokens:type-outlier:/?settings=1 #_r_0_ | P2 | tokens | /?settings=1 #_r_0_ | Font size appears once or twice, outside the inferred type scale. | 18px | type-outlier | Use the project's type scale. |
| tokens:type-outlier:/?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > div.flex.items-center > div.flex.items-center > button.inline-flex.min-h-11:nth-of-type(1) | P2 | tokens | /?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > div.flex.items-center > div.flex.items-center > button.inline-flex.min-h-11:nth-of-type(1) | Font size appears once or twice, outside the inferred type scale. | 13px | type-outlier | Use the project's type scale. |
| tokens:type-outlier:/?settings=1 div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(1) > input.ui-input.font-mono | P2 | tokens | /?settings=1 div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(1) > input.ui-input.font-mono | Font size appears once or twice, outside the inferred type scale. | 13.5px | type-outlier | Use the project's type scale. |
| tokens:type-outlier:/?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(2) > div.relative > input.ui-input.pr-20 | P2 | tokens | /?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(2) > div.relative > input.ui-input.pr-20 | Font size appears once or twice, outside the inferred type scale. | 13.5px | type-outlier | Use the project's type scale. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.relative.h-full:nth-of-type(1) | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.relative.h-full:nth-of-type(1) | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.relative.h-full:nth-of-type(1) > div.h-full.w-full:nth-of-type(1) | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.relative.h-full:nth-of-type(1) > div.h-full.w-full:nth-of-type(1) | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 div.fixed.inset-0:nth-of-type(2) > div.relative.h-full:nth-of-type(1) > div.h-full.w-full:nth-of-type(1) > div.maplibregl-canvas-container.maplibregl-interactive:nth-of-type(1) > canvas.maplibregl-canvas | P2 | responsive | /?settings=1 390x844 div.fixed.inset-0:nth-of-type(2) > div.relative.h-full:nth-of-type(1) > div.h-full.w-full:nth-of-type(1) > div.maplibregl-canvas-container.maplibregl-interactive:nth-of-type(1) > canvas.maplibregl-canvas | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| a11y:axe:region:/?settings=1 .maplibregl-ctrl-attrib-inner | P2 | a11y | /?settings=1 .maplibregl-ctrl-attrib-inner | All page content should be contained by landmarks | 2 node(s) | axe:region | Follow the axe guidance for this rule. |
| a11y:axe:region:/?settings=1 .text-sm | P2 | a11y | /?settings=1 .text-sm | All page content should be contained by landmarks | 1 node(s) | axe:region | Follow the axe guidance for this rule. |

## Axe summary
- region (moderate) on /?settings=1: 2 node(s)
- region (moderate) on /?settings=1: 1 node(s)

## Coverage
- Flows exercised: none.
- Engine: Chromium; WebKit/WebView2 not rendered.
- Visual-only claims require the screenshots.
