export type LngLat = [number, number];

/** Bounding box of a route, or null when it has no usable points. */
export function routeBounds(
  coordinates: readonly (readonly (number | undefined)[])[],
): [LngLat, LngLat] | null {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const point of coordinates) {
    const lon = point[0];
    const lat = point[1];
    if (lon === undefined || lat === undefined) continue;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  if (!Number.isFinite(south)) return null;
  return [
    [west, south],
    [east, north],
  ];
}

export interface FitPadding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface FitContext {
  viewportWidth: number;
  viewportHeight: number;
  /**
   * Padding the map already reserves — the sheet animates it as it moves, so
   * adding the sheet height again would leave no canvas at all.
   */
  mapPadding: FitPadding;
  /** Width of the open desktop drawer; 0 when it is closed. */
  drawerWidth: number;
  /** Bottom edge of the floating top bar in CSS pixels. */
  topbar: number;
}

const PHONE_MARGIN = 16;
const DESKTOP_MARGIN = 24;

/**
 * Padding that makes a fitted route land in the part of the map a user can
 * actually see: above the sheet on phones, left of the drawer on desktop.
 */
export function freeViewportPadding(ctx: FitContext): FitPadding {
  const margin = ctx.viewportWidth >= 768 ? DESKTOP_MARGIN : PHONE_MARGIN;
  // MapLibre already subtracts the padding the map carries (`setPadding`,
  // which the sheet animates) from the canvas inside cameraForBounds. Passing
  // it again leaves a negative box, and the fit is refused without moving the
  // camera — so only the remainder is passed here.
  const extraTop = Math.max(0, Math.round(ctx.topbar - ctx.mapPadding.top));
  const extraRight = Math.max(0, Math.round(ctx.drawerWidth - ctx.mapPadding.right));
  const padding = {
    top: extraTop + margin,
    bottom: margin,
    left: margin,
    right: extraRight + margin,
  };
  // Never ask MapLibre for a box the canvas cannot hold.
  const vertical = ctx.viewportHeight - ctx.mapPadding.top - ctx.mapPadding.bottom;
  if (padding.top + padding.bottom > vertical - 48) {
    padding.top = Math.max(margin, padding.top);
    padding.bottom = Math.max(margin, vertical - 48 - padding.top);
  }
  const horizontal = ctx.viewportWidth - ctx.mapPadding.left - ctx.mapPadding.right;
  if (padding.left + padding.right > horizontal - 32) {
    padding.left = Math.max(margin, horizontal - 32 - padding.right);
  }
  return padding;
}

/** Reads the live layout so a fit uses the space that is really free. */
export function readFitContext(
  map: { getPadding?: () => Partial<FitPadding> },
  doc: Document = document,
  win: Window = window,
): FitContext {
  const desktop = win.innerWidth >= 768;
  const sheet = doc.querySelector<HTMLElement>(".hud-bottom-sheet");
  const state = (sheet?.getAttribute("data-sheet-state") ?? "peek") as
    | "peek"
    | "half"
    | "full";
  const rect = sheet?.getBoundingClientRect();
  const topbar = doc.querySelector<HTMLElement>(".ui-topbar");
  const raw = map.getPadding?.();
  const mapPadding: FitPadding = {
    top: raw?.top ?? 0,
    bottom: raw?.bottom ?? 0,
    left: raw?.left ?? 0,
    right: raw?.right ?? 0,
  };
  return {
    viewportWidth: win.innerWidth,
    viewportHeight: win.innerHeight,
    mapPadding,
    drawerWidth: desktop && state !== "peek" && rect ? rect.width : 0,
    topbar: topbar ? topbar.getBoundingClientRect().bottom : 90,
  };
}
