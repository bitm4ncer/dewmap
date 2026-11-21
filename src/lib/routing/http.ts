/**
 * Minimal JSON-over-fetch helper with timeouts, abort support, and a stable
 * error shape. No third-party dependencies.
 */

import {
  ProviderError,
  isAbortError,
  type ProviderErrorKind,
  type ProviderId,
} from "./types";

/** Route planning can legitimately take a while on public endpoints. */
export const PLAN_TIMEOUT_MS = 20_000;
/** Transit/place search should feel instant; fail fast. */
export const GEOCODE_TIMEOUT_MS = 8_000;

export interface FetchJsonInit {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Raw request body. Mutually exclusive with `json`. */
  body?: string;
  /** Convenience: JSON encode this value and set Content-Type. */
  json?: unknown;
  signal?: AbortSignal;
  /** Defaults to `PLAN_TIMEOUT_MS`. */
  timeoutMs?: number;
  provider?: ProviderId;
  /** HTTP statuses that mean "there is no route" for this endpoint. */
  noRouteStatuses?: readonly number[];
  /**
   * Called with the decoded body length. Used by the live-vehicle layer to
   * adapt its polling interval; the browser hides the compressed wire size.
   */
  onResponseSize?: (bytes: number) => void;
}

/** Map an HTTP status to a normalized error kind. */
export function providerErrorKindForStatus(status: number): ProviderErrorKind {
  if (status === 429) return "rate-limit";
  if (status >= 500 || status === 408) return "network";
  return "bad-response";
}

function parseRetryAfter(
  header: string | null,
  now = Date.now(),
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

async function responseToError(
  response: Response,
  init: FetchJsonInit,
): Promise<ProviderError> {
  let bodySnippet = "";
  try {
    const text = await response.text();
    bodySnippet = text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    // Ignore body read failures; the status is the useful part.
  }

  const noRoute = init.noRouteStatuses?.includes(response.status) ?? false;
  const kind = noRoute
    ? "no-route"
    : providerErrorKindForStatus(response.status);
  const suffix = bodySnippet ? `: ${bodySnippet}` : "";
  return new ProviderError(
    kind,
    `HTTP ${response.status}${suffix || " from routing provider"}`,
    {
      status: response.status,
      retryAfterS: parseRetryAfter(response.headers.get("retry-after")),
      provider: init.provider,
    },
  );
}

/**
 * Fetch a URL and parse the response as JSON.
 *
 * - The caller's `signal` and an internal timeout are combined.
 * - 429 -> `rate-limit`, 5xx -> `network`, invalid JSON -> `bad-response`.
 * - A caller abort always surfaces as `aborted`, even if a timeout raced it.
 */
export async function fetchJson<T>(
  url: string,
  init: FetchJsonInit = {},
): Promise<T> {
  const timeoutMs = init.timeoutMs ?? PLAN_TIMEOUT_MS;
  const callerSignal = init.signal;

  if (callerSignal?.aborted) {
    throw new ProviderError("aborted", "Request aborted.", {
      provider: init.provider,
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...init.headers,
  };

  let body = init.body;
  if (init.json !== undefined) {
    body = JSON.stringify(init.json);
    if (!("Content-Type" in headers)) {
      headers["Content-Type"] = "application/json";
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (callerSignal?.aborted) {
      throw new ProviderError("aborted", "Request aborted.", {
        provider: init.provider,
        cause: err,
      });
    }
    if (timedOut) {
      throw new ProviderError(
        "network",
        `Request timed out after ${timeoutMs} ms.`,
        { provider: init.provider, cause: err },
      );
    }
    if (isAbortError(err)) {
      throw new ProviderError("aborted", "Request aborted.", {
        provider: init.provider,
        cause: err,
      });
    }
    throw new ProviderError(
      "network",
      err instanceof Error ? err.message : "Network request failed.",
      { provider: init.provider, cause: err },
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }

  if (!response.ok) {
    throw await responseToError(response, init);
  }

  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    if (callerSignal?.aborted) {
      throw new ProviderError("aborted", "Request aborted.", {
        provider: init.provider,
        cause: err,
      });
    }
    throw new ProviderError("network", "Failed to read response body.", {
      provider: init.provider,
      cause: err,
    });
  }

  init.onResponseSize?.(text.length);

  if (text.trim() === "") {
    throw new ProviderError("bad-response", "Provider returned an empty body.", {
      status: response.status,
      provider: init.provider,
    });
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
    throw new ProviderError(
      "bad-response",
      snippet
        ? `Provider returned invalid JSON: ${snippet}`
        : "Provider returned invalid JSON.",
      { status: response.status, provider: init.provider, cause: err },
    );
  }
}

/**
 * Reject a promise after `timeoutMs`, or when `signal` aborts.
 * The original promise is not cancelled — callers should still pass an
 * AbortSignal to `fetch` when possible.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  options: { signal?: AbortSignal; message?: string } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new ProviderError("aborted", "Request aborted."));
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      fn();
    };

    const timer = setTimeout(() => {
      finish(() => {
        reject(
          new ProviderError(
            "network",
            options.message ?? `Request timed out after ${timeoutMs} ms.`,
          ),
        );
      });
    }, timeoutMs);

    const onAbort = () => {
      finish(() => reject(new ProviderError("aborted", "Request aborted.")));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => finish(() => resolve(value)),
      (err: unknown) => finish(() => reject(err)),
    );
  });
}
