import { afterEach, describe, expect, it, vi } from "vitest";
import { overpassQuery } from "./overpass";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const oneNode = { elements: [{ type: "node", id: 1, lat: 1, lon: 2 }] };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("overpassQuery", () => {
  it("tries the regional Europe mirror first", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(oneNode));
    vi.stubGlobal("fetch", fetchMock);

    await overpassQuery("node(1);");

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "ovp.dresel.systems/api/interpreter",
    );
  });

  it("rotates to the next endpoint on a non-OK response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse(oneNode));
    vi.stubGlobal("fetch", fetchMock);

    const data = await overpassQuery("node(1);");

    expect(data.elements).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rotates past an empty response when rejectEmpty is set", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ elements: [] }))
      .mockResolvedValueOnce(jsonResponse(oneNode));
    vi.stubGlobal("fetch", fetchMock);

    const data = await overpassQuery("node(1);", undefined, {
      rejectEmpty: true,
    });

    expect(data.elements).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an empty result when every endpoint agrees on empty", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ elements: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const data = await overpassQuery("node(1);", undefined, {
      rejectEmpty: true,
    });

    expect(data.elements).toEqual([]);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("treats an Overpass remark as a failure and rotates", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ remark: "runtime error: query timed out", elements: [] }),
      )
      .mockResolvedValueOnce(jsonResponse(oneNode));
    vi.stubGlobal("fetch", fetchMock);

    const data = await overpassQuery("node(1);", undefined, {
      rejectEmpty: true,
    });

    expect(data.elements).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rotates when a mirror answers with a non-JSON body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>error</html>", { status: 200 }))
      .mockResolvedValueOnce(jsonResponse(oneNode));
    vi.stubGlobal("fetch", fetchMock);

    const data = await overpassQuery("node(1);");

    expect(data.elements).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not touch the network when the signal is already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(overpassQuery("node(1);", controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws after every endpoint failed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 504));
    vi.stubGlobal("fetch", fetchMock);

    await expect(overpassQuery("node(1);")).rejects.toThrow(
      /All Overpass endpoints failed/,
    );
  });
});
