import type { SheetState } from "./useSheetGesture";

/**
 * Sheet bookkeeping for the place detail card.
 *
 * The card and the sheet share one bottom edge, so only one of them may be
 * open at a time. Opening a place collapses the sheet to peek and remembers
 * the size it had; expanding the sheet again dismisses the card and drops the
 * memory, so a later close cannot snap the sheet back behind the user's back.
 */
export interface PoiSheetState {
  /** Sheet size to restore when the card closes on its own. */
  saved: SheetState | null;
}

export type PoiSheetEvent =
  | { type: "open-poi"; isMobile: boolean; sheetState: SheetState }
  | { type: "close-poi"; isMobile: boolean }
  | { type: "sheet-state"; sheetState: SheetState; cardOpen: boolean };

export function poiSheetReduce(
  state: PoiSheetState,
  event: PoiSheetEvent,
): { state: PoiSheetState; snapTo: SheetState | null; dismissCard: boolean } {
  switch (event.type) {
    case "open-poi":
      if (!event.isMobile || state.saved !== null || event.sheetState === "peek") {
        return { state, snapTo: null, dismissCard: false };
      }
      return { state: { saved: event.sheetState }, snapTo: "peek", dismissCard: false };
    case "sheet-state":
      if (!event.cardOpen || event.sheetState === "peek") {
        return { state, snapTo: null, dismissCard: false };
      }
      return { state: { saved: null }, snapTo: null, dismissCard: true };
    case "close-poi": {
      const target = event.isMobile ? state.saved : null;
      return { state: { saved: null }, snapTo: target, dismissCard: false };
    }
  }
}
