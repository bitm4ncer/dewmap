/**
 * Keeping "now" honest.
 *
 * The layer follows the wall clock, so a map that sits open for two hours must
 * not keep showing the shadows of two hours ago. Recomputing is cheap for the
 * tiles (cached) but not for the ray-march, so the rule is conservative:
 *
 * - only in "now" mode (a slider offset is a deliberate point in time);
 * - only while the page is visible;
 * - at most once per minute on focus/visibility events;
 * - otherwise aligned to the next 5-minute boundary.
 *
 * Nothing here runs a render loop; each tick is a single state bump that the
 * render effect consumes.
 */

/** Recompute cadence for the "now" mode. */
export const NOW_REFRESH_MINUTES = 5;

/** Do not re-render on every focus/blur; one minute is plenty. */
export const NOW_FOCUS_GUARD_MS = 60_000;

/**
 * Milliseconds until the next wall-clock bucket boundary (:00, :05, :10, …).
 * Aligning instead of counting from mount keeps the displayed clock and the
 * computed sun within one bucket of each other.
 */
export function msUntilNextNowBucket(
  now: Date = new Date(),
  bucketMinutes: number = NOW_REFRESH_MINUTES,
): number {
  const bucketMs = Math.max(1, Math.round(bucketMinutes)) * 60_000;
  const ms = now.getTime();
  if (!Number.isFinite(ms)) return bucketMs;
  const remainder = ((ms % bucketMs) + bucketMs) % bucketMs;
  return remainder === 0 ? bucketMs : bucketMs - remainder;
}

export interface NowRefreshInput {
  enabled: boolean;
  offsetMinutes: number;
  /** `document.visibilityState === "visible"`. */
  visible: boolean;
  /** Time since the last completed run, ms. */
  msSinceRender: number;
}

/** Should a visibility/focus event trigger a fresh "now" render? */
export function shouldRefreshNow({
  enabled,
  offsetMinutes,
  visible,
  msSinceRender,
}: NowRefreshInput): boolean {
  return (
    enabled &&
    offsetMinutes === 0 &&
    visible &&
    Number.isFinite(msSinceRender) &&
    msSinceRender >= NOW_FOCUS_GUARD_MS
  );
}
