import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWikidataImage", () => {
  it("resolves a P18 claim to a Commons thumbnail and caches it", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        claims: {
          P18: [
            {
              mainsnak: {
                datavalue: { value: "Cologne Cathedral.jpg" },
              },
            },
          ],
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { fetchWikidataImage } = await import("./wikipedia");
    const url = await fetchWikidataImage("Q1");

    expect(url).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Cologne%20Cathedral.jpg?width=320",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await fetchWikidataImage("Q1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the item has no image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ claims: {} })),
    );

    const { fetchWikidataImage } = await import("./wikipedia");
    await expect(fetchWikidataImage("Q2")).resolves.toBeNull();
  });
});
