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
  locator: "#E4574A",
  glass: "rgba(14,18,21,.84)",
  glassStrong: "rgba(14,18,21,.92)",
  casing: "#0B0E10",
  white: "#FFFFFF",

  // Map-only paint values (no CSS counterpart; guarded by map-theme.test.ts).
  lightRail: "#A9C3CF",
  tram: "#7E9FB0",
  narrowGauge: "#9DB0A8",
  landmarkWikidata: "#C08FA3",
  landmarkOsm: "#7FB3C4",
  // DWD warning severities: 1 Vorabinformation, 2 Wetterwarnung,
  // 3 markante Wetterwarnung, 4 Unwetterwarnung. 1/3/4 reuse the info, warn
  // and danger tokens; level 2 gets its own yellow so the three severity
  // steps stay distinguishable on a dark basemap.
  warningLevel1: "#8FBCDE",
  warningLevel2: "#E3C25E",
  warningLevel3: "#D8A25F",
  warningLevel4: "#DE8A7E",
  // Fixed route endpoint roles: start stays red, destination stays green.
  start: "#E4574A",
  end: "#6FCB96",
  // Walk/bike routes: own tone so a leftover car line is unmistakable.
  routeHike: "#8FD3B0",
} as const;

/** Desaturated cool tones for alternative hiking routes and via points. */
export const VIA_PALETTE = [
  "#7E8F9A",
  "#8FA89A",
  "#9AA3B8",
  "#A79A8F",
  "#8FA6B5",
  "#B3A6B0",
  "#A592C9",
] as const;

/**
 * Stable pseudo-random via tone: the same place always gets the same colour,
 * neighbouring stops get different ones. Re-rolling on every redraw would make
 * the stops flicker while panning.
 */
export function viaColor(lon: number, lat: number, index: number): string {
  const key = `${lon.toFixed(5)},${lat.toFixed(5)}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0;
  }
  return VIA_PALETTE[Math.abs(hash + index) % VIA_PALETTE.length];
}
