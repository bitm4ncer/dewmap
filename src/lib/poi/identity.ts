import type { RawPoi } from "./nominatim";
import type { PoiSelection } from "./types";

/**
 * Identity shown on the card. The selection is authoritative for a bus
 * stop: Nominatim often has no name for a bare stop and reports the
 * nearest street as its name and "Street" as its category, which used
 * to rewrite the card from "Bus stop" into an address.
 */
export function poiIdentity(
  selection: PoiSelection,
  raw: RawPoi,
): { name: string; category: string } {
  const isBusStop = selection.category === "Bus stop";
  const name =
    isBusStop && selection.name
      ? selection.name
      : raw.name === "Unnamed place" && selection.name
        ? selection.name
        : raw.name;
  const category = isBusStop
    ? "Bus stop"
    : raw.category && raw.category !== "Place"
      ? raw.category
      : selection.category ?? raw.category;
  return { name, category };
}
