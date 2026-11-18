export const HISTORIC_CATEGORIES = [
  "castle",
  "religious",
  "archaeological",
  "memorial",
  "battlefield",
  "industrial",
  "museum",
  "other",
] as const;

export type HistoricCategory = (typeof HISTORIC_CATEGORIES)[number];

/** Properties carried in the global PMTiles archives. */
export interface HistoricSiteTile {
  id: string;
  name: string;
  category: HistoricCategory;
  inception?: number;
  dissolved?: number;
  heritage: boolean;
  unesco: boolean;
  qid: string;
}

/** A site plus its click-time enrichment; never stored in the tiles. */
export interface HistoricSiteDetail {
  summary: string | null;
  image: string | null;
  kind?: string;
  wikipedia?: string;
  osm?: string;
}

export interface HistoricManifestFile {
  path: string;
  bytes: number;
  sha256: string;
  minzoom?: number;
  maxzoom?: number;
}

export interface HistoricManifest {
  schema: 1;
  buildId: string;
  builtAt: string;
  counts: { sites: number; clusters: number };
  files: {
    clusters: HistoricManifestFile[];
    sites: HistoricManifestFile;
  };
  attribution: string[];
}

export type HistoricSourceStatus = "idle" | "loading" | "ready" | "error";
