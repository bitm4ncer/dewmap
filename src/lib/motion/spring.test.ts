import { describe, expect, it } from "vitest";
import {
  createSpring,
  isSpringSettled,
  stepSpring,
  type SpringConfig,
} from "./spring";

function simulate(config: SpringConfig, from: number, to: number, frames = 360) {
  let state = { value: from, velocity: 0 };
  let peak = from;
  for (let i = 0; i < frames; i += 1) {
    state = stepSpring(state.value, state.velocity, to, config, 1 / 60);
    peak = Math.max(peak, state.value);
  }
  return { ...state, peak };
}

describe("spring core", () => {
  it("settles on the target", () => {
    const result = simulate({ response: 0.38, dampingFraction: 0.9 }, 0, 240);
    expect(result.value).toBeCloseTo(240, 1);
    expect(Math.abs(result.velocity)).toBeLessThan(3);
    expect(isSpringSettled(result.value, result.velocity, 240)).toBe(true);
  });

  it("overshoots less with more damping", () => {
    const under = simulate({ response: 0.5, dampingFraction: 0.6 }, 0, 100);
    const critical = simulate({ response: 0.5, dampingFraction: 1 }, 0, 100);
    expect(under.peak).toBeGreaterThan(100);
    expect(critical.peak).toBeLessThanOrEqual(100.001);
  });

  it("uses initial velocity", () => {
    const forward = stepSpring(0, 900, 200, { response: 0.5, dampingFraction: 0.9 }, 1 / 60);
    const backward = stepSpring(0, -900, 200, { response: 0.5, dampingFraction: 0.9 }, 1 / 60);
    expect(forward.value).toBeGreaterThan(backward.value);
  });

  it("supports reduced motion without a frame loop", () => {
    let value = 0;
    const handle = createSpring({
      from: 0,
      to: 200,
      config: { response: 0.5, dampingFraction: 0.9 },
      reducedMotion: true,
      onUpdate: (v) => { value = v; },
    });
    expect(value).toBe(200);
    expect(handle.isRunning()).toBe(false);
  });
});
