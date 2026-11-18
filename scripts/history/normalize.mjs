import { createRequire } from "node:module";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCsv } from "./export-wikidata.mjs";

const require = createRequire(import.meta.url);
const categoryMap = require("../../src/lib/history/category-map.json");

const EXCLUDED_QIDS = new Set([
  "Q5", // human
  "Q1656682", // event
  "Q43229", // organization
  "Q56061", // administrative territorial entity
  "Q515", // city
  "Q486972", // human settlement
  "Q838948", // work of art
  "Q732577", // publication
  "Q4167410", // Wikimedia category
  "Q13406463", // Wikimedia list
  "Q14897293", // fictional entity
  "Q79007", // street
  "Q179049", // protected area
]);

export function parseWktPoint(value) {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^\s*point\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)\s*$/i,
  );
  if (!match) return null;
  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return { lon, lat };
}

export function parseYear(value) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const match = value.match(/^([+-]?\d{4,})-\d{2}-\d{2}/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : undefined;
}

function parseBoolean(value) {
  return value === "true" || value === "1";
}

function qidFromItem(item) {
  if (typeof item !== "string") return null;
  const match = item.match(/\/(Q\d+)$/);
  return match ? match[1] : null;
}

export function normalizeRow(row) {
  const qid = qidFromItem(row?.item);
  if (!qid) return null;
  if (EXCLUDED_QIDS.has(qid)) return null;

  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;

  const point = parseWktPoint(row.coord);
  if (!point) return null;

  const types = (row.types ?? "")
    .split("|")
    .map((type) => type.trim())
    .filter(Boolean);
  if (types.some((type) => EXCLUDED_QIDS.has(type))) return null;

  const category = categoryForTypes(types);
  const site = {
    id: `wd/${qid}`,
    qid,
    name,
    category,
    heritage: parseBoolean(row.heritage),
    unesco: parseBoolean(row.unesco),
    lon: point.lon,
    lat: point.lat,
  };

  const inception = parseYear(row.inception);
  if (inception !== undefined) site.inception = inception;
  const dissolved = parseYear(row.dissolved);
  if (dissolved !== undefined) site.dissolved = dissolved;

  return site;
}

function categoryForTypes(types) {
  const present = new Set(types);
  for (const category of categoryMap.priority) {
    if (category === "other") continue;
    for (const [qid, mapped] of Object.entries(categoryMap.wikidata)) {
      if (mapped === category && present.has(qid)) return category;
    }
  }
  return "other";
}

function score(site) {
  let value = 0;
  for (const key of ["name", "inception", "dissolved", "qid"]) {
    if (site[key] !== undefined && site[key] !== "") value += 1;
  }
  if (site.heritage) value += 1;
  if (site.unesco) value += 1;
  return value;
}

export function dedupeSites(sites) {
  const byId = new Map();
  for (const site of sites) {
    if (!site) continue;
    const existing = byId.get(site.id);
    if (!existing) {
      byId.set(site.id, { ...site });
      continue;
    }
    const winner = score(site) > score(existing) ? site : existing;
    const loser = winner === site ? existing : site;
    const merged = { ...loser, ...winner };
    for (const key of ["inception", "dissolved", "qid"]) {
      if (merged[key] === undefined && loser[key] !== undefined) {
        merged[key] = loser[key];
      }
    }
    byId.set(site.id, merged);
  }
  return [...byId.values()];
}

export function toGeoJsonLine(site) {
  const properties = {
    id: site.id,
    qid: site.qid,
    name: site.name,
    category: site.category,
    heritage: site.heritage,
    unesco: site.unesco,
  };
  if (site.inception !== undefined) properties.inception = site.inception;
  if (site.dissolved !== undefined) properties.dissolved = site.dissolved;
  return JSON.stringify({
    type: "Feature",
    geometry: { type: "Point", coordinates: [site.lon, site.lat] },
    properties,
  });
}

export function normalizeCsvText(text) {
  return dedupeSites(
    parseCsv(text)
      .map((row) => normalizeRow(row))
      .filter(Boolean),
  );
}

export async function normalizeExportDir({ inDir, outFile }) {
  const names = (await readdir(inDir))
    .filter((name) => /^page-\d{4}\.csv$/.test(name))
    .sort();
  if (names.length === 0) {
    throw new Error(`no page-*.csv files in ${inDir}`);
  }
  const sites = [];
  for (const name of names) {
    sites.push(...normalizeCsvText(await readFile(resolve(inDir, name), "utf8")));
  }
  const deduped = dedupeSites(sites);
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(
    outFile,
    `${deduped.map((site) => toGeoJsonLine(site)).join("\n")}\n`,
  );
  return { sites: deduped.length, pages: names.length };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = value;
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await normalizeExportDir({
    inDir: resolve(args.in ?? "tmp/history/export"),
    outFile: resolve(args.out ?? "tmp/history/sites.geojsonl"),
  });
  console.log(
    `history normalize: ${result.sites} sites from ${result.pages} pages`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
