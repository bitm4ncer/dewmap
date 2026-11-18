import { describe, expect, it } from "vitest";
import { canDrag, gestureDirection } from "./useSheetGesture";

describe("sheet gesture", () => {
  it("locks to a dominant vertical axis", () => {
    expect(gestureDirection(2, -14)).toBe("up");
    expect(gestureDirection(2, 14)).toBe("down");
    expect(gestureDirection(14, -2)).toBe("none");
    expect(gestureDirection(2, -6)).toBe("none");
  });

  it("only allows directions that change the sheet state", () => {
    expect(canDrag("peek", "up")).toBe(true);
    expect(canDrag("peek", "down")).toBe(false);
    expect(canDrag("half", "up")).toBe(true);
    expect(canDrag("half", "down")).toBe(true);
    expect(canDrag("full", "up")).toBe(false);
    expect(canDrag("full", "down")).toBe(true);
  });
});
