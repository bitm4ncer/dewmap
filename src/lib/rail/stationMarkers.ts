/**
 * Station markers merge the same physical station across tile features.
 * A place can be a heavy-rail station and a tram stop (and sometimes a
 * subway station) at once; OMT stores one feature per class, so the
 * marker carries up to three kinds and the map draws them as nested
 * rings (outer = highest service class).
 */
export type StationKind = "rail" | "subway" | "tram";

export interface StationInput {
  name: string;
  lon: number;
  lat: number;
  kind: StationKind;
}

export interface StationMarker {
  name: string;
  lon: number;
  lat: number;
  kinds: StationKind[];
}

/** Priority for the outer ring: heavy rail first, then subway, then tram. */
const KIND_PRIORITY: Record<StationKind, number> = {
  rail: 0,
  subway: 1,
  tram: 2,
};

export function classifyStationSubclass(
  subclass: string | undefined,
): StationKind | null {
  if (subclass === "subway") return "subway";
  if (subclass === "tram_stop") return "tram";
  if (subclass === "station" || subclass === "halt") return "rail";
  return null;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function distanceMeters(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLon = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Group station features by name and proximity. Unnamed features stay
 * standalone. `mergeRadiusM` covers a large interchange without joining
 * unrelated stops that merely share a name.
 */
export function mergeStations(
  items: readonly StationInput[],
  mergeRadiusM = 300,
): StationMarker[] {
  const markers: StationMarker[] = [];
  for (const item of items) {
    const name = normalizeName(item.name);
    const target = name
      ? markers.find(
          (marker) =>
            normalizeName(marker.name) === name &&
            distanceMeters(marker, item) <= mergeRadiusM,
        )
      : undefined;
    if (!target) {
      markers.push({
        name: item.name,
        lon: item.lon,
        lat: item.lat,
        kinds: [item.kind],
      });
      continue;
    }
    const previousTop = target.kinds[0];
    if (!target.kinds.includes(item.kind)) {
      target.kinds.push(item.kind);
      target.kinds.sort((a, b) => KIND_PRIORITY[a] - KIND_PRIORITY[b]);
    }
    // Anchor the marker on the highest-priority service.
    if (KIND_PRIORITY[item.kind] < KIND_PRIORITY[previousTop]) {
      target.lon = item.lon;
      target.lat = item.lat;
    }
  }
  return markers;
}

/** GeoJSON for the merged station layers. */
export function stationsToGeoJson(
  markers: readonly StationMarker[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: markers.map((marker) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [marker.lon, marker.lat] },
      properties: {
        name: marker.name,
        kind: marker.kinds[0],
        ...(marker.kinds[1] ? { kind2: marker.kinds[1] } : {}),
        ...(marker.kinds[2] ? { kind3: marker.kinds[2] } : {}),
      },
    })),
  };
}
