/**
 * Public entry point for the routing library.
 *
 *   import { planRoutes, formatDuration } from "@/lib/routing";
 */

export * from "./types";
export * from "./format";
export * from "./http";
export { decodePolyline, toLonLat } from "./polyline";
export {
  BROUTER_PROFILES,
  defaultBrouterProfile,
  deriveBrouterManeuvers,
  isBrouterProfile,
  planBrouter,
  type BrouterHandlers,
  type BrouterProfile,
} from "./providers/brouter";
export {
  buildValhallaBody,
  costingForMode,
  isValhallaCosting,
  mapValhallaManeuverType,
  mapValhallaModifier,
  planValhalla,
  type ValhallaCosting,
} from "./providers/valhalla";
export {
  decodeLegGeometry,
  geocodeStops,
  normalizeMotisItinerary,
  planMotis,
  type MotisStop,
} from "./providers/motis";
export {
  planRoutes,
  planRoutesStreaming,
  type PlanHandlers,
} from "./engine";
