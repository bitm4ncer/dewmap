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

/** Line colours are grouped: urban rail vs. heavy rail. */
export const RAIL_LINE_GROUPS = [
  { id: "urban", label: "Tram & subway", color: MODE_COLORS.TRAM },
  { id: "heavy", label: "Regional, S-Bahn & long-distance", color: MODE_COLORS.REGIONAL_RAIL },
] as const;

/** Station marker colours stay per mode so combined stations read clearly. */
export const RAIL_STATION_LABELS: { kind: "rail" | "subway" | "tram"; label: string }[] = [
  { kind: "rail", label: "Rail" },
  { kind: "subway", label: "Subway" },
  { kind: "tram", label: "Tram" },
];
