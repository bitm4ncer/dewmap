import { describe, expect, it, vi } from "vitest";
import {
  createHistoryProtocol,
  loadHistoryManifest,
  probeHistoryArchive,
} from "./global";
import type { HistoricManifest } from "./types";

const MAGIC = new Uint8Array([
  ...new TextEncoder().encode("PMTiles"),
  3,
]);

function response(
  body: BodyInit | null,
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(body, init);
}

describe("probeHistoryArchive", () => {
  it("accepts a clean 206 with the PMTiles magic", async () => {
    const fetchImpl = vi.fn(async () =>
      response(MAGIC, {
        status: 206,
        headers: {
          "content-range": "bytes 0-7/1000",
          "content-length": "8",
        },
      }),
    );
    await expect(
      probeHistoryArchive("https://example.test/a.pmtiles", fetchImpl),
    ).resolves.toEqual({ mode: "range" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.test/a.pmtiles",
      expect.objectContaining({
        headers: { Range: "bytes=0-7" },
      }),
    );
  });

  it("rejects a 206 with content-encoding: gzip", async () => {
    const fetchImpl = async () =>
      response(MAGIC, {
        status: 206,
        headers: {
          "content-encoding": "gzip",
          "content-range": "bytes 0-7/1000",
          "content-length": "8",
        },
      });
    await expect(
      probeHistoryArchive("https://example.test/a.pmtiles", fetchImpl),
    ).resolves.toEqual({ mode: "full" });
  });

  it("rejects a 206 with a short or wrong body", async () => {
    const short = async () =>
      response(MAGIC.slice(0, 4), {
        status: 206,
        headers: { "content-range": "bytes 0-7/1000", "content-length": "4" },
      });
    const wrong = async () =>
      response(new Uint8Array(8), {
        status: 206,
        headers: { "content-range": "bytes 0-7/1000", "content-length": "8" },
      });
    await expect(
      probeHistoryArchive("https://example.test/a.pmtiles", short),
    ).resolves.toEqual({ mode: "full" });
    await expect(
      probeHistoryArchive("https://example.test/a.pmtiles", wrong),
    ).resolves.toEqual({ mode: "full" });
  });

  it("reuses a 200 body for the full fallback", async () => {
    const fetchImpl = async () =>
      response(new Blob([MAGIC, "whole file"]), { status: 200 });
    const result = await probeHistoryArchive(
      "https://example.test/a.pmtiles",
      fetchImpl,
    );
    expect(result.mode).toBe("full");
    expect(result.blob).toBeInstanceOf(Blob);
    expect(await result.blob?.text()).toContain("whole file");
  });

  it("rejects a 200 HTML fallback page", async () => {
    const fetchImpl = async () =>
      response(new Blob(["<html>not an archive</html>"]), { status: 200 });
    await expect(
      probeHistoryArchive("https://example.test/a.pmtiles", fetchImpl),
    ).resolves.toEqual({ mode: "missing" });
  });

  it("rejects a content-range size mismatch", async () => {
    const fetchImpl = async () =>
      response(MAGIC, {
        status: 206,
        headers: {
          "content-range": "bytes 0-7/999",
          "content-length": "8",
        },
      });
    await expect(
      probeHistoryArchive("https://example.test/a.pmtiles", fetchImpl, 1000),
    ).resolves.toEqual({ mode: "missing" });
  });

  it("reports a missing archive", async () => {
    const fetchImpl = async () => response("nope", { status: 404 });
    await expect(
      probeHistoryArchive("https://example.test/a.pmtiles", fetchImpl),
    ).resolves.toEqual({ mode: "missing" });
  });
});

describe("loadHistoryManifest", () => {
  const manifest: HistoricManifest = {
    schema: 1,
    buildId: "history-20261118-0400",
    builtAt: "2026-11-18T04:00:00Z",
    counts: { sites: 10, clusters: 2 },
    files: {
      clusters: [
        {
          path: "history-20261118-0400/history-clusters-0-1.pmtiles",
          bytes: 10,
          sha256: "a".repeat(64),
          minzoom: 0,
          maxzoom: 1,
        },
      ],
      sites: {
        path: "history-20261118-0400/history-sites.pmtiles",
        bytes: 20,
        sha256: "b".repeat(64),
      },
    },
    attribution: ["Wikidata contributors (CC0)"],
  };

  it("parses a valid manifest", async () => {
    const fetchImpl = async () => response(JSON.stringify(manifest));
    await expect(loadHistoryManifest("https://example.test/manifest.json", fetchImpl)).resolves.toEqual(
      manifest,
    );
  });

  it("returns null for a 404 or invalid JSON", async () => {
    await expect(
      loadHistoryManifest(
        "https://example.test/manifest.json",
        async () => response("nope", { status: 404 }),
      ),
    ).resolves.toBeNull();
    await expect(
      loadHistoryManifest(
        "https://example.test/manifest.json",
        async () => response("not json"),
      ),
    ).resolves.toBeNull();
  });
});

describe("createHistoryProtocol", () => {
  const maplibre = () => ({ addProtocol: vi.fn() });

  it("registers the protocol once", () => {
    const map = maplibre();
    createHistoryProtocol(map);
    createHistoryProtocol(map);
    expect(map.addProtocol).toHaveBeenCalledTimes(1);
  });

  it("opens a full-mode archive under its basename and returns the source URL", async () => {
    const map = maplibre();
    const { protocol, open } = createHistoryProtocol(map);
    const url = await open(
      {
        path: "history-20261118-0400/history-sites.pmtiles",
        bytes: 20,
        sha256: "",
      },
      "full",
      new Blob([MAGIC]),
    );
    expect(url).toBe("pmtiles://history-sites.pmtiles");
    expect(protocol.tiles.size).toBe(1);
  });

  it("opens a range-mode archive under its absolute URL", async () => {
    const map = maplibre();
    const { protocol, open } = createHistoryProtocol(map, {
      baseUrl: "https://example.test/dewmap/",
    });
    const url = await open(
      {
        path: "history-20261118-0400/history-sites.pmtiles",
        bytes: 20,
        sha256: "b".repeat(64),
      },
      "range",
    );
    expect(url).toBe(
      "pmtiles://https://example.test/dewmap/data/history/history-20261118-0400/history-sites.pmtiles",
    );
    expect(protocol.tiles.size).toBe(1);
  });
});
