import { describe, expect, it } from "vitest";
import {
  canDrag,
  canOverscroll,
  canStartDrag,
  gestureDirection,
  pickSnap,
  rubberband,
  sheetMetrics,
} from "./useSheetGesture";

describe("sheet gesture", () => {
  it("locks to a dominant vertical axis", () => {
    expect(gestureDirection(2, -14)).toBe("up");
    expect(gestureDirection(2, 14)).toBe("down");
    expect(gestureDirection(14, -2)).toBe("none");
    expect(gestureDirection(2, -6)).toBe("none");
  });

  it("only allows directions that change the sheet state", () => {
    expect(canDrag("half", "up")).toBe(true);
    expect(canDrag("half", "down")).toBe(false);
    expect(canDrag("full", "up")).toBe(false);
    expect(canDrag("full", "down")).toBe(true);
  });

  it("snaps in the drag direction or by projection", () => {
    const snap = { half: 405, full: 844 };
    expect(pickSnap("half", 665, 500, snap)).toBe("full");
    expect(pickSnap("full", 624, -500, snap)).toBe("half");
    expect(pickSnap("half", 405, 900, snap)).toBe("full"); // flick wins
    expect(pickSnap("half", 300, -900, snap)).toBe("half"); // no lower state
    expect(pickSnap("half", 300, 0, snap)).toBe("half"); // short drag returns
    expect(pickSnap("full", 700, 0, snap)).toBe("full");
    expect(pickSnap("full", 500, 0, snap)).toBe("half"); // projected below mid
  });

  it("only stretches at the outer edges", () => {
    expect(canOverscroll("half", "down")).toBe(true);
    expect(canOverscroll("half", "up")).toBe(false);
    expect(canOverscroll("full", "up")).toBe(true);
    expect(canOverscroll("full", "down")).toBe(false);
    expect(canStartDrag("half", "down", false)).toBe(true);
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
    expect(canStartDrag("half", "up", true)).toBe(false);
    expect(canStartDrag("full", "up", true)).toBe(false);
    expect(canStartDrag("full", "down", true)).toBe(false);
    expect(canStartDrag("full", "up", false)).toBe(true);
    expect(canStartDrag("half", "up", false)).toBe(true);
    expect(canStartDrag("half", "down", false)).toBe(true);
  });

  it("keeps the two detents tied to the viewport height", () => {
    const m = sheetMetrics(844);
    expect(m.full).toBe(844);
    expect(m.half).toBe(405);
    expect(sheetMetrics(700).half).toBe(336);
  });
});
