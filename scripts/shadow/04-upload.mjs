/**
 * Step 4 — upload the PMTiles archive and verify what the CDN actually does.
 *
 * Only `/srv/dewmap-tiles/shadow/` is touched; Caddy already serves
 * `/tiles/*` from that tree with `Accept-Ranges` and CORS, so a new
 * subdirectory needs no gateway change.
 *
 * Usage: node scripts/shadow/04-upload.mjs [--host bitmancer-server]
 */
import { spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { ARTIFACT, WORK_DIR } from "./constants.mjs";

const FILE = `${ARTIFACT}.pmtiles`;
const LOCAL = path.join(WORK_DIR, "out", FILE);
const REMOTE_DIR = "/srv/dewmap-tiles/shadow";
const HOST =
  process.argv.includes("--host")
    ? process.argv[process.argv.indexOf("--host") + 1]
    : "bitmancer-server";
const URL = `https://data.dewmap.app/tiles/shadow/${FILE}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

const info = await stat(LOCAL);
console.log(`${FILE}: ${(info.size / 1e6).toFixed(2)} MB → ${HOST}:${REMOTE_DIR}/`);

run("ssh", [HOST, `mkdir -p ${REMOTE_DIR}`]);
run("scp", [LOCAL, `${HOST}:${REMOTE_DIR}/${FILE}`]);
run("ssh", [HOST, `chmod 644 ${REMOTE_DIR}/${FILE} && ls -l ${REMOTE_DIR}/${FILE}`]);

// Head and range check against the public endpoint. Range support is not
// optional: PMTiles reads a 16 kB header and then byte ranges.
const head = await fetch(URL, { method: "HEAD" });
const headers = Object.fromEntries(head.headers.entries());
const checks = {
  status: head.status,
  acceptRanges: headers["accept-ranges"],
  cors: headers["access-control-allow-origin"],
  contentType: headers["content-type"],
  length: headers["content-length"],
  cache: headers["cache-control"],
};
const range = await fetch(URL, { headers: { Range: "bytes=0-126" } });
const body = new Uint8Array(await range.arrayBuffer());
checks.rangeStatus = range.status;
checks.rangeBytes = body.length;
checks.magic = new TextDecoder().decode(body.slice(0, 7));

console.log(checks);
const ok =
  checks.status === 200 &&
  checks.acceptRanges === "bytes" &&
  checks.cors === "*" &&
  checks.rangeStatus === 206 &&
  checks.rangeBytes === 127 &&
  checks.magic === "PMTiles";
if (!ok) {
  console.error("verification failed");
  process.exitCode = 1;
} else {
  console.log(`ok: ${URL}`);
}
