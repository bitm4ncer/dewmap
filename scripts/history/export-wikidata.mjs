import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ENDPOINT = "https://qlever.dev/api/wikidata";
const DEFAULT_QUERY = new URL("./scope.rq", import.meta.url);

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift()?.map((value) => value.replace(/^\uFEFF/, ""));
  if (!header || header.length === 0) return [];
  return rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values) =>
      Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])),
    );
}

export function buildQuery(template, limit, cursor) {
  const cursorFilter = cursor
    ? `FILTER(?item > <http://www.wikidata.org/entity/${cursor}>)`
    : "";
  return template
    .replace("%%CURSOR_FILTER%%", cursorFilter)
    .replace("%%LIMIT%%", String(limit));
}

function qidFromItem(item) {
  if (typeof item !== "string") return undefined;
  const match = item.match(/\/(Q\d+)$/);
  return match?.[1];
}

async function fetchPage({
  endpoint,
  fallbackEndpoint,
  query,
  fetchImpl,
  sleepImpl,
  attempts = 3,
}) {
  let lastError;
  for (const target of [endpoint, fallbackEndpoint].filter(Boolean)) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetchImpl(target, {
          method: "POST",
          headers: {
            Accept: "text/csv",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "kugelmaps-history-build/1.0",
          },
          body: `query=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(90_000),
        });
        if (response.ok) return response.text();
        lastError = new Error(`${target} returned ${response.status}`);
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) {
        lastError = error;
      }
      if (attempt < attempts - 1) await sleepImpl(500 * 2 ** attempt);
    }
  }
  throw lastError ?? new Error("SPARQL request failed");
}

export async function exportPages({
  outDir,
  queryTemplate,
  endpoint = DEFAULT_ENDPOINT,
  fallbackEndpoint = "https://query.wikidata.org/sparql",
  limit = Number.POSITIVE_INFINITY,
  pageSize = 10_000,
  cursor,
  pageStart = 1,
  fetchImpl = fetch,
  sleepImpl = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)),
}) {
  if (!queryTemplate) throw new Error("queryTemplate is required");
  await mkdir(outDir, { recursive: true });

  let total = 0;
  let pages = 0;
  let pageIndex = pageStart;
  let nextCursor = cursor;

  while (total < limit) {
    const pageLimit = Math.min(pageSize, limit - total);
    if (!Number.isFinite(pageLimit) || pageLimit <= 0) break;
    const query = buildQuery(queryTemplate, pageLimit, nextCursor);
    const text = await fetchPage({
      endpoint,
      fallbackEndpoint,
      query,
      fetchImpl,
      sleepImpl,
    });
    const rows = parseCsv(text);
    if (rows.length === 0) break;

    const lastQid = qidFromItem(rows.at(-1)?.item);
    if (!lastQid || lastQid === nextCursor) break;

    pages += 1;
    const pagePath = resolve(
      outDir,
      `page-${String(pageIndex).padStart(4, "0")}.csv`,
    );
    pageIndex += 1;
    await mkdir(dirname(pagePath), { recursive: true });
    await writeFile(pagePath, text.endsWith("\n") ? text : `${text}\n`);

    total += rows.length;
    nextCursor = lastQid;
    await writeFile(
      resolve(outDir, "cursor.json"),
      `${JSON.stringify({ cursor: nextCursor, pages, rows: total }, null, 2)}\n`,
    );
  }

  return { rows: total, pages, cursor: nextCursor };
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
  const outDir = resolve(args.out ?? "tmp/history/export");
  const queryPath = args.query ? resolve(args.query) : DEFAULT_QUERY;
  const queryTemplate = await readFile(queryPath, "utf8");
  const limit = args.limit ? Number(args.limit) : Number.POSITIVE_INFINITY;
  const pageSize = args["page-size"] ? Number(args["page-size"]) : 10_000;
  const pageStart = args["page-start"] ? Number(args["page-start"]) : 1;
  const result = await exportPages({
    outDir,
    queryTemplate,
    endpoint: args.endpoint ?? DEFAULT_ENDPOINT,
    fallbackEndpoint: args["fallback-endpoint"] ?? "https://query.wikidata.org/sparql",
    limit,
    pageSize,
    cursor: args.cursor,
    pageStart,
  });
  console.log(
    `history export: ${result.rows} rows in ${result.pages} pages (cursor ${result.cursor ?? "none"})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
