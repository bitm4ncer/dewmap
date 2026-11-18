import { describe, expect, it } from "vitest";
import { edgeIndicator } from "./edgeIndicator";

const size = { width: 400, height: 600 };
const insets = { top: 20, right: 20, bottom: 20, left: 20 };

describe("edgeIndicator", () => {
  it("hides when the point is inside the safe area", () => {
    expect(edgeIndicator({ x: 200, y: 300 }, size, insets)).toBeNull();
  });

  it("sticks an off-screen point to the matching edge", () => {
    expect(edgeIndicator({ x: 520, y: 300 }, size, insets)).toMatchObject({ x: 380, y: 300, angle: 0 });
    expect(edgeIndicator({ x: 200, y: -60 }, size, insets)).toMatchObject({ x: 200, y: 20, angle: -90 });
  });

  it("respects asymmetric insets", () => {
    const hint = edgeIndicator(
      { x: 200, y: 700 },
      size,
      { top: 20, right: 20, bottom: 220, left: 20 },
    );
    expect(hint).not.toBeNull();
    expect(hint!.y).toBe(380);
    expect(hint!.angle).toBe(90);
  });
});
