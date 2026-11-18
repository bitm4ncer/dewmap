/** Values the station input itself can produce are not history entries. */
const HIDDEN_NAMES = new Set(["map point", "my location"]);

export function visibleQuickPlaces<T extends { name: string }>(places: T[]): T[] {
  return places
    .filter((p) => !HIDDEN_NAMES.has(p.name.trim().toLowerCase()))
    .slice(0, 4);
}
