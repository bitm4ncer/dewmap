/** A map pick is an ephemeral value, not a saved shortcut. */
const EPHEMERAL_NAME = "map point";

export function visibleQuickPlaces<T extends { name: string }>(places: T[]): T[] {
  return places
    .filter((p) => p.name.trim().toLowerCase() !== EPHEMERAL_NAME)
    .slice(0, 4);
}
