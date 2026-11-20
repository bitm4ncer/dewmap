import { describe, expect, it } from "vitest";
import { expandIntent } from "./panelIntent";

describe("expandIntent", () => {
  it("adopts the card as destination when the route pane opens", () => {
    expect(expandIntent("hiking", "half", true)).toBe("adopt");
    expect(expandIntent("hiking", "full", true)).toBe("adopt");
  });

  it("only dismisses the card for the other panes", () => {
    expect(expandIntent("biosphere", "half", true)).toBe("dismiss");
    expect(expandIntent("history", "full", true)).toBe("dismiss");
    expect(expandIntent("control", "half", true)).toBe("dismiss");
  });

  it("does nothing while the sheet stays collapsed or no card is up", () => {
    expect(expandIntent("hiking", "peek", true)).toBe("none");
    expect(expandIntent("hiking", "half", false)).toBe("none");
  });
});
