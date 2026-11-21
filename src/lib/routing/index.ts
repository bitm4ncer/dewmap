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
  LIVE_MIN_ZOOM,
  LIVE_POLL_MS,
  MAX_LIVE_VEHICLES,
  alertStopCandidates,
  estimateGzipKb,
  fetchLiveVehicles,
  fetchLiveVehiclesChunked,
  filterLiveVehicles,
  liveModeGroup,
  liveModeLabel,
  liveModePriority,
  lineKey,
  mergeVehiclePositions,
  normalizeLiveVehiclesChunked,
  normalizeLiveColor,
  normalizeLiveVehicles,
  pollDelayForPayload,
  type AlertBounds,
  type AlertStopCandidate,
  type LiveModeGroup,
  type LiveVehicle,
  type LiveVehiclePhase,
  type LiveVehicleQuery,
  type LiveVehicleSource,
  type LiveVehicleStop,
  type LiveVehiclesResult,
  type ChunkedNormalizeOptions,
} from "./liveVehicles";
export {
  ALERT_MOVE_KM,
  ALERT_REFRESH_MS,
  alertGateAction,
  commitAlertGate,
  initialAlertGate,
  movedKm,
  resetAlertGate,
  type AlertGate,
  type AlertGateAction,
  type AlertGateInput,
} from "./alertSchedule";
export {
  alertPlainText,
  clearAlertCache,
  fetchAreaAlerts,
  mergeAlerts,
  normalizeMotisAlert,
  sortAlerts,
  type AreaAlertsQuery,
  type NormalizeAlertOptions,
} from "./alerts";
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
  clearStopCache,
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
