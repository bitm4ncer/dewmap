export interface SpringConfig {
  /** Time for one full oscillation, in seconds. Apple's default is 0.5. */
  response: number;
  /** 1 = critically damped, lower values overshoot more. */
  dampingFraction: number;
}

export interface SpringSnapshot {
  value: number;
  velocity: number;
}

export interface SpringOptions {
  from: number;
  to: number;
  /** Initial velocity in units per second, positive toward the target. */
  velocity?: number;
  config: SpringConfig;
  onUpdate?: (value: number) => void;
  onComplete?: () => void;
  /** Skip the animation and jump to the target. */
  reducedMotion?: boolean;
}

export interface SpringHandle {
  stop: () => SpringSnapshot;
  retarget: (to: number, velocity?: number) => void;
  isRunning: () => boolean;
}

const SUBSTEP = 1 / 240;
const MAX_STEP = 0.064;
const SETTLE_DISTANCE = 0.5;
const SETTLE_VELOCITY = 4;

/** One semi-implicit Euler integration step, sub-stepped for stability. */
export function stepSpring(
  value: number,
  velocity: number,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringSnapshot {
  const response = Math.max(0.01, config.response);
  const damping = Math.min(1.5, Math.max(0.02, config.dampingFraction));
  const omega = (2 * Math.PI) / response;
  const stiffness = omega * omega;
  const drag = 2 * damping * omega;
  let x = value;
  let v = velocity;
  let remaining = Math.min(MAX_STEP, Math.max(0, dt));

  while (remaining > 0) {
    const h = Math.min(SUBSTEP, remaining);
    const acceleration = -stiffness * (x - target) - drag * v;
    v += acceleration * h;
    x += v * h;
    remaining -= h;
  }

  return { value: x, velocity: v };
}

export function isSpringSettled(
  value: number,
  velocity: number,
  target: number,
): boolean {
  return (
    Math.abs(value - target) < SETTLE_DISTANCE
    && Math.abs(velocity) < SETTLE_VELOCITY
  );
}

/**
 * Interruptible spring driver. It never uses React state: callers write the
 * returned value directly to the DOM from `onUpdate`.
 */
export function createSpring(options: SpringOptions): SpringHandle {
  let value = options.from;
  let velocity = options.velocity ?? 0;
  let target = options.to;
  let running = !options.reducedMotion;
  let raf: number | null = null;
  let last: number | null = null;
  let completed = false;

  const complete = () => {
    if (completed) return;
    completed = true;
    running = false;
    raf = null;
    options.onUpdate?.(target);
    options.onComplete?.();
  };

  if (options.reducedMotion) {
    complete();
    return {
      stop: () => ({ value: target, velocity: 0 }),
      retarget: (next) => {
        target = next;
        value = next;
        velocity = 0;
        options.onUpdate?.(next);
        options.onComplete?.();
      },
      isRunning: () => false,
    };
  }

  const frame = (now: number) => {
    if (!running) return;
    if (last == null) last = now;
    const dt = Math.min(MAX_STEP, Math.max(0, (now - last) / 1000));
    last = now;
    const next = stepSpring(value, velocity, target, options.config, dt);
    value = next.value;
    velocity = next.velocity;
    options.onUpdate?.(value);
    if (isSpringSettled(value, velocity, target)) {
      value = target;
      velocity = 0;
      complete();
      return;
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (running || completed) return;
    running = true;
    last = null;
    raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);

  return {
    stop: () => {
      running = false;
      if (raf != null) cancelAnimationFrame(raf);
      raf = null;
      return { value, velocity };
    },
    retarget: (next, nextVelocity = 0) => {
      target = next;
      velocity = nextVelocity;
      completed = false;
      if (options.reducedMotion) {
        value = next;
        velocity = 0;
        options.onUpdate?.(next);
        options.onComplete?.();
        return;
      }
      start();
    },
    isRunning: () => running,
  };
}
