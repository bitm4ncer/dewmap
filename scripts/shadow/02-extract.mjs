/**
 * Step 2 — LoD1 CityGML → GeoJSON lines with footprint, height and id.
 *
 * What LoD1 gives us: a block model, i.e. a prism. Its solid has a ground
 * polygon and a roof polygon with identical XY rings, plus wall polygons. We
 * take the lowest-mean-z polygon as the footprint (identical to the roof in
 * XY, but unambiguous when a tile contains degenerate geometry) and the
 * attributed `bldg:measuredHeight` as the height. When that attribute is
 * missing we fall back to the z extent of the solid.
 *
 * Rules from the brief: heights rounded to metres, implausible values dropped
 * (<2 m, >300 m), ring simplified with Douglas-Peucker at 0.5 m, output in
 * WGS84, and only buildings whose centroid is inside the pilot bbox.
 *
 * Usage: node scripts/shadow/02-extract.mjs [--limit N]
 */
import { createReadStream } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createWriteStream } from "node:fs";
import { PILOT_BBOX, RULES, WORK_DIR } from "./constants.mjs";
import { utm32ToLonLat } from "./utm.mjs";

const RAW_DIR = path.join(WORK_DIR, "raw");
const OUT_DIR = path.join(WORK_DIR, "out");
const CONCURRENCY = 4;

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function insideBbox(lon, lat, [west, south, east, north]) {
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/** Perpendicular distance of p from the line a-b, in metres. */
function pointLineDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker on a closed ring given in metres. */
export function simplifyRing(ring, tolerance) {
  if (ring.length <= 3) return ring;
  const closed = [...ring];
  if (
    closed[0][0] !== closed[closed.length - 1][0] ||
    closed[0][1] !== closed[closed.length - 1][1]
  ) {
    closed.push(closed[0]);
  }
  const keep = new Uint8Array(closed.length);
  keep[0] = 1;
  keep[closed.length - 1] = 1;
  const stack = [[0, closed.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let best = -1;
    let bestDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const distance = pointLineDistance(closed[i], closed[first], closed[last]);
      if (distance > bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    if (best !== -1) {
      keep[best] = 1;
      stack.push([first, best], [best, last]);
    }
  }
  const out = [];
  for (let i = 0; i < closed.length - 1; i++) if (keep[i]) out.push(closed[i]);
  return out;
}

function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function parsePositionList(text) {
  const numbers = text.trim().split(/\s+/).map(Number);
  const points = [];
  for (let i = 0; i + 2 < numbers.length; i += 3) {
    const [x, y, z] = [numbers[i], numbers[i + 1], numbers[i + 2]];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([x, y, Number.isFinite(z) ? z : 0]);
  }
  return points;
}

/**
 * Parse one CityGML tile.
 *
 * The file is read as a stream and split on cityObjectMember so that a 35 MB
 * tile never becomes one 35 MB string with millions of regex captures.
 */
export async function* buildingsFromGml(file) {
  let buffer = "";
  const stream = createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of lines) {
    buffer += line;
    // A building's XML is a single long line in these files, so the split is
    // cheap: always keep the tail after the last opening tag.
    let start = buffer.indexOf("<core:cityObjectMember>");
    while (start !== -1) {
      const end = buffer.indexOf("</core:cityObjectMember>", start);
      if (end === -1) break;
      const chunk = buffer.slice(start, end);
      buffer = buffer.slice(end + "</core:cityObjectMember>".length);
      const building = parseBuilding(chunk);
      if (building) yield building;
      start = buffer.indexOf("<core:cityObjectMember>");
    }
    // Keep memory bounded even if a tile arrives without buildings.
    if (buffer.length > 4 << 20) buffer = buffer.slice(-(1 << 20));
  }
}

/** One `<core:cityObjectMember>` chunk → footprint record or null. */
export function parseBuilding(chunk) {
  const idMatch = /gml:id="([^"]+)"/.exec(chunk);
  if (!idMatch) return null;

  const heightMatch = /<bldg:measuredHeight[^>]*>([^<]+)<\/bldg:measuredHeight>/.exec(chunk);
  const measured = heightMatch ? Number.parseFloat(heightMatch[1]) : Number.NaN;

  let footprint = null;
  let lowestZ = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const polygon of chunk.matchAll(/<gml:Polygon>([\s\S]*?)<\/gml:Polygon>/g)) {
    const posList = /<gml:posList[^>]*>([^<]+)<\/gml:posList>/.exec(polygon[1]);
    if (!posList) continue;
    const points = parsePositionList(posList[1]);
    if (points.length < 3) continue;
    // Drop a repeated closing point; rings are stored open internally.
    if (
      points.length > 3 &&
      points[0][0] === points[points.length - 1][0] &&
      points[0][1] === points[points.length - 1][1]
    ) {
      points.pop();
    }
    if (points.length < 3) continue;
    let sum = 0;
    for (const point of points) {
      sum += point[2];
      if (point[2] < minZ) minZ = point[2];
      if (point[2] > maxZ) maxZ = point[2];
    }
    const meanZ = sum / points.length;
    if (footprint === null || meanZ < lowestZ) {
      lowestZ = meanZ;
      footprint = points;
    }
  }
  if (!footprint) return null;

  const ring = footprint.map(([x, y]) => [x, y]);
  const area = Math.abs(signedArea(ring));
  if (area < RULES.minAreaM2) return null;

  const height = Number.isFinite(measured) ? measured : maxZ - minZ;
  if (!Number.isFinite(height)) return null;
  const heightM = Math.round(height);
  if (heightM < RULES.minHeightM || heightM > RULES.maxHeightM) return null;

  const simplified =
    RULES.simplifyToleranceM > 0 ? simplifyRing(ring, RULES.simplifyToleranceM) : ring;
  if (simplified.length < 3) return null;

  return { id: idMatch[1], heightM, ring: simplified };
}

