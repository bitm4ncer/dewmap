import { describe, expect, it } from "vitest";
import {
  canDrag,
  canOverscroll,
  canStartDrag,
  gestureDirection,
  pickSnap,
  rubberband,
} from "./useSheetGesture";

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
    expect(pickSnap("half", 665, 500, snap)).toBe("full");
    expect(pickSnap("full", 624, -500, snap)).toBe("half");
    expect(pickSnap("half", 405, 900, snap)).toBe("full"); // flick wins
    expect(pickSnap("peek", 70, 0, snap)).toBe("peek"); // short drag returns
    expect(pickSnap("peek", 300, -900, snap)).toBe("peek"); // no lower state
    expect(pickSnap("modes", 160, 0, snap)).toBe("modes"); // small drag returns
    expect(pickSnap("modes", 260, 900, snap)).toBe("half"); // flick up
  });

  it("only stretches at the outer edges", () => {
    expect(canOverscroll("peek", "down")).toBe(true);
    expect(canOverscroll("peek", "up")).toBe(false);
    expect(canOverscroll("full", "up")).toBe(true);
    expect(canOverscroll("full", "down")).toBe(false);
    expect(canOverscroll("half", "down")).toBe(false);
    expect(canStartDrag("peek", "down", false, 0)).toBe(true);
  });

  it("applies bounded rubber-band resistance", () => {
    expect(rubberband(300, 76, 844, 700)).toBe(300);
    const below = rubberband(-100, 76, 844, 700);
    expect(below).toBeLessThan(76);
    expect(below).toBeGreaterThan(4);
    const above = rubberband(1000, 76, 844, 700);
    expect(above).toBeGreaterThan(844);
    expect(above).toBeLessThan(917);
    const soft = rubberband(-100, 76, 844, 700);
    const harder = rubberband(-300, 76, 844, 700);
    expect(harder).toBeLessThan(soft);
    expect(76 - harder).toBeLessThanOrEqual(96);
    expect(harder).toBeGreaterThanOrEqual(0);
  });

  it("hands vertical body gestures at the top to the sheet", () => {
    expect(canStartDrag("half", "up", true, 0)).toBe(true);
    expect(canStartDrag("half", "up", true, 40)).toBe(false);
    expect(canStartDrag("half", "down", true, 40)).toBe(false);
    expect(canStartDrag("half", "down", true, 0)).toBe(true);
    expect(canStartDrag("full", "up", true, 0)).toBe(false);
    expect(canStartDrag("full", "down", true, 0)).toBe(true);
    expect(canStartDrag("full", "up", false, 0)).toBe(true);
    expect(canStartDrag("half", "up", false, 0)).toBe(true);
  });
});
