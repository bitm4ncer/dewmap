/**
 * Encoded-polyline decoder (Google/Valhalla/MOTIS style).
 *
 * All routing providers deliver an encoded polyline where the first delta is
 * latitude and the second is longitude. The precision varies: Valhalla uses 6,
 * MOTIS currently uses 7 (and advertises it in `legGeometry.precision`).
 */

import type { LatLng } from "./types";

interface DecodedValue {
  value: number;
  next: number;
}

function decodeValue(encoded: string, start: number): DecodedValue | null {
  let index = start;
  let result = 0;
  let shift = 0;

  while (index < encoded.length) {
    const code = encoded.charCodeAt(index) - 63;
    if (code < 0) return null;
    index += 1;
    // Use arithmetic rather than 32-bit bitwise ops: precision-7 polylines
    // routinely need more than 32 bits for the initial coordinate.
    result += (code & 0x1f) * 2 ** shift;
    shift += 5;
    if (code < 0x20) {
      const value = result % 2 === 1 ? -(result + 1) / 2 : result / 2;
      return { value, next: index };
    }
    // Guard against pathological input rather than looping forever.
    if (shift > 50) return null;
  }
  return null;
}

/** Decode a polyline into named latitude/longitude points. */
export function decodePolyline(encoded: string, precision = 6): LatLng[] {
  const factor = 10 ** precision;
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    const latDelta = decodeValue(encoded, index);
    if (!latDelta) break;
    const lonDelta = decodeValue(encoded, latDelta.next);
    if (!lonDelta) break;

    lat += latDelta.value;
    lon += lonDelta.value;
    points.push({ lat: lat / factor, lon: lon / factor });
    index = lonDelta.next;
  }

  return points;
}

/** Convert decoded polyline points into GeoJSON `[lon, lat]` pairs. */
export function toLonLat(points: LatLng[]): [number, number][] {
  return points.map((point) => [point.lon, point.lat]);
}
