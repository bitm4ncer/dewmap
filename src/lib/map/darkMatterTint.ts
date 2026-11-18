export interface DarkMatterLayer {
  id: string;
  type: string;
}

export interface DarkMatterMap {
  getStyle(): { layers?: DarkMatterLayer[] } | undefined;
  getPaintProperty(layerId: string, name: string): unknown;
  setPaintProperty(layerId: string, name: string, value: unknown): void;
  setLayoutProperty(layerId: string, name: string, value: unknown): void;
}

/**
 * "Dark Matter" re-tint for the CARTO vector basemap: neutral graphite
 * land, lighter soft roads, desaturated water and parks, grey labels.
 * No colour competes with the app's accent, pins or route.
 */
export function applyDarkMatterTint(map: DarkMatterMap) {
  const layers = map.getStyle()?.layers ?? [];
  for (const layer of layers) {
    const id = layer.id.toLowerCase();
    try {
      if (layer.type === "background") {
        map.setPaintProperty(layer.id, "background-color", "#2c2d31");
        continue;
      }
      if (layer.type === "fill") {
        let color = "#2c2d31";
        if (id.includes("water")) color = "#26272b";
        else if (id.includes("building")) color = "#303136";
        else if (
          id.includes("landuse")
          || id.includes("landcover")
          || id.includes("park")
          || id.includes("wood")
          || id.includes("grass")
          || id.includes("golf")
          || id.includes("cemetery")
          || id.includes("sand")
          || id.includes("ice")
        ) {
          color = "#292a2e";
        }
        map.setPaintProperty(layer.id, "fill-color", color);
        if (typeof map.getPaintProperty(layer.id, "fill-outline-color") !== "undefined") {
          map.setPaintProperty(layer.id, "fill-outline-color", color);
        }
        continue;
      }
      if (layer.type === "line") {
        let color = "#4a4b50";
        if (id.includes("waterway")) color = "#3a3e44";
        else if (id.includes("boundary") || id.includes("admin")) color = "#515258";
        else if (id.includes("aeroway")) color = "#46474d";
        else if (id.startsWith("tunnel")) color = "#3b3c41";
        else if (id.includes("rail")) color = "#3c3d42";
        else if (id.includes("_case")) color = "#35363b";
        map.setPaintProperty(layer.id, "line-color", color);
        continue;
      }
      if (layer.type === "symbol") {
        // Keep the style's own label hierarchy, nudged into the neutral
        // palette: cities brightest, districts mid, street names quiet.
        let color = "#9ca3af";
        if (id.startsWith("place_city") || id === "place_town") {
          color = "#d7dade";
        } else if (id.startsWith("place_")) {
          color = "#a9aeb7";
        } else if (
          id.startsWith("roadname")
          || id.startsWith("watername")
          || id.startsWith("poi_")
        ) {
          color = "#8f939b";
        }
        map.setPaintProperty(layer.id, "text-color", color);
        map.setPaintProperty(layer.id, "text-halo-color", "#26272b");

        // The Dark Matter style renders these tiers too small at 1440px.
        if (
          id.startsWith("place_suburbs")
          || id.startsWith("place_villages")
          || id.startsWith("place_hamlet")
          || id === "place_town"
        ) {
          map.setLayoutProperty(layer.id, "text-size", [
            "interpolate", ["linear"], ["zoom"],
            10, 10,
            13, 11.5,
            16, 13,
          ]);
          map.setLayoutProperty(layer.id, "text-letter-spacing", 0.04);
        }
        if (id.startsWith("roadname")) {
          map.setLayoutProperty(layer.id, "text-size", [
            "interpolate", ["linear"], ["zoom"],
            12, 9,
            16, 11,
            18, 12,
          ]);
          map.setPaintProperty(layer.id, "text-halo-width", 1);
        }
        continue;
      }
      if (layer.type === "circle") {
        map.setPaintProperty(layer.id, "circle-color", "#9ca3af");
      }
    } catch {
      // Not every layer exposes every paint property — best effort.
    }
  }
}
