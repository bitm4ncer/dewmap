import { overpassQuery } from "../overpass";

/**
 * Fetch green/natural polygons within a bounding box.
 * bbox = [south, west, north, east] (Overpass order).
 */
export async function fetchGreenPolygons(
  bbox: [number, number, number, number],
  signal?: AbortSignal,
): Promise<GeoJSON.Feature<GeoJSON.Polygon>[]> {
  const [s, w, n, e] = bbox;
  const q = `
    [out:json][timeout:30];
    (
      way[landuse~"^(forest|meadow|farmland|grass|recreation_ground|orchard|vineyard|cemetery|village_green|allotments)$"](${s},${w},${n},${e});
      way[natural~"^(wood|heath|grassland|scrub|fell)$"](${s},${w},${n},${e});
      way[leisure~"^(park|nature_reserve|garden|golf_course)$"](${s},${w},${n},${e});
    );
    out geom;
  `;
  // The query asks the server for 30 s; the client must outlast it.
  const data = await overpassQuery(q, signal, { timeoutMs: 35_000 });
  const polygons: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  for (const el of data.elements) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 3) continue;
    const coords: [number, number][] = el.geometry.map((g) => [g.lon, g.lat]);
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
    polygons.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [coords] },
      properties: { id: el.id, ...(el.tags ?? {}) },
    });
  }
  return polygons;
}
