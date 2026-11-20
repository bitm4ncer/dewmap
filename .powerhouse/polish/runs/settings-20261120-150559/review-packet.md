# Polish review packet

## Meta
- Engine: chromium
- Engine gap: Tauri/WebView2 and WebKit are not rendered; a Tauri dev server is a Chromium proxy.
- Routes: /?settings=1
- Viewports: 390x844, 1440x900
- Appearances: dark
- Limitations: shadow-dom
- Screenshots: 4 under screens/

## Intents
- /?settings=1 [provided]: Store the user's own Copernicus Data Space (Sentinel Hub) OAuth client so satellite imagery can be loaded directly from the browser, with no backend. (primary: Save credentials)

## Baseline
- Confidence: explicit (coverage 63%)
- Colors: rgba(0, 0, 0, 0) (18), rgb(233, 238, 240) (10), rgb(167, 180, 186) (8), rgb(144, 158, 165) (4), rgb(43, 52, 57) (4), rgb(141, 172, 187) (2), rgb(34, 42, 47) (2)
- Radii: 0px (10), 10px (4), 3.35544e+07px (4), 4px (2), 999px (2), 9999px (2)
- Font sizes: 16px (8), 12px (6), 14px (4), 18px (2), 13px (2), 13.5px (2)
- Shadows: none (22), rgb(22, 27, 30) 0px 0px 0px 2px, rgb(141, 172, 187) 0px 0px 0px 4px (2)
- Radius outliers: 4px, 999px, 9999px
- Type outliers: 18px, 13px, 13.5px

## Sections and actions
### /?settings=1
- 390x844 s1 form "" @ body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4
  actions: c5, c6, c7, c8, c9, c10, c11, c12
- 1440x900 s1 form "" @ body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4
  actions: c17, c18, c19, c20, c21, c22, c23, c24

## Findings
| ID | Sev | Category | Where | Claim | Evidence | Rule | Fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a11y:axe:link-in-text-block:/?settings=1 a | P1 | a11y | /?settings=1 a | Links must be distinguishable without relying on color | 1 node(s) | axe:link-in-text-block | Follow the axe guidance for this rule. |
| a11y:axe:button-name:/?settings=1 .maplibregl-ctrl-geolocate | P1 | a11y | /?settings=1 .maplibregl-ctrl-geolocate | Buttons must have discernible text | 1 node(s) | axe:button-name | Follow the axe guidance for this rule. |
| tokens:type-outlier:/?settings=1 #_r_0_ | P2 | tokens | /?settings=1 #_r_0_ | Font size appears once or twice, outside the inferred type scale. | 18px | type-outlier | Use the project's type scale. |
| tokens:radius-outlier:/?settings=1 p.mt-1\.5.text-\[14px\] > a.rounded.text-\[color\:var\(--accent\)\] | P2 | tokens | /?settings=1 p.mt-1\.5.text-\[14px\] > a.rounded.text-\[color\:var\(--accent\)\] | Radius value appears once or twice, outside the inferred scale. | 4px | radius-outlier | Use the project's radius scale. |
| tokens:radius-outlier:/?settings=1 div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > div.mb-5.flex > button.hud-icon-btn.shrink-0 | P2 | tokens | /?settings=1 div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > div.mb-5.flex > button.hud-icon-btn.shrink-0 | Radius value appears once or twice, outside the inferred scale. | 999px | radius-outlier | Use the project's radius scale. |
| tokens:type-outlier:/?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > div.flex.items-center > div.flex.items-center > button.rounded-full.px-4:nth-of-type(1) | P2 | tokens | /?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > div.flex.items-center > div.flex.items-center > button.rounded-full.px-4:nth-of-type(1) | Font size appears once or twice, outside the inferred type scale. | 13px | type-outlier | Use the project's type scale. |
| tokens:radius-outlier:/?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > div.flex.items-center > div.flex.items-center > button.hud-btn-primary:nth-of-type(2) | P2 | tokens | /?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > div.flex.items-center > div.flex.items-center > button.hud-btn-primary:nth-of-type(2) | Radius value appears once or twice, outside the inferred scale. | 9999px | radius-outlier | Use the project's radius scale. |
| tokens:type-outlier:/?settings=1 div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(1) > input.ui-input.font-mono | P2 | tokens | /?settings=1 div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(1) > input.ui-input.font-mono | Font size appears once or twice, outside the inferred type scale. | 13.5px | type-outlier | Use the project's type scale. |
| tokens:type-outlier:/?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(2) > div.relative > input.ui-input.pr-20 | P2 | tokens | /?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(2) > div.relative > input.ui-input.pr-20 | Font size appears once or twice, outside the inferred type scale. | 13.5px | type-outlier | Use the project's type scale. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.flex.h-full:nth-of-type(1) | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.flex.h-full:nth-of-type(1) | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| responsive:vh-unit:/?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) | P2 | responsive | /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable > body.min-h-full.flex > div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) | Element height equals the viewport height; mobile browser chrome can clip it. | height == innerHeight | vh-unit | Use min-height with dvh or let content define the height. |
| a11y:axe:region:/?settings=1 input[aria-controls="_r_2_"] | P2 | a11y | /?settings=1 input[aria-controls="_r_2_"] | All page content should be contained by landmarks | 1 node(s) | axe:region | Follow the axe guidance for this rule. |

## Axe summary
- link-in-text-block (serious) on /?settings=1: 1 node(s)
- region (moderate) on /?settings=1: 1 node(s)
- button-name (critical) on /?settings=1: 1 node(s)
- link-in-text-block (serious) on /?settings=1: 1 node(s)
- region (moderate) on /?settings=1: 3 node(s)

## Coverage
- Flows exercised: none.
- Engine: Chromium; WebKit/WebView2 not rendered.
- Visual-only claims require the screenshots.
