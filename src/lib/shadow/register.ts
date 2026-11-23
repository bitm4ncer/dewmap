/**
 * The one line that makes the shadow layer part of the registry.
 *
 * `overlay.ts` stays free of registry imports so the engine can be used
 * without the app; this module is the dock. Called once from
 * `useOverlayLayers` (the same place the weather overlays register), because
 * the definition has to exist before the first resolve, including on a reload
 * where the toggle was already on.
 */
import { registerOverlay } from "@/lib/overlays";
import type { OverlayDefinition } from "@/lib/overlays/types";
import { shadowOverlayDefinition } from "./overlay";

let registered = false;

/** Idempotent: safe on HMR and in React strict mode. */
export function registerShadowOverlay(): void {
  if (registered) return;
  registered = true;
  registerOverlay(shadowOverlayDefinition() as OverlayDefinition);
}

/** Test-only: allow a clean registry in a fresh test case. */
export function resetShadowRegistration(): void {
  registered = false;
}
