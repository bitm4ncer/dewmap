import type {
  Map as MLMap,
  MapGeoJSONFeature,
  MapMouseEvent,
} from "maplibre-gl";
import { haptic } from "../haptics";
import { prefersReducedMotion } from "../motion";

/**
 * Central map-tap pipeline.
 *
 * Every tappable map feature (stations, POI dots, landmarks, stops,
 * routes, vehicles, waypoints) registers a "feature tap group" instead of
 * binding its own `map.on("click", layer, …)` handler. One generic click
 * listener — the pipeline — resolves the tap:
 *
 *   1. It runs a tolerant, padded hit-test across all registered groups
 *      and picks the feature nearest to the tap point, so a tap that
 *      lands a few pixels off still selects the right thing.
 *   2. It fires haptic + ripple feedback synchronously, before any
 *      handler state updates or async requests start.
 *   3. It dispatches to the winning group's `onFeature`, and marks the
 *      event prevented so legacy listeners (and the bare-map fallback)
 *      stay out of the way.
 *   4. With nothing hit, it calls `onBareTap` (open the place card for
 *      the tapped coordinate) — also with immediate feedback.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

export type ProjectFn = (lngLat: [number, number]) => ScreenPoint | null;

/** Default extra pick tolerance in CSS pixels around a tap. */
export const DEFAULT_TAP_TOLERANCE_PX = 22;

// ── Pure geometry (unit-tested) ───────────────────────────────────────

/** Distance from a point to a screen-space segment. */
export function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Ray-casting point-in-ring test over projected screen points. */
function pointInRingScreen(ring: ScreenPoint[], pt: ScreenPoint): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    const intersects =
      a.y > pt.y !== b.y > pt.y
      && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** True when `tap` lies inside the outer ring and outside every hole. */
function polygonContainsScreen(
  rings: GeoJSON.Position[][] | ScreenPoint[][],
  project: ProjectFn,
  tap: ScreenPoint,
): boolean {
  const screenRings = (rings as (GeoJSON.Position[] | ScreenPoint[])[]).map(
    (ring) =>
      ring.map((c) => {
        const p = c as ScreenPoint;
        if (typeof p.x === "number" && typeof p.y === "number") {
          return { x: p.x, y: p.y };
        }
        const pos = c as GeoJSON.Position;
        return project([pos[0], pos[1]]);
      }).filter((p): p is ScreenPoint => p !== null),
  );
  const [outer, ...holes] = screenRings;
  if (!outer || outer.length < 3) return false;
  if (!pointInRingScreen(outer, tap)) return false;
  return !holes.some((hole) => hole.length >= 3 && pointInRingScreen(hole, tap));
}

/**
 * Screen-space distance from `tap` to the closest edge/vertex of a
 * GeoJSON geometry, using `project` to place coordinates. Points inside
 * a polygon count as distance 0. Returns null when no coordinate can be
 * projected (e.g. behind the horizon). Very long lines are subsampled to
 * keep the walk cheap.
 */
export function screenDistanceToGeometry(
  geometry: GeoJSON.Geometry,
  project: ProjectFn,
  tap: ScreenPoint,
): number | null {
  let best: number | null = null;
  const consider = (x: number, y: number) => {
    const d = Math.hypot(tap.x - x, tap.y - y);
    if (best === null || d < best) best = d;
  };
  const considerSegments = (coords: GeoJSON.Position[]) => {
    if (coords.length === 0) return;
    // Subsample so a continent-length route cannot stall a tap.
    const stride = Math.max(1, Math.ceil(coords.length / 64));
    let prev: ScreenPoint | null = null;
    for (let i = 0; i < coords.length; i += stride) {
      const p = project([coords[i][0], coords[i][1]]);
      if (!p) continue;
      if (prev) {
        const seg = distanceToSegment(tap.x, tap.y, prev.x, prev.y, p.x, p.y);
        if (best === null || seg < best) best = seg;
      } else {
        consider(p.x, p.y);
      }
      prev = p;
    }
    // The last vertex may be off-stride; still worth a segment check.
    const last = coords[coords.length - 1];
    const p = project([last[0], last[1]]);
    if (p && prev && (prev.x !== p.x || prev.y !== p.y)) {
      const seg = distanceToSegment(tap.x, tap.y, prev.x, prev.y, p.x, p.y);
      if (best === null || seg < best) best = seg;
    }
  };

  switch (geometry.type) {
    case "Point": {
      const p = project(geometry.coordinates as [number, number]);
      if (!p) return null;
      return Math.hypot(tap.x - p.x, tap.y - p.y);
    }
    case "MultiPoint":
      for (const c of geometry.coordinates) {
        const p = project([c[0], c[1]]);
        if (p) consider(p.x, p.y);
      }
      return best;
    case "LineString":
      considerSegments(geometry.coordinates);
      return best;
    case "MultiLineString":
      for (const line of geometry.coordinates) considerSegments(line);
      return best;
    case "Polygon": {
      for (const ring of geometry.coordinates) considerSegments(ring);
      if (polygonContainsScreen(geometry.coordinates, project, tap)) return 0;
      return best;
    }
    case "MultiPolygon": {
      for (const poly of geometry.coordinates) {
        for (const ring of poly) considerSegments(ring);
        if (polygonContainsScreen(poly, project, tap)) return 0;
      }
      return best;
    }
    case "GeometryCollection":
      for (const g of geometry.geometries) {
        const d = screenDistanceToGeometry(g, project, tap);
        if (d !== null && (best === null || d < best)) best = d;
      }
      return best;
    default:
      return null;
  }
}

