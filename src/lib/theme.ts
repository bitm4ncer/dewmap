/**
 * JS mirror of the Graphite tokens defined in `src/app/globals.css`.
 *
 * MapLibre paint values are plain strings and cannot read CSS custom
 * properties, so map layers and marker DOM read their colors from here.
 * `src/lib/theme.test.ts` guards the mirror against drift.
 *
 * Map-only keys (`lightRail`, `tram`, `narrowGauge`, `landmarkWikidata`,
 * `landmarkOsm`) are not present in the stylesheet by design.
 */
export const THEME = {
  bg: "#121619",
  surface0: "#161B1E",
  surface1: "#1B2125",
  surface2: "#222A2F",
  surface3: "#2B3439",
  ink: "#E9EEF0",
  inkDim: "#A7B4BA",
  inkMute: "#909EA5",
  accent: "#8DACBB",
  accentInk: "#0F1416",
  accentSoft: "rgba(141,172,187,.14)",
  accentStrong: "rgba(141,172,187,.28)",
  warn: "#D8A25F",
  danger: "#DE8A7E",
  info: "#8FBCDE",
  locator: "#C98274",
  glass: "rgba(14,18,21,.84)",
  glassStrong: "rgba(14,18,21,.92)",
  casing: "#0B0E10",
  white: "#FFFFFF",
} as const;

/** Desaturated cool tones for alternative hiking routes and via points. */
export const VIA_PALETTE = [
  "#7E8F9A",
  "#8FA89A",
  "#9AA3B8",
  "#A79A8F",
  "#8FA6B5",
  "#B3A6B0",
] as const;
