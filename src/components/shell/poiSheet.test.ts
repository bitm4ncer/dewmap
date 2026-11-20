import { describe, expect, it } from "vitest";
import { poiSheetReduce, type PoiSheetState } from "./poiSheet";

const empty: PoiSheetState = { saved: null };

describe("poiSheetReduce", () => {
  it("remembers the sheet size and collapses to peek when a place opens", () => {
    const r = poiSheetReduce(empty, { type: "open-poi", isMobile: true, sheetState: "half" });
    expect(r.state.saved).toBe("half");
    expect(r.snapTo).toBe("peek");
  });

  it("does not collapse when the sheet is already at peek", () => {
    const r = poiSheetReduce(empty, { type: "open-poi", isMobile: true, sheetState: "peek" });
    expect(r.state.saved).toBeNull();
    expect(r.snapTo).toBeNull();
  });

  it("ignores the collapse on desktop", () => {
    const r = poiSheetReduce(empty, { type: "open-poi", isMobile: false, sheetState: "half" });
    expect(r.state.saved).toBeNull();
    expect(r.snapTo).toBeNull();
  });

  it("drops the saved size and dismisses the card when the sheet expands", () => {
    const open: PoiSheetState = { saved: "half" };
    const r = poiSheetReduce(open, { type: "sheet-state", sheetState: "half", cardOpen: true });
    expect(r.state.saved).toBeNull();
    expect(r.dismissCard).toBe(true);
    expect(r.snapTo).toBeNull();
  });

  it("keeps the card while the sheet stays at peek", () => {
    const r = poiSheetReduce({ saved: null }, { type: "sheet-state", sheetState: "peek", cardOpen: true });
    expect(r.dismissCard).toBe(false);
    expect(r.state.saved).toBeNull();
  });

  it("leaves an absent card alone when the sheet moves", () => {
    const r = poiSheetReduce({ saved: null }, { type: "sheet-state", sheetState: "full", cardOpen: false });
    expect(r.dismissCard).toBe(false);
  });

  it("restores the remembered size when the card closes", () => {
    const r = poiSheetReduce({ saved: "half" }, { type: "close-poi", isMobile: true });
    expect(r.snapTo).toBe("half");
    expect(r.state.saved).toBeNull();
  });

  it("leaves the sheet alone when nothing was remembered", () => {
    const r = poiSheetReduce({ saved: null }, { type: "close-poi", isMobile: true });
    expect(r.snapTo).toBeNull();
  });
});