export interface NearestPick<T> {
  feature: T;
  distancePx: number;
}

/** Pick the feature whose rendered shape lies closest to the tap. */
export function pickNearestFeature<T extends { geometry: GeoJSON.Geometry }>(
  features: readonly T[],
  project: ProjectFn,
  tap: ScreenPoint,
): NearestPick<T> | null {
  let best: NearestPick<T> | null = null;
  for (const feature of features) {
    if (!feature.geometry) continue;
    const d = screenDistanceToGeometry(feature.geometry, project, tap);
    if (d === null) continue;
    if (!best || d < best.distancePx) best = { feature, distancePx: d };
  }
  return best;
}

// ── Tolerant hit-testing ──────────────────────────────────────────────

function pointXY(point: unknown): ScreenPoint {
  if (Array.isArray(point)) return { x: point[0], y: point[1] };
  const p = point as { x: number; y: number };
  return { x: p.x, y: p.y };
}

/**
 * Exact hit-test first, then a padded box query resolved to the nearest
 * feature. Returns null when nothing lies within `tolerancePx`.
 */
export function nearestRenderedFeature(
  map: MLMap,
  point: { x: number; y: number },
  layerIds: readonly string[],
  tolerancePx: number = DEFAULT_TAP_TOLERANCE_PX,
): NearestPick<MapGeoJSONFeature> | null {
  const layers = layerIds.filter((id) => map.getLayer(id));
  if (layers.length === 0) return null;
  const exact = map.queryRenderedFeatures([point.x, point.y], { layers });
  if (exact.length > 0) {
    return { feature: exact[0], distancePx: 0 };
  }
  if (tolerancePx <= 0) return null;
  const padded = map.queryRenderedFeatures(
    [
      [point.x - tolerancePx, point.y - tolerancePx],
      [point.x + tolerancePx, point.y + tolerancePx],
    ],
    { layers },
  );
  if (padded.length === 0) return null;
  const project: ProjectFn = (lngLat) => {
    const p = map.project(lngLat);
    return { x: p.x, y: p.y };
  };
  const picked = pickNearestFeature(padded, project, point);
  if (!picked || picked.distancePx > tolerancePx) return null;
  return picked;
}

// ── Ripple ────────────────────────────────────────────────────────────

const RIPPLE_CLASS = "map-tap-ripple";
const RIPPLE_LIFETIME_MS = 600;

/**
 * Spawn a short ripple at a screen point on the map. Pure DOM, inserted
 * synchronously so it appears in the same frame as the touch.
 */
export function spawnTapRipple(
  map: MLMap,
  point: ScreenPoint,
  color?: string,
): void {
  if (typeof document === "undefined") return;
  if (prefersReducedMotion()) return;
  const el = document.createElement("div");
  el.className = RIPPLE_CLASS;
  if (color) el.style.setProperty("--ripple-color", color);
  el.style.left = `${point.x}px`;
  el.style.top = `${point.y}px`;
  const container = map.getCanvasContainer();
  container.appendChild(el);
  const remove = () => el.remove();
  el.addEventListener("animationend", remove, { once: true });
  window.setTimeout(remove, RIPPLE_LIFETIME_MS);
}

// ── Registry + pipeline ───────────────────────────────────────────────

