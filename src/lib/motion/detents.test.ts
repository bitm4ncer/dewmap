import { describe, expect, it } from "vitest";
import { chooseDetent } from "./detents";

const detents = [
  { state: "peek", height: 76 },
  { state: "half", height: 336 },
  { state: "full", height: 700 },
] as const;

describe("detent selection", () => {
  it("stays put on a tiny drag", () => {
    expect(chooseDetent("half", 340, 0, detents)).toBe("half");
  });

  it("chooses the next detent on a flick", () => {
    expect(chooseDetent("half", 340, 900, detents)).toBe("full");
    expect(chooseDetent("full", 690, -900, detents)).toBe("half");
  });

  it("projects a slow drag", () => {
    expect(chooseDetent("half", 500, 500, detents)).toBe("full");
    expect(chooseDetent("half", 250, -500, detents)).toBe("peek");
  });

  it("clamps at the edges", () => {
    expect(chooseDetent("peek", 80, -900, detents)).toBe("peek");
    expect(chooseDetent("full", 690, 900, detents)).toBe("full");
  });
});
