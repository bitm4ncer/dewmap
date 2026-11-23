# Shadow pilot pipeline — Düsseldorf

Builds the building layer behind the **Shadows** card in the Nature pane:
one PMTiles archive with LoD1 footprints and heights for the Düsseldorf pilot
bbox, served statically from the data VPS.

Nothing here runs at request time. The archive is built offline, uploaded once,
and the browser does the shadow maths in a worker.

## Scope

| | |
|---|---|
| Pilot bbox | `6.68 – 6.92 E, 51.14 – 51.34 N` (≈ 17 × 22 km) |
| Source | OpenGeodata NRW, **3D-Gebäudemodell LoD1** (CityGML, 1 km tiles) |
| Licence | Datenlizenz Deutschland – Zero – Version 2.0 (`dl-de/zero-2.0`) |
| Output | `buildings-duesseldorf-v1.pmtiles`, layer `buildings`, z12–16 |
| Size | 31.9 MB (limit: 200 MB) |
| Buildings | 339 905 |

Only the tiles intersecting the bbox are downloaded: 456 of the 35 022 NRW
tiles, 3.2 GB instead of 91.8 GB.

## Prerequisites

Two build tools, both deliberately **not** runtime dependencies:

- `tippecanoe` ≥ 2.80 — https://github.com/felt/tippecanoe (`make -j8`, needs
  `libsqlite3` and `zlib` headers)
- `pmtiles` (go-pmtiles) ≥ 1.20 — single binary from
  https://github.com/protomaps/go-pmtiles/releases

Both must be on `PATH` for step 3. Steps 1, 2 and 4 only need Node ≥ 22
(`fetch`, `node:readline`).

## Run

```sh
node scripts/shadow/01-download.mjs     # 456 CityGML tiles → $SHADOW_WORK_DIR/raw
node scripts/shadow/02-extract.mjs      # CityGML → footprints + heights (GeoJSONL)
node scripts/shadow/03-tile.mjs         # tippecanoe → MBTiles → PMTiles
node scripts/shadow/04-upload.mjs       # scp + HTTP/range verification
```

`SHADOW_WORK_DIR` defaults to `/tmp/opencode/shadow-pilot`. Raw tiles, MBTiles
and GeoJSON are **not** committed; only the scripts are.

Measured end to end on 2026-11-23 (one workstation, 16 threads):

| Step | Time | Result |
|---|---|---|
| download | 4 min | 456 tiles, 3.2 GB |
| extract | 3 min | 339 905 buildings, 84.9 MB GeoJSONL |
| tile | 5 s + 0.1 s | 33.9 MB MBTiles → 31.9 MB PMTiles |
| upload | 25 s | 200 / 206 / CORS verified |

## Extraction rules

Implemented in `02-extract.mjs` and quoted in
`docs/superpowers/specs/2026-11-23-shadow-pilot-design.md`:

- **Footprint**: the polygon with the lowest mean z of the `lod1Solid` (in a
  block model the roof ring has the same XY as the ground ring, so this is
  unambiguous even for degenerate geometry).
- **Height**: `bldg:measuredHeight` when present, else the z extent of the
  solid. Rounded to whole metres.
- **Plausibility**: heights < 2 m (sheds, walls) and > 300 m (data errors) are
  dropped; footprints smaller than 1 m² are dropped.
- **Geometry**: Douglas-Peucker at 0.5 m on the UTM ring, then WGS84 with 7
  decimals (≈ 1 cm).
- **Coverage**: a building is kept when its centroid falls inside the pilot
  bbox. Buildings straddling the border stay; the rest of the tile does not.

`utm.mjs` contains the ETRS89/UTM32 forward and inverse projection (Snyder,
USGS PP 1395) rather than a `proj4` dependency.

## Tiling

```
tippecanoe -o buildings.mbtiles --force -l buildings -Z12 -z16 \
  -y id -y height --drop-densest-as-needed --simplification=2 \
  --no-tile-stats buildings.geojsonl
pmtiles convert buildings.mbtiles buildings-duesseldorf-v1.pmtiles
```

`--drop-densest-as-needed` keeps the low zooms under the tile size limit; the
z16 tiles the client actually reads keep every building (22 kB max, 9.1 MB
total). No labels, no other attributes: `height` and `id` are all the worker
needs.

| zoom | tiles | bytes | max tile |
|---|---:|---:|---:|
| 12 | 16 | 1.76 MB | 391 kB |
| 13 | 55 | 6.07 MB | 401 kB |
| 14 | 177 | 6.95 MB | 141 kB |
| 15 | 651 | 7.94 MB | 52 kB |
| 16 | 2 187 | 9.14 MB | 22 kB |

## Hosting

`04-upload.mjs` writes exactly one file to
`/srv/dewmap-tiles/shadow/buildings-duesseldorf-v1.pmtiles` and then checks the
public endpoint:

```
200, accept-ranges: bytes, access-control-allow-origin: *
206 on Range: bytes=0-126, Content-Length 127, magic "PMTiles"
```

Caddy already serves `/tiles/*` from that tree; no gateway change was made.

## Refreshing the data

OpenGeodata NRW updates LoD1 roughly yearly. Bump `ARTIFACT` in
`constants.mjs` (`buildings-duesseldorf-v2`), rerun all four steps, and update
`PILOT_TILES_FILE` in `src/lib/shadow/pilot.ts`. The old archive can stay in
place; the filename is the version.