async function extractTile(file, write) {
  let count = 0;
  for await (const building of buildingsFromGml(file)) {
    const coordinates = [];
    let inside = 0;
    let sumLon = 0;
    let sumLat = 0;
    for (const [east, north] of building.ring) {
      const [lon, lat] = utm32ToLonLat(east, north);
      sumLon += lon;
      sumLat += lat;
      if (insideBbox(lon, lat, PILOT_BBOX)) inside += 1;
      coordinates.push([
        round(lon, RULES.coordDecimals),
        round(lat, RULES.coordDecimals),
      ]);
    }
    // Centroid test keeps buildings that straddle the pilot border; a
    // building completely outside would only add tiles we never serve.
    const centroidLon = sumLon / building.ring.length;
    const centroidLat = sumLat / building.ring.length;
    if (inside === 0 && !insideBbox(centroidLon, centroidLat, PILOT_BBOX)) continue;
    if (!insideBbox(centroidLon, centroidLat, PILOT_BBOX)) continue;
    coordinates.push(coordinates[0]);
    write(
      JSON.stringify({
        type: "Feature",
        properties: { id: building.id, height: building.heightM },
        geometry: { type: "Polygon", coordinates: [coordinates] },
      }) + "\n",
    );
    count += 1;
  }
  return count;
}

const limitArg = process.argv.indexOf("--limit");
const limit = limitArg === -1 ? Infinity : Number(process.argv[limitArg + 1]);

await mkdir(OUT_DIR, { recursive: true });
const files = (await readdir(RAW_DIR))
  .filter((name) => name.endsWith(".gml"))
  .sort()
  .slice(0, limit);
const outFile = path.join(OUT_DIR, "buildings.geojsonl");
const out = createWriteStream(outFile, { highWaterMark: 1 << 20 });
let writeChain = Promise.resolve();

function writeBlock(text) {
  writeChain = writeChain.then(
    () =>
      new Promise((ok) => {
        if (!out.write(text)) out.once("drain", ok);
        else ok();
      }),
  );
}

const pending = [];
function emit(line) {
  pending.push(line);
  if (pending.length >= 500) {
    const text = pending.join("");
    pending.length = 0;
    writeBlock(text);
  }
}

let total = 0;
let done = 0;
const queue = [...files];
async function worker() {
  for (;;) {
    const name = queue.shift();
    if (!name) return;
    const count = await extractTile(path.join(RAW_DIR, name), emit);
    total += count;
    done += 1;
    if (done % 25 === 0 || done === files.length) {
      console.log(`  ${done}/${files.length} tiles, ${total} buildings`);
    }
  }
}
const started = Date.now();
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (pending.length > 0) {
  const text = pending.join("");
  pending.length = 0;
  writeBlock(text);
}
await writeChain;
await new Promise((ok) => out.end(ok));
console.log(
  `${total} buildings → ${outFile} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
);
