import { describe, expect, it } from "vitest";
import { VelocityTracker } from "./velocity";

describe("velocity tracker", () => {
  it("measures a downward flick in px/s", () => {
    const tracker = new VelocityTracker();
    tracker.add(100, 0);
    tracker.add(140, 16);
    tracker.add(180, 32);
    expect(tracker.velocity(32)).toBeCloseTo(2500, -1);
  });

  it("returns zero after a pause", () => {
    const tracker = new VelocityTracker();
    tracker.add(100, 0);
    tracker.add(140, 16);
    expect(tracker.velocity(200)).toBe(0);
  });

  it("returns zero without enough samples", () => {
    const tracker = new VelocityTracker();
    tracker.add(100, 0);
    expect(tracker.velocity(0)).toBe(0);
  });
});
