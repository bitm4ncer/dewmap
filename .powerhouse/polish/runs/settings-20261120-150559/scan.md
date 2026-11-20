# Polish scan

- Routes: /?settings=1
- Components: 24
- Findings: 16 (2 blocking)
- P1 axe:link-in-text-block: /?settings=1 a
- P1 axe:button-name: /?settings=1 .maplibregl-ctrl-geolocate
- P2 type-outlier: /?settings=1 #_r_0_
- P2 radius-outlier: /?settings=1 p.mt-1\.5.text-\[14px\] > a.rounded.text-\[color\:var\(--accent\)\]
- P2 radius-outlier: /?settings=1 div.fixed.inset-0:nth-of-type(2) > div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > div.mb-5.flex > button.hud-icon-btn.shrink-0
- P2 type-outlier: /?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > div.flex.items-center > div.flex.items-center > button.rounded-full.px-4:nth-of-type(1)
- P2 radius-outlier: /?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > div.flex.items-center > div.flex.items-center > button.hud-btn-primary:nth-of-type(2)
- P2 type-outlier: /?settings=1 div.fixed.inset-0:nth-of-type(2) > div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(1) > input.ui-input.font-mono
- P2 type-outlier: /?settings=1 div.max-h-\[calc\(100dvh-2rem\)\].w-full > form.space-y-4 > label.block:nth-of-type(2) > div.relative > input.ui-input.pr-20
- P2 vh-unit: /?settings=1 390x844 html.geist_a71539c9-module__T19VSG__variable.geist_mono_8d43a2aa-module__8Li5zG__variable

See review-packet.md, checks.json, and axe.json.
