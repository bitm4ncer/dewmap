/**
 * The Düsseldorf pilot: where the shadow layer has data, and how much of it.
 *
 * A pilot is a bounded claim. Everything outside `PILOT_BBOX` stays empty and
 * says so — the alternative (silently drawing no shadows) is what makes a map
 * layer look broken.
 */
import type { Bbox } from "./types";

export const PILOT_ID = "duesseldorf";
export const PILOT_LABEL = "Düsseldorf";
export const PILOT_NAME = "Düsseldorf pilot";

/** Coverage of `buildings-duesseldorf-v1.pmtiles`, WGS84. */
export const PILOT_BBOX: Bbox = [6.68, 51.14, 6.92, 51.34];

export const PILOT_TILES_FILE = "buildings-duesseldorf-v1.pmtiles";

const DATA_ORIGIN = (
  process.env.NEXT_PUBLIC_DEWMAP_DATA_API ?? "https://data.dewmap.app"
).replace(/\/+$/, "");

export const PILOT_TILES_URL = `${DATA_ORIGIN}/tiles/shadow/${PILOT_TILES_FILE}`;

/** Layer name inside the archive. */
export const BUILDINGS_LAYER = "buildings";

/** Below this zoom shadows are sub-pixel; the layer stays off. */
export const PILOT_MIN_ZOOM = 14;

/**
 * Longest edge of the computed window, metres. A 6 × 6 km window at 4 m is
 * 2.25 M cells; the engine caps at 16 M but the worker should stay in the
 * 100–400 ms range, so the window is bounded before it is rasterised.
 */
export const MAX_WINDOW_M = 6000;

/** Hard cap on rasterised cells per run (worker stays responsive). */
export const MAX_REQUEST_CELLS = 1_200_000;

/** Attribution sources actually used by this pilot (see `attribution.ts`). */
export const PILOT_SOURCE_IDS = ["nrwLod1"];
