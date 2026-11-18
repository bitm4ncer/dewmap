import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportPages } from "./export-wikidata.mjs";
import { normalizeExportDir } from "./normalize.mjs";
import { buildArchives } from "./build.mjs";

const SCOPE_QUERY = new URL("./scope.rq", import.meta.url);

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
  const exportDir = resolve(args.export ?? "tmp/history/export");
  const sitesFile = resolve(args.sites ?? "tmp/history/sites.geojsonl");
  const outDir = resolve(args.out ?? "public/data/history");
  const limit = args.limit ? Number(args.limit) : Number.POSITIVE_INFINITY;
  const pageSize = args["page-size"] ? Number(args["page-size"]) : 10_000;

  const queryTemplate = await readFile(SCOPE_QUERY, "utf8");
  const exported = await exportPages({
    outDir: exportDir,
    queryTemplate,
    limit,
    pageSize,
  });
  const normalized = await normalizeExportDir({
    inDir: exportDir,
    outFile: sitesFile,
  });
  const built = await buildArchives({
    inputGeoJsonl: sitesFile,
    outDir,
    skipTiles: Boolean(args["skip-tiles"]),
    maxSites: args["max-sites"] ? Number(args["max-sites"]) : 250_000,
  });

  console.log(
    `history: ${exported.rows} rows → ${normalized.sites} sites → ${built.manifest.counts.clusters} clusters, ${(built.totalBytes / 1024 / 1024).toFixed(2)} MB`,
  );
  if (built.overTarget) {
    console.warn("history: archive is over the 25 MB target");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
