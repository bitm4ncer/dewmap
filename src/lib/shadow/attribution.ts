/**
 * Data sources and licence obligations for the shadow map.
 *
 * Kept as data so the panel, the docs and the build pipeline all quote the
 * same strings. Verified against the providers' pages on 2026-11-21.
 */
export interface ShadowSource {
  id: string;
  label: string;
  url: string;
  /** SPDX-ish identifier or the provider's own name. */
  license: string;
  licenseUrl: string;
  /** Exact wording to show, when the licence requires one. */
  attribution?: string;
  coverage: string;
  /** Native ground resolution in metres. */
  resolutionM: number;
  /** Informal note for the UI ("no attribution required", "bulk only", ...). */
  note?: string;
}

export const SHADOW_SOURCES: Record<string, ShadowSource> = {
  nrwDgm1: {
    id: "nrw-dgm1",
    label: "Geobasis NRW DGM1",
    url: "https://www.opengeodata.nrw.de/produkte/geobasis/hm/dgm1_tiff/dgm1_tiff/",
    license: "Datenlizenz Deutschland – Zero – Version 2.0",
    licenseUrl: "https://www.govdata.de/dl-de/zero-2-0",
    coverage: "Nordrhein-Westfalen",
    resolutionM: 1,
    note: "No attribution or conditions required; credit anyway.",
  },
  nrwDom1: {
    id: "nrw-dom1",
    label: "Geobasis NRW DOM1",
    url: "https://www.opengeodata.nrw.de/produkte/geobasis/hm/dom1_tiff/dom1_tiff/",
    license: "Datenlizenz Deutschland – Zero – Version 2.0",
    licenseUrl: "https://www.govdata.de/dl-de/zero-2-0",
    coverage: "Nordrhein-Westfalen",
    resolutionM: 1,
    note: "Surface model: buildings, bridges and vegetation are already inside. Best single input for raster shadows.",
  },
  nrwLod2: {
    id: "nrw-lod2",
    label: "Geobasis NRW LoD2",
    url: "https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod2_gml/lod2_gml/",
    license: "Datenlizenz Deutschland – Zero – Version 2.0",
    licenseUrl: "https://www.govdata.de/dl-de/zero-2-0",
    coverage: "Nordrhein-Westfalen",
    resolutionM: 0,
    note: "CityGML, 1 km tiles, 219.6 GB for the state; needed only for roof-accurate vector shadows.",
  },
  bwDgm1: {
    id: "bw-dgm1",
    label: "LGL Baden-Württemberg DGM1",
    url: "https://opengeodata.lgl-bw.de/",
    license: "Datenlizenz Deutschland – Namensnennung – Version 2.0",
    licenseUrl: "https://www.govdata.de/dl-de/by-2-0",
    attribution: "Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0",
    coverage: "Baden-Württemberg",
    resolutionM: 1,
  },
  bwLod2: {
    id: "bw-lod2",
    label: "LGL Baden-Württemberg LoD2",
    url: "https://opengeodata.lgl-bw.de/",
    license: "Datenlizenz Deutschland – Namensnennung – Version 2.0",
    licenseUrl: "https://www.govdata.de/dl-de/by-2-0",
    attribution: "Datenquelle: LGL, www.lgl-bw.de, dl-de/by-2-0",
    coverage: "Baden-Württemberg",
    resolutionM: 0,
    note: "CityGML in 2 km tiles.",
  },
  byDgm1: {
    id: "by-dgm1",
    label: "Bayerische Vermessungsverwaltung DGM1",
    url: "https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=dgm1",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Geobasisdaten: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, Lizenz: CC BY 4.0",
    coverage: "Bayern",
    resolutionM: 1,
  },
  byLod2: {
    id: "by-lod2",
    label: "Bayerische Vermessungsverwaltung LoD2",
    url: "https://geodaten.bayern.de/opengeodata/OpenDataDetail.html?pn=lod2",
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Datenquelle: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de",
    coverage: "Bayern",
    resolutionM: 0,
    note: "CityGML, 1 km tiles, annual update.",
  },
  copernicusDem30: {
    id: "copernicus-dem-30",
    label: "Copernicus DEM GLO-30",
    url: "https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
    license: "Free, Copernicus DEM licence",
    licenseUrl: "https://doi.org/10.5270/ESA-c5d3d65",
    attribution:
      "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved",
    coverage: "Global",
    resolutionM: 30,
    note: "DSM: includes buildings and vegetation. Free for GLO-30/GLO-90; EEA-10 is restricted.",
  },
  terrarium: {
    id: "terrarium",
    label: "Mapzen Terrain Tiles (AWS Open Data)",
    url: "https://registry.opendata.aws/terrain-tiles/",
    license: "Mixed, attribution required",
    licenseUrl: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
    attribution:
      "Europe terrain data produced using Copernicus data and information funded by the European Union – EU-DEM layers. Global SRTM/GMTED2010 courtesy of the U.S. Geological Survey.",
    coverage: "Global",
    resolutionM: 25,
    note: "EU-DEM is 25 m, so terrain shadows are smoothed. Free, no key, z0-z15.",
  },
  osmBuildings: {
    id: "osm-buildings",
    label: "OpenStreetMap building footprints",
    url: "https://www.openstreetmap.org/",
    license: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "© OpenStreetMap contributors",
    coverage: "Global",
    resolutionM: 0,
    note: "Heights are sparse: 3.6 % of building ways carry `height`, 6.1 % `building:levels` (taginfo, 2026-11-20).",
  },
};

/** Attribution line for the panel, filtered to the sources actually in use. */
export function shadowAttribution(sourceIds: readonly string[]): string {
  return sourceIds
    .map((id) => SHADOW_SOURCES[id])
    .filter((source): source is ShadowSource => Boolean(source))
    .map((source) => source.attribution ?? source.label)
    .join(" · ");
}
