import { FileSource, PMTiles, Protocol } from "pmtiles";
import type { AddProtocolAction } from "maplibre-gl";
import type { HistoricManifest, HistoricManifestFile } from "./types";

export type ArchiveMode = "range" | "full" | "missing";

export interface ProbeResult {
  mode: ArchiveMode;
  blob?: Blob;
}

interface MapLibreLike {
  addProtocol: (name: string, handler: AddProtocolAction) => void;
}

const PMTILES_MAGIC = "PMTiles";

function defaultBaseUrl(): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const href =
    typeof location !== "undefined" ? location.href : "http://localhost/";
  const root = basePath
    ? new URL(`${basePath.replace(/\/$/, "")}/`, href).href
    : new URL("./", href).href;
  return root;
}

export function dataBaseUrl(baseUrl = defaultBaseUrl()): string {
  return new URL("data/history/", baseUrl).href;
}

export function historyManifestUrl(baseUrl?: string): string {
  return new URL("manifest.json", dataBaseUrl(baseUrl)).href;
}

export function historyFileUrl(path: string, baseUrl?: string): string {
  return new URL(path, dataBaseUrl(baseUrl)).href;
}

export async function probeHistoryArchive(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeResult> {
  const response = await fetchImpl(url, {
    headers: { Range: "bytes=0-7" },
    cache: "no-store",
  });

  if (response.status === 200) {
    return { mode: "full", blob: await response.blob() };
  }
  if (response.status !== 206) {
    return { mode: "missing" };
  }

  const encoding = response.headers.get("content-encoding");
  const contentRange = response.headers.get("content-range");
  if (encoding && encoding !== "identity") {
    return { mode: "full" };
  }
  if (!contentRange || !/^bytes 0-7\/(\d+|\*)$/.test(contentRange)) {
    return { mode: "full" };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== 8 || bytes[7] !== 3) {
    return { mode: "full" };
  }
  const prefix = new TextDecoder().decode(bytes.slice(0, 7));
  if (prefix !== PMTILES_MAGIC) {
    return { mode: "full" };
  }
  return { mode: "range" };
}

export async function loadHistoryManifest(
  url: string = historyManifestUrl(),
  fetchImpl: typeof fetch = fetch,
): Promise<HistoricManifest | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const manifest = (await response.json()) as HistoricManifest;
    if (
      manifest?.schema !== 1 ||
      typeof manifest.buildId !== "string" ||
      !Array.isArray(manifest.files?.clusters) ||
      typeof manifest.files?.sites?.path !== "string"
    ) {
      return null;
    }
    return manifest;
  } catch {
    return null;
  }
}

export async function verifyManifestFile(
  file: HistoricManifestFile,
  blob: Blob,
): Promise<boolean> {
  if (!file.sha256) return true;
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return hex === file.sha256.toLowerCase();
}

export interface HistoryProtocol {
  protocol: Protocol;
  open: (
    file: HistoricManifestFile,
    mode: Exclude<ArchiveMode, "missing">,
    blob?: Blob,
  ) => Promise<string>;
}

const protocols = new WeakMap<object, Protocol>();

export function createHistoryProtocol(
  maplibregl: MapLibreLike,
  { baseUrl }: { baseUrl?: string } = {},
): HistoryProtocol {
  let protocol = protocols.get(maplibregl);
  if (!protocol) {
    protocol = new Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    protocols.set(maplibregl, protocol);
  }

  const open: HistoryProtocol["open"] = async (file, mode, blob) => {
    const name = file.path.split("/").pop() ?? file.path;
    if (mode === "range") {
      const absoluteUrl = historyFileUrl(file.path, baseUrl);
      if (!protocol.get(absoluteUrl)) {
        protocol.add(new PMTiles(absoluteUrl));
      }
      return `pmtiles://${absoluteUrl}`;
    }

    let body = blob;
    if (!body) {
      const response = await fetch(historyFileUrl(file.path, baseUrl));
      if (!response.ok) {
        throw new Error(`cannot download ${file.path}: HTTP ${response.status}`);
      }
      body = await response.blob();
    }
    const archive = new PMTiles(new FileSource(new File([body], name)));
    protocol.add(archive);
    return `pmtiles://${name}`;
  };

  return { protocol, open };
}
