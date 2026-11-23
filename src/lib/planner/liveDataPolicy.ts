/**
 * Live data policy for vehicle polling.
 *
 * Live vehicles are on by default, but a visitor who asked the browser to
 * save data must not pay ~9 MB/h just because they opened the map. Keep the
 * decision pure and testable instead of reading `navigator` deep inside the
 * layer.
 */

export interface ConnectionLike {
  /** Chrome/Android "Data Saver"; also set by some embedded browsers. */
  saveData?: boolean;
}

export interface NavigatorLike {
  connection?: ConnectionLike;
}

export interface LiveDataEnvironment {
  saveData: boolean;
}

/** Environment probe; guarded so the store can be imported during SSR. */
export function readLiveDataEnvironment(
  target: NavigatorLike | undefined = typeof navigator !== "undefined"
    ? (navigator as NavigatorLike)
    : undefined,
): LiveDataEnvironment {
  return { saveData: target?.connection?.saveData === true };
}

/**
 * Default for `liveVehicles`.
 *
 * An explicit opt-out always wins. Save-Data defaults to off, but the user
 * can still switch it on for the current session; the switch is not blocked,
 * because it is an informed choice at that point.
 */
export function liveVehiclesDefault(
  optOut: boolean,
  saveData: boolean,
): boolean {
  if (optOut) return false;
  return !saveData;
}

/**
 * Notice for the live bar. Returns null when the browser is not saving data.
 * The manual-on text keeps the trade-off visible after the switch is flipped.
 */
export function liveDataSaverNotice(
  saveData: boolean,
  enabled: boolean,
): string | null {
  if (!saveData) return null;
  return enabled
    ? "Data Saver is on — live vehicles enabled manually."
    : "Data Saver is on — live vehicles are off.";
}
