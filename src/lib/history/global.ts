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
  const configured = process.env.NEXT_PUBLIC_HISTORY_DATA_URL;
  if (configured) {
    return new URL(configured, baseUrl).href.replace(/\/*$/, "/");
  }
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
  expectedBytes?: number,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const response = await fetchImpl(url, {
    headers: { Range: "bytes=0-7" },
    cache: "no-store",
    signal,
  });

  if (response.status === 200) {
    const blob = await response.blob();
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (
      head.byteLength !== 8 ||
      new TextDecoder().decode(head.slice(0, 7)) !== PMTILES_MAGIC ||
      head[7] !== 3
    ) {
      return { mode: "missing" };
    }
    return { mode: "full", blob };
  }
  if (response.status !== 206) {
    return { mode: "missing" };
  }

  const encoding = response.headers.get("content-encoding");
  const contentRange = response.headers.get("content-range");
  if (encoding && encoding !== "identity") {
    return { mode: "full" };
  }
  const rangeMatch = contentRange?.match(/^bytes 0-7\/(\d+|\*)$/);
  if (!rangeMatch) {
    return { mode: "full" };
  }
  if (
    expectedBytes !== undefined &&
    rangeMatch[1] !== "*" &&
    Number(rangeMatch[1]) !== expectedBytes
  ) {
    return { mode: "missing" };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== 8 || bytes[7] !== 3) {
    return { mode: "full" };
  }
  const prefix = new TextDecoder().decode(bytes.slice(0, 7));
  if (prefix !== PMTILES_MAGIC || bytes[7] !== 3) {
    return { mode: "missing" };
  }
  return { mode: "range" };
}

export async function loadHistoryManifest(
  url: string = historyManifestUrl(),
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<HistoricManifest | null> {
  try {
    const response = await fetchImpl(url, { cache: "no-store", signal });
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
    signal?: AbortSignal,
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

  const open: HistoryProtocol["open"] = async (file, mode, blob, signal) => {
    const name = file.path.split("/").pop() ?? file.path;
    if (mode === "range") {
      const absoluteUrl = historyFileUrl(file.path, baseUrl);
      if (!protocol.get(absoluteUrl)) {
        protocol.add(new PMTiles(absoluteUrl));
      }
      return `pmtiles://${absoluteUrl}`;
    }

    if (protocol.get(name)) return `pmtiles://${name}`;

    let body = blob;
    if (!body) {
      const response = await fetch(historyFileUrl(file.path, baseUrl), {
        signal,
      });
      if (!response.ok) {
        throw new Error(`cannot download ${file.path}: HTTP ${response.status}`);
      }
      body = await response.blob();
    }
    if (!(await verifyManifestFile(file, body))) {
      throw new Error(`${file.path}: sha256 does not match the manifest`);
    }
    const archive = new PMTiles(new FileSource(new File([body], name)));
    protocol.add(archive);
    return `pmtiles://${name}`;
  };

  return { protocol, open };
}
