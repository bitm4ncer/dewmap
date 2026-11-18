import type { Waypoint } from "@/lib/hiking/types";

/** A route endpoint in the shape shared by every travel mode. */
export interface RoutePoint {
  id?: string;
  name: string;
  lat: number;
  lon: number;
  city?: string;
  kind?: "address" | "stop";
}

export interface RouteInput {
  start: RoutePoint | null;
  end: RoutePoint | null;
  via: RoutePoint[];
}

type PlaceLike = {
  id?: string;
  name: string;
  lat: number;
  lon: number;
  city?: string;
  kind?: string;
};

function fromPlace(place: PlaceLike | null | undefined): RoutePoint | null {
  if (!place) return null;
  return {
    id: place.id,
    name: place.name,
    lat: place.lat,
    lon: place.lon,
    city: place.city,
    kind: place.kind === "stop" ? "stop" : "address",
  };
}

export function inputFromTransit(
  from: PlaceLike | null,
  to: PlaceLike | null,
  via: (PlaceLike | null)[],
): RouteInput {
  return {
    start: fromPlace(from),
    end: fromPlace(to),
    via: via.map(fromPlace).filter((p): p is RoutePoint => p !== null),
  };
}

export function inputFromWaypoints(waypoints: Waypoint[]): RouteInput {
  if (waypoints.length === 0) return { start: null, end: null, via: [] };
  const points = waypoints.map((w) => ({
    name: w.label,
    lat: w.lat,
    lon: w.lon,
    kind: "address" as const,
  }));
  return {
    start: points[0],
    end: points.length > 1 ? points[points.length - 1] : null,
    via: points.slice(1, -1),
  };
}

export function inputWithPin(start: RoutePoint, end: RoutePoint): RouteInput {
  return { start, end, via: [] };
}

export function toTransitPlaces(input: RouteInput) {
  const from = input.start
    ? {
        ...input.start,
        kind: input.start.kind ?? "address",
      }
    : null;
  const to = input.end
    ? {
        ...input.end,
        kind: input.end.kind ?? "address",
      }
    : null;
  return { from, to, via: input.via.slice(0, 2) };
}

export function toWaypoints(input: RouteInput): Omit<Waypoint, "id">[] {
  const points = [input.start, ...input.via, input.end].filter(
    (p): p is RoutePoint => p !== null,
  );
  return points.map((point) => ({
    lat: point.lat,
    lon: point.lon,
    label: point.name,
    source: point.name === "My location" ? "gps" : "search",
  }));
}
