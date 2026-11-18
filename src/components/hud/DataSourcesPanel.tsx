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
    detail: "Basemap data, POIs, hiking and cycling infrastructure.",
    href: "https://www.openstreetmap.org/copyright",
  },
  {
    name: "Esri / Maxar",
    detail: "Satellite and hybrid reference imagery.",
    href: "https://www.esri.com/",
  },
  {
    name: "Sentinel-2 · Copernicus",
    detail: "Cloudless annual mosaics and daily true-colour scenes.",
    href: "https://dataspace.copernicus.eu/",
  },
  {
    name: "NASA GIBS",
    detail: "Near-real-time imagery and atmospheric layers.",
    href: "https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api",
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
    name: "Wikipedia · Wikidata",
    detail: "Historic landmark descriptions and dates.",
    href: "https://www.wikidata.org/",
  },
  {
    name: "OpenHistoricalMap",
    detail: "Historical basemap and time-filtered map data.",
    href: "https://www.openhistoricalmap.org/",
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
