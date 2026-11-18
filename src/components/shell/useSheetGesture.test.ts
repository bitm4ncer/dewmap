import { describe, expect, it } from "vitest";
import { canDrag, canStartDrag, gestureDirection, pickSnap } from "./useSheetGesture";

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

  it("snaps one step in the drag direction", () => {
    const snap = { peek: 56, modes: 116, half: 405, full: 844 };
    expect(pickSnap("half", 665, -0.5, snap)).toBe("full");
    expect(pickSnap("full", 624, 0.5, snap)).toBe("half");
    expect(pickSnap("half", 405, -0.9, snap)).toBe("full"); // flick wins
    expect(pickSnap("peek", 70, 0, snap)).toBe("peek"); // short drag returns
    expect(pickSnap("peek", 300, 0.9, snap)).toBe("peek"); // no lower state
    expect(pickSnap("modes", 160, 0, snap)).toBe("modes"); // small drag returns
    expect(pickSnap("modes", 260, -0.9, snap)).toBe("half"); // flick up
  });

  it("keeps panel-body scrolling native until the top", () => {
    expect(canStartDrag("half", "up", true, 0)).toBe(false);
    expect(canStartDrag("half", "down", true, 40)).toBe(false);
    expect(canStartDrag("half", "down", true, 0)).toBe(true);
    expect(canStartDrag("half", "up", false, 0)).toBe(true);
  });
});
