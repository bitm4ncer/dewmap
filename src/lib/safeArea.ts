/**
 * Bottom safe-area maths for phones.
 *
 * iOS 26 home-screen apps can reserve a strip below the layout viewport
 * (WebKit 301108/301994, about 62 px on an 874 px screen) and paint it
 * themselves. No page content reaches it — `position: fixed; bottom: 0` stops
 * at the layout viewport edge. `env(safe-area-inset-bottom)` keeps reporting
 * the home-indicator inset anyway, so adding it on top of a short viewport
 * reserves the space twice and the dock floats a whole inset above an edge
 * that is already inset.
 *
 * A short viewport is only a *bottom* strip when the page is full-bleed: with
 * a translucent status bar the viewport starts at the physical top, so the
 * whole shortfall lies at the bottom. Without it the viewport is inset at the
 * top instead and the bottom edge is intact.
 */

export interface ViewportMetrics {
  /** `window.innerHeight` (layout viewport height). */
  innerHeight: number;
  /** `window.screen.width` — stays the portrait width in landscape. */
  screenWidth: number;
  /** `window.screen.height` — stays the portrait height in landscape. */
  screenHeight: number;
  /** Raw `env(safe-area-inset-top)` in px; > 0 only on a full-bleed page. */
  insetTop: number;
  /** Raw `env(safe-area-inset-bottom)` in px. */
  insetBottom: number;
}

/**
 * Pixels the system keeps below the layout viewport. Only a full-bleed
 * portrait viewport can be short: in landscape `screen.height` is still the
 * portrait height, and a status-bar inset shortens the viewport at the top.
 */
export function reservedBottomStrip(
  metrics: Omit<ViewportMetrics, "insetBottom">,
): number {
  if (metrics.insetTop <= 0) return 0;
  if (metrics.innerHeight <= metrics.screenWidth) return 0;
  return Math.max(0, Math.round(metrics.screenHeight - metrics.innerHeight));
}

/** Inset we may add without reserving an already-reserved strip a second time. */
export function effectiveSafeBottom(metrics: ViewportMetrics): number {
  const inset = Number.isFinite(metrics.insetBottom)
    ? Math.max(0, metrics.insetBottom)
    : 0;
  return Math.max(0, inset - reservedBottomStrip(metrics));
}

/** Reads one `env(safe-area-inset-*)` value through a throwaway probe. */
function probeInset(side: "top" | "bottom"): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;left:0;${side}:0;width:0;height:env(safe-area-inset-${side},0px);visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? height : 0;
}

/** Raw safe-area insets for the current window, in CSS px. */
export function probeSafeArea(): { top: number; bottom: number } {
  return { top: probeInset("top"), bottom: probeInset("bottom") };
}

/** Effective bottom inset for the current window, in CSS px. */
export function measuredSafeBottom(): number {
  const insets = probeSafeArea();
  if (typeof window === "undefined") return insets.bottom;
  return effectiveSafeBottom({
    innerHeight: window.innerHeight,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    insetTop: insets.top,
    insetBottom: insets.bottom,
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
