import { afterEach, describe, expect, it, vi } from "vitest";
import { findPanoramaxStreetView } from "./panoramax";

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    json: async () => value,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("findPanoramaxStreetView", () => {
  it("asks for pictures looking at the place and prefers a flat image", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => {
      void _input;
      return jsonResponse({
        features: [
          {
            id: "panorama",
            geometry: { coordinates: [13.405, 52.52] },
            properties: { datetime: "2025-01-01T10:00:00Z" },
            assets: { thumb: { href: "/pano-thumb.jpg" } },
          },
          {
            id: "facade",
            geometry: { coordinates: [13.4051, 52.5201] },
            properties: {
              datetime: "2025-04-09T18:56:17Z",
              license: "CC-BY-SA-4.0",
              "view:azimuth": 22,
              "geovisio:status": "ready",
              "geovisio:producer": "Britzz",
            },
            assets: {
              thumb: { href: "https://example.test/thumb.jpg" },
              sd: { href: "https://example.test/sd.jpg" },
            },
            links: [
              {
                rel: "license",
                href: "https://creativecommons.org/licenses/by-sa/4.0/",
              },
              { rel: "via", href: "https://panoramax.example.test" },
            ],
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await findPanoramaxStreetView(13.405, 52.52);

    expect(result).not.toBeNull();
    expect(result?.id).toBe("facade");
    expect(result?.attribution).toBe("© Britzz / Panoramax");
    expect(result?.license).toBe("CC-BY-SA-4.0");
    expect(result?.thumbUrl).toBe("https://example.test/thumb.jpg");
    expect(result?.viewerUrl).toContain("viewer.geovisio.fr/photo.html");
    expect(result?.viewerUrl).toContain("pic=facade");
    expect(result?.viewerUrl).toContain("focus=pic");
    expect(result?.viewerUrl).toContain("nav=seq");
    expect(result?.sourceUrl).toBe("https://panoramax.example.test");

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("place_position=13.405%2C52.52");
    expect(url).toContain("place_distance=3-50");
    expect(url).toContain("place_fov_tolerance=60");
  });

  it("falls back to the nearest picture when no facade shot exists", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("place_fov_tolerance=60")) {
        return jsonResponse({ features: [] });
      }
      return jsonResponse({
        features: [
          {
            id: "nearby",
            geometry: { coordinates: [13.405, 52.52] },
            properties: { "view:azimuth": 180 },
            assets: { thumb: { href: "https://example.test/nearby.jpg" } },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await findPanoramaxStreetView(13.405, 52.52);

    expect(result?.id).toBe("nearby");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallbackUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(fallbackUrl).toContain("place_distance=3-100");
    expect(fallbackUrl).toContain("place_fov_tolerance=180");
  });

  it("returns null when there is no nearby picture", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ features: [] })));

    await expect(findPanoramaxStreetView(13.405, 52.52)).resolves.toBeNull();
  });

  it("returns null on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    await expect(findPanoramaxStreetView(13.405, 52.52)).resolves.toBeNull();
  });
});
