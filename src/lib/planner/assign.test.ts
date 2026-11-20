import { describe, expect, it } from "vitest";
import { setFieldAssign, type FieldAssign } from "./assign";

const empty: FieldAssign = { from: null, to: null };

describe("setFieldAssign", () => {
  it("arms home for the from field only", () => {
    const next = setFieldAssign(empty, "from", "home");
    expect(next.from).toBe("home");
    expect(next.to).toBeNull();
  });

  it("keeps the other field when the second one is armed", () => {
    const from = setFieldAssign(empty, "from", "home");
    expect(setFieldAssign(from, "to", "work")).toEqual({ from: "home", to: "work" });
  });

  it("clears only the tapped field", () => {
    const armed: FieldAssign = { from: "home", to: "work" };
    expect(setFieldAssign(armed, "from", null)).toEqual({ from: null, to: "work" });
  });

  it("replaces the kind inside one field", () => {
    expect(setFieldAssign({ from: "home", to: null }, "from", "work")).toEqual({
      from: "work",
      to: null,
    });
  });
});
