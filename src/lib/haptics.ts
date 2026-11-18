/**
 * Tiny haptic helper. Android exposes the Vibration API; iOS Safari does
 * not, and desktop browsers usually ignore it. Failures are silent so
 * touch feedback never blocks an interaction.
 */
export type HapticKind = "tap" | "snap";

export function haptic(kind: HapticKind = "tap"): void {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
    return;
  }
  try {
    navigator.vibrate(kind === "snap" ? 6 : 4);
  } catch {
    // Some browsers expose the API but reject without a user gesture.
  }
}
