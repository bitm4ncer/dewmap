/**
 * Routing facade: dispatches a normalized request to the right provider and
 * applies the car fallback (Valhalla -> BRouter car-eco).
 */

import { planBrouter } from "./providers/brouter";
import { planMotis } from "./providers/motis";
import { planValhalla } from "./providers/valhalla";
import {
  ProviderError,
  isAbortError,
  toProviderError,
  type RoutePlan,
  type RouteRequest,
} from "./types";

export interface PlanHandlers {
  /** Called as soon as an alternative is available (BRouter streaming). */
  onPlan?: (plan: RoutePlan) => void;
}

function validateRequest(request: RouteRequest): void {
  if (request.waypoints.length < 2) {
    throw new ProviderError(
      "bad-response",
      "At least two waypoints are required.",
    );
  }
  for (const point of request.waypoints) {
    if (
      !Number.isFinite(point.lat)
      || !Number.isFinite(point.lon)
      || Math.abs(point.lat) > 90
      || Math.abs(point.lon) > 180
    ) {
      throw new ProviderError(
        "bad-response",
        "Waypoints must contain valid lat/lon values.",
      );
    }
  }
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new ProviderError("aborted", "Request aborted.");
  }
}

async function planCar(request: RouteRequest): Promise<RoutePlan[]> {
  try {
    return await planValhalla(request);
  } catch (err) {
    if (isAbortError(err) || request.signal?.aborted) throw err;

    // Valhalla is a shared demo server; fall back to BRouter's car profile
    // instead of failing the whole request.
    try {
      return await planBrouter({
        ...request,
        profile: "car-eco",
        alternatives: Math.min(Math.max(1, request.alternatives ?? 1), 3),
      });
    } catch (fallbackErr) {
      if (isAbortError(fallbackErr) || request.signal?.aborted) {
        throw fallbackErr;
      }
      throw toProviderError(err, "valhalla");
    }
  }
}

/** Plan routes for any supported travel mode. */
export async function planRoutes(request: RouteRequest): Promise<RoutePlan[]> {
  validateRequest(request);
  assertNotAborted(request.signal);

  switch (request.mode) {
    case "walk":
    case "bike":
      return planBrouter(request);
    case "car":
      return planCar(request);
    case "transit":
      return planMotis(request);
  }
}

/**
 * Like `planRoutes`, but BRouter alternatives are emitted through
 * `handlers.onPlan` as soon as they arrive. Car requests still try Valhalla
 * first and only stream when they fall back to BRouter.
 */
export async function planRoutesStreaming(
  request: RouteRequest,
  handlers: PlanHandlers = {},
): Promise<RoutePlan[]> {
  validateRequest(request);
  assertNotAborted(request.signal);

  if (request.mode === "walk" || request.mode === "bike") {
    return planBrouter(request, handlers);
  }

  if (request.mode === "car") {
    try {
      const plans = await planValhalla(request);
      for (const plan of plans) {
        if (!request.signal?.aborted) handlers.onPlan?.(plan);
      }
      return plans;
    } catch (err) {
      if (isAbortError(err) || request.signal?.aborted) throw err;
      try {
        return await planBrouter(
          {
            ...request,
            profile: "car-eco",
            alternatives: Math.min(
              Math.max(1, request.alternatives ?? 1),
              3,
            ),
          },
          handlers,
        );
      } catch (fallbackErr) {
        if (isAbortError(fallbackErr) || request.signal?.aborted) {
          throw fallbackErr;
        }
        throw toProviderError(err, "valhalla");
      }
    }
  }

  return planMotis(request);
}
