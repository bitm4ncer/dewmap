/**
 * Shared transit-mode palette. The route planner, the live-vehicle markers
 * and the rail overlay all use these values so a mode keeps one colour
 * across the app.
 */
export const MODE_COLORS: Record<string, string> = {
  HIGHSPEED_RAIL: "#8cc8ff",
  LONG_DISTANCE: "#8cc8ff",
  REGIONAL_RAIL: "#8cc8ff",
  REGIONAL_EXPRESS: "#8cc8ff",
  SUBURBAN: "#7bd6a4",
  METRO: "#c39bff",
  SUBWAY: "#c39bff",
  TRAM: "#f0b35b",
  LIGHT_RAIL: "#f0b35b",
  BUS: "#f0b35b",
  COACH: "#f0b35b",
  FERRY: "#5bc8d8",
  ODM: "#d8ef6a",
  AIRPLANE: "#d9d7cf",
};

/** Rail kind used by the map overlay (shared with the legend). */
export type RailKind =
  | "tram"
  | "subway"
  | "sbahn"
  | "regional"
  | "longDistance"
  | "rail";

export const RAIL_KIND_COLORS: Record<RailKind, string> = {
  tram: MODE_COLORS.TRAM,
  subway: MODE_COLORS.SUBWAY,
  sbahn: MODE_COLORS.SUBURBAN,
  regional: MODE_COLORS.REGIONAL_RAIL,
  longDistance: "#a9d6ff",
  rail: MODE_COLORS.REGIONAL_RAIL,
};

export const RAIL_KIND_LABELS: { kind: RailKind; label: string }[] = [
  { kind: "tram", label: "Tram" },
  { kind: "subway", label: "U-Bahn" },
  { kind: "sbahn", label: "S-Bahn" },
  { kind: "regional", label: "Regional" },
  { kind: "longDistance", label: "Fernverkehr" },
];
