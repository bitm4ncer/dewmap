import { describe, expect, it } from "vitest";
import { rubberband } from "./rubberband";

describe("rubber band", () => {
  it("is identity inside the bounds", () => {
    expect(rubberband(300, 76, 700, 700)).toBe(300);
  });

  it("resists increasingly at the edges", () => {
    const soft = rubberband(-40, 76, 700, 700);
    const hard = rubberband(-300, 76, 700, 700);
    expect(soft).toBeLessThan(76);
    expect(hard).toBeLessThan(soft);
    expect(hard).toBeGreaterThanOrEqual(0);
  });

  it("stays above the target at the top edge", () => {
    const above = rubberband(1000, 76, 700, 700);
    expect(above).toBeGreaterThan(700);
    expect(above - 700).toBeLessThanOrEqual(96);
  });
});
