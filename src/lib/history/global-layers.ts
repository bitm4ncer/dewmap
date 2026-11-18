import type {
  CircleLayerSpecification,
  FilterSpecification,
  Map as MLMap,
} from "maplibre-gl";
import type { HistoricCategory } from "./types";

export interface GlobalClusterSource {
  url: string;
  minzoom: number;
  maxzoom: number;
}

export interface GlobalLayerOptions {
  clusters: GlobalClusterSource[];
  sitesUrl: string;
  font?: string;
  beforeId?: string;
}

export interface GlobalFilters {
  year: number;
  categories: readonly HistoricCategory[];
  heritageOnly: boolean;
  unescoOnly: boolean;
}

const CLUSTER_SOURCE_PREFIX = "history-global-clusters";
export const GLOBAL_SITE_SOURCE_ID = "history-global-sites";
export const GLOBAL_SITE_LAYER_ID = "history-global-sites-dot";
export const GLOBAL_SITE_LABEL_LAYER_ID = "history-global-sites-label";

function clusterSourceId(minzoom: number, maxzoom: number): string {
  return `${CLUSTER_SOURCE_PREFIX}-${minzoom}-${maxzoom}`;
}

function clusterDotId(minzoom: number, maxzoom: number): string {
  return `${clusterSourceId(minzoom, maxzoom)}-dot`;
}

function clusterCountId(minzoom: number, maxzoom: number): string {
  return `${clusterSourceId(minzoom, maxzoom)}-count`;
}

export function globalLayerIds() {
  const clusterSources: string[] = [];
  const clusterDots: string[] = [];
  const clusterCounts: string[] = [];
  for (let minzoom = 0; minzoom <= 6; minzoom += 2) {
    const maxzoom = minzoom + 1;
    clusterSources.push(clusterSourceId(minzoom, maxzoom));
    clusterDots.push(clusterDotId(minzoom, maxzoom));
    clusterCounts.push(clusterCountId(minzoom, maxzoom));
  }
  return {
    clusterSources,
    clusterDots,
    clusterCounts,
    siteSource: GLOBAL_SITE_SOURCE_ID,
    siteLayer: GLOBAL_SITE_LAYER_ID,
    siteLabel: GLOBAL_SITE_LABEL_LAYER_ID,
  };
}

export function buildClusterFilter({
  heritageOnly,
  unescoOnly,
}: Pick<GlobalFilters, "heritageOnly" | "unescoOnly">): FilterSpecification | null {
  const clauses: FilterSpecification[] = [];
  if (heritageOnly) clauses.push([">", ["get", "heritageCount"], 0]);
  if (unescoOnly) clauses.push([">", ["get", "unescoCount"], 0]);
  return clauses.length > 0 ? (["all", ...clauses] as FilterSpecification) : null;
}

export function buildSiteFilter({
  year,
  categories,
  heritageOnly,
  unescoOnly,
}: GlobalFilters): FilterSpecification {
  const clauses: FilterSpecification[] = [
    [
      "case",
      ["has", "inception"],
      ["<=", ["get", "inception"], year],
      true,
    ] as FilterSpecification,
    [
      ">=",
      ["coalesce", ["get", "dissolved"], 9999],
      year,
    ] as FilterSpecification,
  ];
  if (heritageOnly) clauses.push(["==", ["get", "heritage"], true]);
  if (unescoOnly) clauses.push(["==", ["get", "unesco"], true]);
  if (categories.length > 0) {
    clauses.push([
      "in",
      ["get", "category"],
      ["literal", [...categories]],
    ] as FilterSpecification);
  }
  return ["all", ...clauses] as FilterSpecification;
}

function sitePaint(): CircleLayerSpecification["paint"] {
  return {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      8, 2.2,
      10, 3,
      14, 4.5,
      18, 6,
    ],
    "circle-color": [
      "case",
      ["get", "unesco"],
      "#D8B26A",
      ["get", "heritage"],
      "#C08FA3",
      "#7FB3C4",
    ],
    "circle-stroke-color": "#FFFFFF",
    "circle-stroke-width": 1.1,
    "circle-opacity": 0.9,
  } as CircleLayerSpecification["paint"];
}

