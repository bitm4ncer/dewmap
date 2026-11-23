/**
 * Step 3 — GeoJSON lines → MBTiles (tippecanoe) → PMTiles.
 *
 * Layer `buildings`, zooms 12–16, one integer `height` (metres) and the LoD1
 * `id`. No labels, no extra attributes: the client rasterises footprints and
 * needs nothing else, and every unused attribute costs bytes in every tile.
 *
 * `--drop-densest-as-needed` keeps the biggest tiles under the size limit;
 * the zoom-16 tiles (the ones the shadow loader actually reads) keep every
 * building.
 *
 * Requires `tippecanoe` and `pmtiles` (go-pmtiles) on PATH. Both are build
 * tools, not runtime dependencies — see README.md.
 *
 * Usage: node scripts/shadow/03-tile.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  ARTIFACT,
  LAYER_NAME,
  MAX_ZOOM,
  MIN_ZOOM,
  WORK_DIR,
} from "./constants.mjs";

const OUT_DIR = path.join(WORK_DIR, "out");
const SOURCE = path.join(OUT_DIR, "buildings.geojsonl");
const MBTILES = path.join(OUT_DIR, `${ARTIFACT}.mbtiles`);
const PMTILES = path.join(OUT_DIR, `${ARTIFACT}.pmtiles`);

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

export const tippecanoeArgs = [
  "-o",
  MBTILES,
  "--force",
  "-l",
  LAYER_NAME,
  "-Z",
  String(MIN_ZOOM),
  "-z",
  String(MAX_ZOOM),
  "-y",
  "id",
  "-y",
  "height",
  "--drop-densest-as-needed",
  "--simplification=2",
  "--no-tile-stats",
  "--quiet",
  SOURCE,
];

await mkdir(OUT_DIR, { recursive: true });
const input = await stat(SOURCE);

console.log(`tippecanoe: ${(input.size / 1e6).toFixed(1)} MB GeoJSONL → z${MIN_ZOOM}–${MAX_ZOOM}`);
const started = Date.now();
run("tippecanoe", tippecanoeArgs);
console.log(`tippecanoe done in ${((Date.now() - started) / 1000).toFixed(1)} s`);

const mbtiles = await stat(MBTILES);
console.log(`MBTiles: ${(mbtiles.size / 1e6).toFixed(2)} MB → converting to PMTiles`);
run("pmtiles", ["convert", MBTILES, PMTILES]);
const pmtiles = await stat(PMTILES);
console.log(`PMTiles: ${(pmtiles.size / 1e6).toFixed(2)} MB at ${PMTILES}`);