export interface FeatureTapGroup {
  /** Unique per map, e.g. "rail-stations". */
  id: string;
  /** Rendered layers that make this feature tappable. */
  layers: readonly string[];
  /** Extra pick tolerance in px. Defaults to {@link DEFAULT_TAP_TOLERANCE_PX}. */
  tolerancePx?: number;
  /** Haptic kind on pick; null disables vibration. Defaults to "select". */
  hapticKind?: "select" | "tap" | null;
  /** Set false to skip the ripple. Defaults to true. */
  ripple?: boolean;
  /** Ripple tint. */
  color?: string;
  /** Called with the picked feature once feedback has fired. */
  onFeature: (feature: MapGeoJSONFeature, event: MapMouseEvent) => void;
}

interface MapRegistry {
  groups: Map<string, FeatureTapGroup>;
  /** Insertion order, used as the tie-breaker between equidistant picks. */
  order: string[];
}

const registries = new WeakMap<MLMap, MapRegistry>();
const installed = new WeakSet<MLMap>();
/** Latest per-map pipeline options; updated on every install call. */
const pipelineOptions = new WeakMap<MLMap, FeatureTapPipelineOptions>();

export interface FeatureTapPipelineOptions {
  /** Bare-map taps: no group claimed the click (open place card, …). */
  onBareTap?: (event: MapMouseEvent) => void;
  /** A tappable feature was resolved. Used by the generic selection ring. */
  onFeatureSelect?: (
    feature: MapGeoJSONFeature,
    group: FeatureTapGroup,
  ) => void;
  /** Set false to keep bare taps silent. Defaults to true. */
  bareTapFeedback?: boolean;
  /** Ripple tint for bare taps. */
  bareTapColor?: string;
}

function registryFor(map: MLMap): MapRegistry {
  let registry = registries.get(map);
  if (!registry) {
    registry = { groups: new Map(), order: [] };
    registries.set(map, registry);
  }
  return registry;
}

/**
 * Register a tappable feature group. Idempotent per id: registering the
 * same id twice replaces the previous entry in place. The returned
 * function unregisters the group.
 */
export function registerFeatureTaps(
  map: MLMap,
  group: FeatureTapGroup,
): () => void {
  const registry = registryFor(map);
  if (!registry.groups.has(group.id)) registry.order.push(group.id);
  registry.groups.set(group.id, group);
  return () => {
    if (registry.groups.get(group.id) === group) {
      registry.groups.delete(group.id);
      const i = registry.order.indexOf(group.id);
      if (i >= 0) registry.order.splice(i, 1);
    }
  };
}

/**
 * Install the single generic click listener that resolves taps across
 * all registered groups. Safe to call once per map; later calls for the
 * same map update the bare-tap behaviour.
 */
export function installFeatureTapPipeline(
  map: MLMap,
  options: FeatureTapPipelineOptions = {},
): void {
  // Always keep the freshest options: callers re-install when their
  // callbacks change identity (React effects), and the single listener
  // below reads them per click.
  pipelineOptions.set(map, options);
  if (installed.has(map)) return;
  installed.add(map);

  const onClick = (event: MapMouseEvent) => {
    const opts = pipelineOptions.get(map) ?? {};
    if (event.defaultPrevented) return;
    const registry = registries.get(map);
    let best: { group: FeatureTapGroup } & NearestPick<MapGeoJSONFeature> | null =
      null;
    if (registry) {
      for (const id of registry.order) {
        const group = registry.groups.get(id);
        if (!group) continue;
        const found = nearestRenderedFeature(
          map,
          pointXY(event.point),
          group.layers,
          group.tolerancePx ?? DEFAULT_TAP_TOLERANCE_PX,
        );
        if (found && (!best || found.distancePx < best.distancePx)) {
          best = { group, ...found };
        }
      }
    }

    if (best) {
      // Feedback first — synchronously, before any handler can await.
      event.preventDefault();
      const kind = best.group.hapticKind === undefined
        ? "select"
        : best.group.hapticKind;
      if (kind) haptic(kind);
      if (best.group.ripple !== false) {
        spawnTapRipple(map, pointXY(event.point), best.group.color);
      }
      // Let the map mark the selected marker before the group handler
      // changes panels, popups or route inputs.
      opts.onFeatureSelect?.(best.feature, best.group);
      best.group.onFeature(best.feature, event);
      return;
    }

    if (opts.bareTapFeedback !== false) haptic("tap");
    if (opts.bareTapFeedback !== false) {
      spawnTapRipple(map, pointXY(event.point), opts.bareTapColor);
    }
    opts.onBareTap?.(event);
  };

  map.on("click", onClick);
}
