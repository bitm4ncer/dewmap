import { HudPanel } from "./HudPanel";
import { ChevronDownIcon } from "@/components/ui/icons";

interface Source {
  name: string;
  detail: string;
  href: string;
}

const SOURCES: Source[] = [
  {
    name: "OpenStreetMap",
    detail: "Basemap data, POIs, hiking and cycling infrastructure (ODbL).",
    href: "https://www.openstreetmap.org/copyright",
  },
  {
    name: "Deutscher Wetterdienst (DWD)",
    detail:
      "Rain radar (RV composite, 5-minute analysis and 90-minute nowcast) and official weather warnings by district and municipality. Served through our own data gateway, not directly from dwd.de. Licence: DL-DE-BY 2.0 — attribution: Deutscher Wetterdienst.",
    href: "https://www.dwd.de/opendata",
  },
  {
    name: "Geobasis NRW",
    detail:
      "Building shadow pilot: LoD1 city model and DGM1 elevation model of North Rhine-Westphalia, rendered locally in a web worker. Licence: dl-de/zero 2.0 — attribution: Geobasis NRW.",
    href: "https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod1/",
  },
  {
    name: "Esri / Maxar",
    detail: "Satellite and hybrid reference imagery.",
    href: "https://www.esri.com/",
  },
  {
    name: "Sentinel-2 · Copernicus",
    detail:
      "Cloudless annual mosaics and daily true-colour scenes; Sentinel-5P NO₂ via NASA GIBS. Free and open (Copernicus Data Space), attribution required.",
    href: "https://dataspace.copernicus.eu/",
  },
  {
    name: "NASA GIBS",
    detail:
      "Near-real-time imagery, NDVI and NO₂ layers, plus the GPM IMERG precipitation frames (NASA EOSDIS, open data).",
    href: "https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api",
  },
  {
    name: "ESA WorldCover",
    detail:
      "Global 10 m land cover (2021) for the Nature panel, licensed CC BY 4.0 — attribution: ESA WorldCover project.",
    href: "https://esa-worldcover.org/",
  },
  {
    name: "GBIF",
    detail:
      "Global biodiversity observations aggregated into density tiles for the species overlay (CC BY 4.0 for most records, per-dataset licences apply).",
    href: "https://www.gbif.org/",
  },
  {
    name: "Global Forest Watch · UMD",
    detail:
      "Forest-loss alerts (GLAD) and the Hansen tree-cover-loss product for the forest overlay (CC BY 4.0).",
    href: "https://www.globalforestwatch.org/",
  },
  {
    name: "EEA Natura 2000",
    detail:
      "European protected areas (Habitats and Birds directives) as an EEA web map service.",
    href: "https://www.eea.europa.eu/en/datahub/datahubitem-view/32ff2f92-0f4a-4d1a-9b3d-2f2f4dab6e42",
  },
  {
    name: "OpenRailwayMap",
    detail: "Rail infrastructure overlay.",
    href: "https://www.openrailwaymap.org/",
  },
  {
    name: "Transitous / MOTIS",
    detail:
      "Train, tram, bus and ferry routing with real-time delays where operators publish them.",
    href: "https://transitous.org/",
  },
  {
    name: "DELFI / GTFS.de",
    detail: "German nationwide scheduled and real-time transit feeds.",
    href: "https://www.gtfs.de/",
  },
  {
    name: "Valhalla",
    detail: "Car routing, turn-by-turn maneuvers and road attributes.",
    href: "https://valhalla.github.io/valhalla/",
  },
  {
    name: "BRouter",
    detail: "Hiking, cycling and car-eco routing with elevation.",
    href: "https://brouter.de/",
  },
  {
    name: "Photon",
    detail: "Address and place search.",
    href: "https://photon.komoot.io/",
  },
  {
    name: "Nominatim",
    detail:
      "Place details, opening hours, contact tags and addresses from OpenStreetMap.",
    href: "https://nominatim.org/",
  },
  {
    name: "Wikipedia · Wikidata",
    detail:
      "Descriptions, dates, official websites and social profiles. The worldwide heritage layer is a curated Wikidata extract refreshed monthly. Photos from Wikimedia Commons.",
    href: "https://www.wikidata.org/",
  },
  {
    name: "Wikimedia Commons",
    detail: "Place photos with a link to the original file and its licence.",
    href: "https://commons.wikimedia.org/",
  },
  {
    name: "PMTiles · Tippecanoe",
    detail:
      "Static tile archive format and the build tool that packages the worldwide heritage layer.",
    href: "https://docs.protomaps.com/pmtiles/",
  },
  {
    name: "OpenHistoricalMap",
    detail: "Historical basemap and time-filtered map data.",
    href: "https://www.openhistoricalmap.org/",
  },
  {
    name: "OpenFreeMap · VersaTiles",
    detail:
      "Keyless OpenStreetMap vector basemaps, styles and the zoom-level place data used for POI icons.",
    href: "https://openfreemap.org/",
  },
  {
    name: "basemap.de · BKG",
    detail:
      "Official German web map, topographic map and vector tiles (DL-DE-BY 2.0).",
    href: "https://basemap.de/",
  },
  {
    name: "basemap.at",
    detail:
      "Official Austrian base map and orthophoto, including Vienna's historical aerial series (CC BY 4.0).",
    href: "https://basemap.at/",
  },
  {
    name: "swisstopo",
    detail:
      "Swiss national maps, SWISSIMAGE orthophotos and the Siegfried, Dufour and Zeitreihen historical series.",
    href: "https://www.swisstopo.admin.ch/",
  },
  {
    name: "IGN Géoplateforme",
    detail:
      "French national maps, orthophotos, État-Major, Scan50, Cassini and post-war aerial series (Licence Ouverte 2.0).",
    href: "https://geoservices.ign.fr/",
  },
  {
    name: "PDOK · Kadaster",
    detail: "Dutch BRT background map and aerial orthophotos.",
    href: "https://www.pdok.nl/",
  },
  {
    name: "Kartverket · Geonorge",
    detail: "Norwegian topographic, sea and historical maps (CC BY 4.0).",
    href: "https://www.geonorge.no/",
  },
  {
    name: "ČÚZK · GUGiK · IGN España",
    detail:
      "Czech, Polish and Spanish national orthophotos and topographic maps.",
    href: "https://www.cuzk.cz/",
  },
  {
    name: "Stadt Wien · GIS-ZH",
    detail:
      "Vienna's 1938/1956/1976/1992 aerial plans and Zurich's Wildkarte (~1850).",
    href: "https://www.wien.gv.at/stadtplanung/karten",
  },
  {
    name: "National Library of Scotland",
    detail:
      "Georeferenced OS 6-inch maps of the UK, first and second editions (CC BY-NC 4.0).",
    href: "https://maps.nls.uk/",
  },
  {
    name: "USGS · GSI Japan",
    detail:
      "US National Map imagery/topo and Japan's GSI current and 1961–69 aerial imagery.",
    href: "https://basemap.nationalmap.gov/",
  },
  {
    name: "EMODnet",
    detail: "European sea-floor bathymetry basemap.",
    href: "https://emodnet.ec.europa.eu/en/bathymetry",
  },
];

export function DataSourcesPanel() {
  return (
    <HudPanel>
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-[color:var(--ink)]">
          Data sources &amp; attribution
          <ChevronDownIcon
            size={16}
            className="text-[color:var(--ink-mute)] transition-transform group-open:rotate-180"
          />
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {SOURCES.map((s) => (
            <li
              key={s.name}
              className="flex flex-col gap-1 rounded-lg px-3 py-3 hover:bg-[color:var(--surf-2)]"
            >
              <a
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="text-[12.5px] font-semibold text-[color:var(--ink)] underline-offset-2 hover:text-[color:var(--accent)] hover:underline"
              >
                {s.name}
              </a>
              <span className="text-[11.5px] leading-relaxed text-[color:var(--ink-dim)]">
                {s.detail}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10.5px] leading-relaxed text-[color:var(--ink-mute)]">
          Public demo endpoints are best-effort and may rate-limit. Routing
          results are informational, not a substitute for official signage.
        </p>
      </details>
    </HudPanel>
  );
}
