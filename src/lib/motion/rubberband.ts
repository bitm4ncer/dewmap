/** Bounded rubber-band displacement for overscrolled edges. */
export function rubberband(
  value: number,
  min: number,
  max: number,
  dimension: number,
): number {
  if (value < min) return Math.max(0, min - resistance(min - value, dimension));
  if (value > max) return max + resistance(value - max, dimension);
  return value;
}

function resistance(distance: number, dimension: number): number {
  const size = Math.max(1, dimension);
  // Apple-style damping: starts at roughly half speed and saturates.
  const limit = Math.min(96, Math.max(48, size * 0.18));
  return limit * (1 - 1 / (distance / limit + 1));
}
