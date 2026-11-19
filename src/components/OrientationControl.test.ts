import { describe, expect, it } from "vitest";
import { nextOrientation } from "./OrientationControl";

describe("nextOrientation", () => {
  it("toggles between north and heading", () => {
    expect(nextOrientation("north")).toBe("heading");
    expect(nextOrientation("heading")).toBe("north");
  });
});
