import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchJson,
  providerErrorKindForStatus,
  withTimeout,
} from "./http";
import { ProviderError } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function captureError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error("Expected the promise to reject.");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("providerErrorKindForStatus", () => {
  it("maps status classes to normalized kinds", () => {
    expect(providerErrorKindForStatus(429)).toBe("rate-limit");
    expect(providerErrorKindForStatus(500)).toBe("network");
    expect(providerErrorKindForStatus(503)).toBe("network");
    expect(providerErrorKindForStatus(408)).toBe("network");
    expect(providerErrorKindForStatus(400)).toBe("bad-response");
    expect(providerErrorKindForStatus(404)).toBe("bad-response");
  });
});

describe("fetchJson", () => {
  it("returns parsed JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true })),
    );
    await expect(fetchJson<{ ok: boolean }>("https://example.test")).resolves.toEqual({
      ok: true,
    });
  });

  it("maps 429 to rate-limit and reads Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("slow down", {
            status: 429,
            headers: { "Retry-After": "12" },
          }),
      ),
    );

    const err = await captureError(
      fetchJson("https://example.test", { provider: "motis" }),
    );
    expect(err.kind).toBe("rate-limit");
    expect(err.status).toBe(429);
    expect(err.retryAfterS).toBe(12);
    expect(err.provider).toBe("motis");
  });

  it("maps 5xx to network", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );
    const err = await captureError(fetchJson("https://example.test"));
    expect(err.kind).toBe("network");
    expect(err.status).toBe(502);
  });

  it("maps 4xx to bad-response unless marked as no-route", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 400 })),
    );
    const bad = await captureError(fetchJson("https://example.test"));
    expect(bad.kind).toBe("bad-response");

    const noRoute = await captureError(
      fetchJson("https://example.test", { noRouteStatuses: [400] }),
    );
    expect(noRoute.kind).toBe("no-route");
  });

  it("maps invalid JSON to bad-response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{not json", {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const err = await captureError(fetchJson("https://example.test"));
    expect(err.kind).toBe("bad-response");
  });

  it("maps an empty body to bad-response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200 })),
    );
    const err = await captureError(fetchJson("https://example.test"));
    expect(err.kind).toBe("bad-response");
  });

  it("supports caller aborts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const abortError = new Error("aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }),
      ),
    );

    const controller = new AbortController();
    const promise = fetchJson("https://example.test", {
      signal: controller.signal,
      timeoutMs: 500,
    });
    controller.abort();

    const err = await captureError(promise);
    expect(err.kind).toBe("aborted");
  });

  it("times out into a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const abortError = new Error("aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }),
      ),
    );

    const err = await captureError(
      fetchJson("https://example.test", { timeoutMs: 20 }),
    );
    expect(err.kind).toBe("network");
    expect(err.message).toMatch(/timed out/i);
  });

  it("rejects before calling fetch when already aborted", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    const err = await captureError(
      fetchJson("https://example.test", { signal: controller.signal }),
    );
    expect(err.kind).toBe("aborted");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("withTimeout", () => {
  it("resolves when the promise wins", async () => {
    await expect(withTimeout(Promise.resolve(42), 100)).resolves.toBe(42);
  });

  it("rejects with a network error on timeout", async () => {
    const err = await captureError(
      withTimeout(new Promise<never>(() => undefined), 10),
    );
    expect(err.kind).toBe("network");
    expect(err.message).toMatch(/timed out/i);
  });

  it("rejects with aborted when the signal fires", async () => {
    const controller = new AbortController();
    const promise = withTimeout(
      new Promise<never>(() => undefined),
      1_000,
      { signal: controller.signal },
    );
    controller.abort();
    const err = await captureError(promise);
    expect(err.kind).toBe("aborted");
  });
});
