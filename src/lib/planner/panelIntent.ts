import type { SheetState } from "@/components/shell/useSheetGesture";

export type PanelPane = "control" | "hiking" | "biosphere" | "history";

/**
 * What a bottom sheet that opens while the place card is up should do.
 *
 * `hiking` is the Routes pane (the key names predate the pane labels). Opening
 * it adopts the place the card showed as the route destination; any other pane
 * simply dismisses the card.
 */
export function expandIntent(
  pane: PanelPane,
  sheetState: SheetState,
  cardOpen: boolean,
): "adopt" | "dismiss" | "none" {
  if (!cardOpen || sheetState === "peek") return "none";
  return pane === "hiking" ? "adopt" : "dismiss";
}