export function ensureGlobalLayers(
  map: MLMap,
  { clusters, sitesUrl, font = "Noto Sans Regular", beforeId }: GlobalLayerOptions,
) {
  for (const cluster of clusters) {
    const sourceId = clusterSourceId(cluster.minzoom, cluster.maxzoom);
    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "vector",
        url: cluster.url,
      });
    }
    const dotId = clusterDotId(cluster.minzoom, cluster.maxzoom);
    if (!map.getLayer(dotId)) {
      map.addLayer(
        {
          id: dotId,
          type: "circle",
          source: sourceId,
          "source-layer": "history_clusters",
          minzoom: cluster.minzoom,
          maxzoom: cluster.maxzoom,
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["get", "count"],
              1, 5,
              10, 8,
              100, 13,
              1000, 19,
            ],
            "circle-color": "#C08FA3",
            "circle-stroke-color": "#FFFFFF",
            "circle-stroke-width": 1.2,
            "circle-opacity": 0.88,
          },
        },
        beforeId,
      );
    }
    const countId = clusterCountId(cluster.minzoom, cluster.maxzoom);
    if (!map.getLayer(countId)) {
      map.addLayer(
        {
          id: countId,
          type: "symbol",
          source: sourceId,
          "source-layer": "history_clusters",
          minzoom: cluster.minzoom,
          maxzoom: cluster.maxzoom,
          layout: {
            "text-field": ["to-string", ["get", "count"]],
            "text-font": [font],
            "text-size": 10,
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": "#0F1416",
          },
        },
        beforeId,
      );
    }
  }

  if (!map.getSource(GLOBAL_SITE_SOURCE_ID)) {
    map.addSource(GLOBAL_SITE_SOURCE_ID, {
      type: "vector",
      url: sitesUrl,
    });
  }
  if (!map.getLayer(GLOBAL_SITE_LAYER_ID)) {
    map.addLayer(
      {
        id: GLOBAL_SITE_LAYER_ID,
        type: "circle",
        source: GLOBAL_SITE_SOURCE_ID,
        "source-layer": "history_sites",
        minzoom: 8,
        paint: sitePaint(),
      },
      beforeId,
    );
  }
  if (!map.getLayer(GLOBAL_SITE_LABEL_LAYER_ID)) {
    map.addLayer(
      {
        id: GLOBAL_SITE_LABEL_LAYER_ID,
        type: "symbol",
        source: GLOBAL_SITE_SOURCE_ID,
        "source-layer": "history_sites",
        minzoom: 10,
        layout: {
          "text-field": ["get", "name"],
          "text-font": [font],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 9, 16, 12],
          "text-offset": [0, 1],
          "text-anchor": "top",
          "text-optional": true,
          "text-allow-overlap": false,
          "text-padding": 4,
        },
        paint: {
          "text-color": "#E9EEF0",
          "text-halo-color": "#0B0E10",
          "text-halo-width": 1.4,
        },
      },
      beforeId,
    );
  }
}

export function applyGlobalFilters(map: MLMap, filters: GlobalFilters) {
  const clusterFilter = buildClusterFilter(filters);
  const siteFilter = buildSiteFilter(filters);
  const ids = globalLayerIds();
  for (const id of ids.clusterDots) {
    if (map.getLayer(id)) map.setFilter(id, clusterFilter);
  }
  for (const id of ids.clusterCounts) {
    if (map.getLayer(id)) map.setFilter(id, clusterFilter);
  }
  if (map.getLayer(ids.siteLayer)) map.setFilter(ids.siteLayer, siteFilter);
  if (map.getLayer(ids.siteLabel)) map.setFilter(ids.siteLabel, siteFilter);
}

export function removeGlobalLayers(map: MLMap) {
  const ids = globalLayerIds();
  for (const id of [...ids.clusterCounts, ...ids.clusterDots, ids.siteLabel, ids.siteLayer]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [...ids.clusterSources, ids.siteSource]) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

export function countGlobalSites(map: Pick<MLMap, "querySourceFeatures">): number {
  const features = map.querySourceFeatures(GLOBAL_SITE_SOURCE_ID, {
    sourceLayer: "history_sites",
  });
  const ids = new Set<string>();
  for (const feature of features) {
    const id = feature.properties?.id;
    if (typeof id === "string") ids.add(id);
  }
  return ids.size;
}
