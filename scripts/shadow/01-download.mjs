/**
 * Step 1 — download only the LoD1 CityGML tiles that intersect the pilot bbox.
 *
 * OpenGeodata NRW ships one 1 km × 1 km tile per CityGML file; the file list is
 * an XML index, the tile name carries the UTM32 km indices. Building the names
 * from a formula would be plausible but wrong at the edges, so the index is
 * read and filtered.
 *
 * Usage: node scripts/shadow/01-download.mjs [--force]
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { LOD1_FILE_BASE, LOD1_INDEX_URL, PILOT_BBOX, WORK_DIR } from "./constants.mjs";
import { tileRangeForBbox } from "./utm.mjs";

const RAW_DIR = path.join(WORK_DIR, "raw");
const INDEX_CACHE = path.join(WORK_DIR, "lod1-index.xml");
const CONCURRENCY = 6;

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

async function listTiles() {
  let xml;
  try {
    xml = await readFile(INDEX_CACHE, "utf8");
  } catch {
    xml = await fetchText(LOD1_INDEX_URL);
    await writeFile(INDEX_CACHE, xml);
  }
  const range = tileRangeForBbox(PILOT_BBOX);
  const tiles = [];
  for (const match of xml.matchAll(
    /<file name="(LoD1_32_(\d{3})_(\d{4})_1_NW\.gml)" size="(\d+)"/g,
  )) {
    const east = Number(match[2]);
    const north = Number(match[3]);
    if (east < range.eastMin || east > range.eastMax) continue;
    if (north < range.northMin || north > range.northMax) continue;
    tiles.push({ name: match[1], size: Number(match[4]) });
  }
  tiles.sort((a, b) => a.name.localeCompare(b.name));
  return { tiles, range };
}

async function exists(file) {
  try {
    const info = await stat(file);
    return info.size > 0;
  } catch {
    return false;
  }
}

async function download(name, force) {
  const target = path.join(RAW_DIR, name);
  if (!force && (await exists(target))) return "cached";
  const res = await fetch(LOD1_FILE_BASE + name);
  if (!res.ok) throw new Error(`${name} → HTTP ${res.status}`);
  const tmp = `${target}.part`;
  if (!res.body) throw new Error(`${name}: empty body`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, target);
  return "downloaded";
}

const force = process.argv.includes("--force");
await mkdir(RAW_DIR, { recursive: true });
const { tiles, range } = await listTiles();
const totalMb = tiles.reduce((sum, tile) => sum + tile.size, 0) / 1e6;
console.log(
  `pilot bbox ${PILOT_BBOX.join(", ")} → UTM32 tiles E ${range.eastMin}..${range.eastMax}, N ${range.northMin}..${range.northMax}`,
);
console.log(`${tiles.length} LoD1 tiles, ${totalMb.toFixed(1)} MB to download`);

let done = 0;
let bytes = 0;
const queue = [...tiles];
async function worker() {
  for (;;) {
    const tile = queue.shift();
    if (!tile) return;
    try {
      await download(tile.name, force);
      bytes += tile.size;
      done += 1;
      if (done % 25 === 0 || done === tiles.length) {
        console.log(`  ${done}/${tiles.length} tiles, ${(bytes / 1e6).toFixed(0)} MB`);
      }
    } catch (error) {
      console.error(`  FAILED ${tile.name}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`raw tiles in ${RAW_DIR}`);
