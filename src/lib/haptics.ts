/**
 * Tiny haptic helper. Android exposes the Vibration API; iOS Safari does
 * not, and desktop browsers usually ignore it. Failures are silent so
 * touch feedback never blocks an interaction.
 *
 * Kinds are shared by every interactive surface (map features, buttons,
 * sheet gestures) so the whole app speaks one feedback language:
 *
 *   tap       12 ms — generic press acknowledgment (buttons, list items)
 *   select    15 ms — a map feature / route / stop was picked
 *   snap       8 ms — a gesture settled into a state (sheet snap, toggle)
 *   tick       5 ms — micro event (crosshair settle after a pan)
 *   longpress 40 ms — long-press fired (crosshair lock-in)
 */
export type HapticKind = "tap" | "select" | "snap" | "tick" | "longpress";

const PATTERNS: Record<HapticKind, number> = {
  tap: 12,
  select: 15,
  snap: 8,
  tick: 5,
  longpress: 40,
};

/**
 * Same kind requested again within this window is swallowed, so a
 * pointerdown listener plus a click handler both firing cannot produce a
 * double buzz.
 */
const COALESCE_MS = 90;
let lastKind: HapticKind | null = null;
let lastAt = 0;

export function haptic(kind: HapticKind = "tap"): void {
  const now = Date.now();
  if (kind === lastKind && now - lastAt < COALESCE_MS) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  lastKind = kind;
  lastAt = now;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Some browsers expose the API but reject without a user gesture.
  }
}
