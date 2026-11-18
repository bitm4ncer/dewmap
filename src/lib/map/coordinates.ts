/** Plain "lat, lon" text for pasting into other maps. */
export function formatCoordinates(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}
