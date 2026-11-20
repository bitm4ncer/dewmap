/**
 * Identifies one transit search. Used to fire a search as soon as both ends
 * are set and to avoid re-running the same request when nothing the backend
 * sees has changed. Coordinates are rounded so tiny jitters from map picks do
 * not look like a new question.
 */
export interface TransitSearchKeyInput {
  from: { lat: number; lon: number } | null;
  to: { lat: number; lon: number } | null;
  via: { id?: string; lat: number; lon: number }[];
  when: string;
  arriveBy: boolean;
  maxTransfers: number;
  maxWalkMin: number;
  modes: string[];
  accessible: boolean;
  bike: boolean;
}

const round = (value: number) => Math.round(value * 1e5) / 1e5;

export function transitSearchKey(input: TransitSearchKeyInput): string | null {
  if (!input.from || !input.to) return null;
  const point = (p: { lat: number; lon: number }) => `${round(p.lat)},${round(p.lon)}`;
  return [
    point(input.from),
    point(input.to),
    input.via.map((p) => p.id ?? point(p)).join("+"),
    input.when,
    input.arriveBy ? "arrive" : "depart",
    String(input.maxTransfers),
    String(input.maxWalkMin),
    [...input.modes].sort().join(","),
    input.accessible ? "step-free" : "any",
    input.bike ? "bike" : "foot",
  ].join("|");
}
