/**
 * Bottom safe-area maths for phones.
 *
 * iOS 26 home-screen apps no longer fill the screen: WebKit keeps a strip
 * below the layout viewport (about 62 px on an 874 px screen) and paints that
 * strip itself. WebKit bug 301108 covers the viewport regression, 301994 the
 * strip. No page content can reach it — `position: fixed; bottom: 0` stops at
 * the layout viewport edge.
 *
 * `env(safe-area-inset-bottom)` keeps reporting the home-indicator inset even
 * though that inset already lies outside the viewport, so adding it again
 * reserves the same space twice: the dock floats a whole inset above an edge
 * that is already inset. That double reservation is what this module removes.
 */

export interface ViewportMetrics {
  /** `window.innerHeight` (layout viewport height). */
  innerHeight: number;
  /** `window.screen.width` — stays the portrait width in landscape. */
  screenWidth: number;
  /** `window.screen.height` — stays the portrait height in landscape. */
  screenHeight: number;
  /** Raw `env(safe-area-inset-bottom)` in px. */
  inset: number;
}

/**
 * Pixels the system keeps below the layout viewport. Only a portrait viewport
 * can be short: in landscape `screen.height` is still the portrait height, so
 * the naive difference would be several hundred px.
 */
export function reservedBottomStrip(
  metrics: Omit<ViewportMetrics, "inset">,
): number {
  if (metrics.innerHeight <= metrics.screenWidth) return 0;
  return Math.max(0, Math.round(metrics.screenHeight - metrics.innerHeight));
}

/** Inset we may add without reserving an already-reserved strip a second time. */
export function effectiveSafeBottom(metrics: ViewportMetrics): number {
  const inset = Number.isFinite(metrics.inset) ? Math.max(0, metrics.inset) : 0;
  return Math.max(0, inset - reservedBottomStrip(metrics));
}

/** Reads the raw `env(safe-area-inset-bottom)` through a throwaway probe. */
export function probeSafeBottom(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? height : 0;
}

/** Effective bottom inset for the current window, in CSS px. */
export function measuredSafeBottom(): number {
  const inset = probeSafeBottom();
  if (typeof window === "undefined") return inset;
  return effectiveSafeBottom({
    innerHeight: window.innerHeight,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    inset,
  });
}

/**
 * Mirrors the effective inset into `--safe-bottom`, so the CSS layout
 * (`--hud-peek-h`, panel body padding) and the gesture detents agree.
 */
export function syncSafeAreaVar(): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    "--safe-bottom",
    `${measuredSafeBottom()}px`,
  );
}
