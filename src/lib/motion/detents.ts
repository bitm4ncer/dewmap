export interface DetentOption<T extends string = string> {
  state: T;
  height: number;
}

const FLICK_VELOCITY = 600;
const PROJECTION_SECONDS = 0.15;
const STAY_DISTANCE = 12;

/**
 * Picks a snap target from the live height and the height velocity
 * (positive = growing). A flick wins in its direction; otherwise the
 * projected position decides, with a small dead zone for tiny drags.
 */
export function chooseDetent<T extends string>(
  current: T,
  height: number,
  velocity: number,
  detents: readonly DetentOption<T>[],
): T {
  if (detents.length === 0) return current;
  const ordered = [...detents].sort((a, b) => a.height - b.height);
  const currentIndex = ordered.findIndex((d) => d.state === current);
  const index = currentIndex >= 0 ? currentIndex : 0;
  const projected = height + velocity * PROJECTION_SECONDS;

  let nearest = ordered[0];
  for (const detent of ordered) {
    if (Math.abs(detent.height - projected) < Math.abs(nearest.height - projected)) {
      nearest = detent;
    }
  }

  if (Math.abs(velocity) >= FLICK_VELOCITY) {
    const direction = velocity > 0 ? 1 : -1;
    const next = Math.max(0, Math.min(ordered.length - 1, index + direction));
    return ordered[next].state;
  }

  if (
    currentIndex >= 0
    && Math.abs(ordered[currentIndex].height - height) <= STAY_DISTANCE
    && Math.abs(nearest.height - height) <= STAY_DISTANCE
  ) {
    return current;
  }

  return nearest.state;
}
