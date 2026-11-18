import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { CLUSTER_BANDS, clusterSites } from "./cluster.mjs";
import {
  categoryCoverage,
  validateBuiltArchives,
  validateCategoryCoverage,
  validateManifest,
  validateSites,
} from "./validate.mjs";

const TARGET_BYTES = 25 * 1024 * 1024;
const HARD_BYTES = 40 * 1024 * 1024;

export function buildId(date = new Date()) {
  const iso = date.toISOString();
  return `history-${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
}

export function parseSitesGeoJsonl(text) {
  const sites = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const feature = JSON.parse(line);
    const [lon, lat] = feature.geometry?.coordinates ?? [];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    sites.push({ ...feature.properties, lon, lat });
  }
  return sites;
}

function siteScore(site) {
  return (
    (site.heritage ? 4 : 0) +
    (site.unesco ? 2 : 0) +
    (site.inception !== undefined ? 1 : 0)
  );
}

export function capSites(sites, maxSites, { categoryQuota = 0.01 } = {}) {
  if (sites.length <= maxSites) return sites;

  const quota = Math.max(1, Math.ceil(maxSites * categoryQuota));
  const groups = new Map();
  for (const site of sites) {
    const group = groups.get(site.category) ?? [];
    group.push(site);
    groups.set(site.category, group);
  }

  const chosen = [];
  const chosenIds = new Set();
  for (const group of groups.values()) {
    const take = group
      .sort(
        (a, b) =>
          siteScore(b) - siteScore(a) ||
          String(a.name).localeCompare(String(b.name)),
      )
      .slice(0, quota);
    for (const site of take) {
      if (chosenIds.has(site.id)) continue;
      chosenIds.add(site.id);
      chosen.push(site);
    }
  }

  const rest = sites
    .filter((site) => !chosenIds.has(site.id))
    .sort(
      (a, b) =>
        siteScore(b) - siteScore(a) ||
        String(a.name).localeCompare(String(b.name)),
    );
  const remaining = Math.max(0, maxSites - chosen.length);
  return [...chosen.slice(0, maxSites), ...rest.slice(0, remaining)];
}

export function clusterFeatures(sites, band) {
  return clusterSites(sites, { resolution: band.resolution }).map((cluster) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: cluster.coordinates },
    properties: {
      id: cluster.id,
      count: cluster.count,
      heritageCount: cluster.heritageCount,
      unescoCount: cluster.unescoCount,
    },
  }));
}

function runTippecanoe(bin, args) {
  const result = spawnSync(bin, args, { stdio: "inherit" });
  if (result.error) {
    throw new Error(
      `cannot run ${bin}: ${result.error.message} (install tippecanoe or set TIPPECANOE_BIN)`,
    );
  }
  if (result.status !== 0) {
    throw new Error(`${bin} exited with ${result.status}`);
  }
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

export async function buildArchives({
  inputGeoJsonl,
  outDir,
  bin = process.env.TIPPECANOE_BIN ?? "tippecanoe",
  skipTiles = false,
  maxSites = 250_000,
  now = new Date(),
}) {
  const id = buildId(now);
  const versionDir = resolve(outDir, id);
  const workDir = resolve(outDir, ".work");
  await mkdir(versionDir, { recursive: true });
  await mkdir(workDir, { recursive: true });

  const parsed = parseSitesGeoJsonl(await readFile(inputGeoJsonl, "utf8"));
  const siteValidation = validateSites(parsed);
  if (!siteValidation.ok) {
    throw new Error(`invalid sites:\n${siteValidation.errors.slice(0, 20).join("\n")}`);
  }
  const sites = capSites(parsed, maxSites);
  const categoryValidation = validateCategoryCoverage(sites);
  if (!categoryValidation.ok) {
    throw new Error(`category coverage:\n${categoryValidation.errors.join("\n")}`);
  }
  const clusterBands = CLUSTER_BANDS.map((band) => ({
    band,
    features: clusterFeatures(sites, band),
  }));
  const clusterCount = clusterBands.reduce(
    (total, entry) => total + entry.features.length,
    0,
  );

  const sitesPath = resolve(workDir, "history-sites.geojsonl");
  await writeFile(
    sitesPath,
    sites
      .map((site) =>
        JSON.stringify({
          type: "Feature",
          geometry: { type: "Point", coordinates: [site.lon, site.lat] },
          properties: {
            id: site.id,
            qid: site.qid,
            name: site.name,
            category: site.category,
            heritage: site.heritage,
            unesco: site.unesco,
            ...(site.inception !== undefined
              ? { inception: site.inception }
              : {}),
            ...(site.dissolved !== undefined
              ? { dissolved: site.dissolved }
              : {}),
          },
        }),
      )
      .join("\n") + "\n",
  );

  const clusterFiles = [];
  for (const { band, features } of clusterBands) {
    const name = `history-clusters-${band.minzoom}-${band.maxzoom}`;
    const sourcePath = resolve(workDir, `${name}.geojsonl`);
    const targetPath = resolve(outDir, id, `${name}.pmtiles`);
    await writeFile(
      sourcePath,
      features.map((feature) => JSON.stringify(feature)).join("\n") + "\n",
    );
    if (!skipTiles) {
      runTippecanoe(bin, [
        "-o",
        targetPath,
        "-l",
        "history_clusters",
        `-Z${band.minzoom}`,
        `-z${band.maxzoom}`,
        "-r1",
        "--drop-densest-as-needed",
        "--quiet",
        "--no-progress-indicator",
        "--force",
        sourcePath,
      ]);
    }
    clusterFiles.push({
      path: `${id}/${name}.pmtiles`,
      bytes: skipTiles ? 0 : (await stat(targetPath)).size,
      sha256: skipTiles ? "" : await sha256(targetPath),
      minzoom: band.minzoom,
      maxzoom: band.maxzoom,
    });
  }

  const siteFile = `${id}/history-sites.pmtiles`;
  const sitePath = resolve(outDir, siteFile);
  if (!skipTiles) {
    runTippecanoe(bin, [
      "-o",
      sitePath,
      "-l",
      "history_sites",
      "-Z8",
      "-z9",
      "-r1",
      "--quiet",
      "--no-progress-indicator",
      "--force",
      sitesPath,
    ]);
  }

  const files = {
    clusters: clusterFiles,
    sites: {
      path: siteFile,
      bytes: skipTiles ? 0 : (await stat(sitePath)).size,
      sha256: skipTiles ? "" : await sha256(sitePath),
    },
  };

  const total =
    files.clusters.reduce((sum, file) => sum + file.bytes, 0) +
    files.sites.bytes;
  if (!skipTiles && total > HARD_BYTES) {
    throw new Error(
      `history archive is ${(total / 1024 / 1024).toFixed(1)} MB, over the 40 MB hard limit`,
    );
  }

  const manifest = {
    schema: 1,
    buildId: id,
    builtAt: now.toISOString(),
    counts: { sites: sites.length, clusters: clusterCount },
    categories: Object.fromEntries(categoryCoverage(sites)),
    files,
    attribution: [
      "Wikidata contributors (CC0)",
      "OpenStreetMap contributors (ODbL) for live detail",
      "PMTiles, MapLibre, Tippecanoe",
    ],
  };
  const manifestValidation = validateManifest(manifest, {
    maxBytes: HARD_BYTES,
    allowEmpty: skipTiles,
  });
  if (!manifestValidation.ok) {
    throw new Error(`invalid manifest:\n${manifestValidation.errors.join("\n")}`);
  }
  await writeFile(
    resolve(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  if (!skipTiles) {
    const archiveValidation = await validateBuiltArchives({
      manifest,
      outDir,
      bin: process.env.TIPPECANOE_DECODE ?? "tippecanoe-decode",
      sampleSite: sites[0],
    });
    if (!archiveValidation.ok) {
      throw new Error(
        `invalid archive:\n${archiveValidation.errors.join("\n")}`,
      );
    }
  }
  await rm(workDir, { recursive: true, force: true });

  return {
    manifest,
    totalBytes: total,
    overTarget: total > TARGET_BYTES,
  };
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
  const result = await buildArchives({
    inputGeoJsonl: resolve(args.input ?? "tmp/history/sites.geojsonl"),
    outDir: resolve(args.out ?? "public/data/history"),
    skipTiles: Boolean(args["skip-tiles"]),
    maxSites: args["max-sites"] ? Number(args["max-sites"]) : 250_000,
  });
  console.log(
    `history build: ${result.manifest.counts.sites} sites, ${result.manifest.counts.clusters} clusters, ${(result.totalBytes / 1024 / 1024).toFixed(2)} MB`,
  );
  if (result.overTarget) {
    console.warn("history build: archive is over the 25 MB target");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
