import { cellToLatLng, latLngToCell } from "h3-js";

export const CLUSTER_BANDS = [
  { resolution: 1, minzoom: 0, maxzoom: 1 },
  { resolution: 2, minzoom: 2, maxzoom: 3 },
  { resolution: 3, minzoom: 4, maxzoom: 5 },
  { resolution: 4, minzoom: 6, maxzoom: 7 },
];

export function bandForZoom(zoom) {
  return CLUSTER_BANDS.find(
    (band) => zoom >= band.minzoom && zoom <= band.maxzoom,
  );
}

export function clusterSites(sites, { resolution }) {
  const cells = new Map();
  for (const site of sites) {
    if (!Number.isFinite(site.lon) || !Number.isFinite(site.lat)) continue;
    const cell = latLngToCell(site.lat, site.lon, resolution);
    let cluster = cells.get(cell);
    if (!cluster) {
      const [lat, lon] = cellToLatLng(cell);
      cluster = {
        id: `h3-${resolution}-${cell}`,
        cell,
        coordinates: [lon, lat],
        count: 0,
        heritageCount: 0,
        unescoCount: 0,
      };
      cells.set(cell, cluster);
    }
    cluster.count += 1;
    if (site.heritage) cluster.heritageCount += 1;
    if (site.unesco) cluster.unescoCount += 1;
  }
  return [...cells.values()];
}
