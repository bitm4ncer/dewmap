/**
 * Overlay registry.
 *
 * One module-level map, one registration function. Registering the same id
 * twice replaces the definition (so a feature module can hot-swap a layer
 * while the app is running without leaving duplicates behind).
 *
 * The registry never touches MapLibre; `apply.ts` reads it via the store.
 */
import type { OverlayDefinition, OverlayGroup } from "./types";

const registry = new Map<string, OverlayDefinition>();

/** Register (or replace) an overlay. Returns the definition for chaining. */
export function registerOverlay(definition: OverlayDefinition): OverlayDefinition {
  if (!definition?.id) throw new Error("overlay needs an id");
  registry.set(definition.id, definition);
  return definition;
}

export function unregisterOverlay(id: string): boolean {
  return registry.delete(id);
}

export function getOverlay(id: string): OverlayDefinition | undefined {
  return registry.get(id);
}

/**
 * All registered overlays, hardest-relevant first. Without a group this is
 * the full panel order; with a group it is just that section.
 */
export function listOverlays(group?: OverlayGroup): OverlayDefinition[] {
  const all = [...registry.values()];
  const filtered = group ? all.filter((o) => o.group === group) : all;
  return filtered.sort((a, b) => b.order - a.order || a.label.localeCompare(b.label));
}

export function overlayGroups(): OverlayGroup[] {
  const seen: OverlayGroup[] = [];
  for (const overlay of listOverlays()) {
    if (!seen.includes(overlay.group)) seen.push(overlay.group);
  }
  return seen;
}

/** Test-only: drop everything so a suite starts from a clean registry. */
export function resetOverlayRegistry(): void {
  registry.clear();
}
