/**
 * Public Overpass mirrors. All three serve the planet; `overpass.osm.ch`
 * was removed because it only covers Switzerland and answers German
 * bboxes with a false-empty 200.
 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export interface OverpassNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}

export interface OverpassWay {
  type: "way";
  id: number;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export interface OverpassRelationMember {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
  geometry?: { lat: number; lon: number }[];
}

export interface OverpassRelation {
  type: "relation";
  id: number;
  tags?: Record<string, string>;
  members?: OverpassRelationMember[];
}

export type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

export interface OverpassResponse {
  elements: OverpassElement[];
  /** Overpass reports runtime errors (timeout, memory) with HTTP 200. */
  remark?: string;
}

/** Per-endpoint wall clock so one dead mirror cannot stall the overlay. */
const DEFAULT_TIMEOUT_MS = 20_000;

export interface OverpassQueryOptions {
  timeoutMs?: number;
  /**
   * Keep rotating when an endpoint answers 200 with no elements. A
   * region-limited or degraded mirror otherwise looks like a valid empty
   * result; only an empty answer from every endpoint is authoritative.
   */
  rejectEmpty?: boolean;
}

/**
 * Run an Overpass query with endpoint rotation. POSTs the query so long
 * `out geom` bodies do not hit URL limits. Every endpoint gets its own
 * timeout; a 429/504 falls through to the next mirror immediately, and
 * runtime-error `remark`s are treated as failures rather than data.
 */
export async function overpassQuery(
  query: string,
  signal?: AbortSignal,
  options: OverpassQueryOptions = {},
): Promise<OverpassResponse> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastErr: unknown;
  let empty: OverpassResponse | null = null;

  for (const endpoint of ENDPOINTS) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass ${endpoint} → ${res.status}`);
        continue;
      }
      const json = (await res.json()) as OverpassResponse;
      if (!json || !Array.isArray(json.elements)) {
        lastErr = new Error(`Overpass ${endpoint} returned no element list`);
        continue;
      }
      if (typeof json.remark === "string" && json.remark.length > 0) {
        lastErr = new Error(`Overpass ${endpoint}: ${json.remark}`);
        continue;
      }
      if (options.rejectEmpty && json.elements.length === 0) {
        empty = json;
        lastErr = new Error(`Overpass ${endpoint} returned no elements`);
        continue;
      }
      return json;
    } catch (err) {
      // The caller cancelled: stop rotating and surface the abort.
      if (signal?.aborted) throw err;
      if ((err as Error).name === "AbortError") {
        lastErr = new Error(`Overpass ${endpoint} timed out`);
      } else {
        lastErr = err;
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  // Every mirror agreed that there is nothing here. That is a real
  // empty result (rural area), not a failure.
  if (empty) return empty;

  throw new Error(
    `All Overpass endpoints failed: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}
