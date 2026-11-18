"use client";
/* eslint-disable react-hooks/set-state-in-effect -- GPS, simulation and off-route state are external sensor synchronization */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { useNavigation } from "./store";
import {
  computeRouteProgress,
  isOffRoute,
  previewSpeedMps,
  sampleRouteAtDistance,
  type RouteProgress,
} from "./progress";

export interface LivePosition {
  lon: number;
  lat: number;
  heading: number | null;
  speedMps: number | null;
  accuracyM: number | null;
}

interface Options {
  mapRef: React.MutableRefObject<MLMap | null>;
}

export function useNavigationEngine({ mapRef }: Options) {
  const active = useNavigation((s) => s.active);
  const plan = useNavigation((s) => s.plan);
  const muted = useNavigation((s) => s.muted);
  const follow = useNavigation((s) => s.follow);
  const simulate = useNavigation((s) => s.simulate);
  const guidance = useNavigation((s) => s.guidance);
  const [position, setPosition] = useState<LivePosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offRoute, setOffRoute] = useState(false);
  const offSinceRef = useRef<number | null>(null);
  const lastSpokenRef = useRef<number | null>(null);
  const lastFollowRef = useRef<number>(0);
  const lastTransitAlertRef = useRef<string | null>(null);

  const progress: RouteProgress | null = useMemo(() => {
    if (!plan || !position) return null;
    return computeRouteProgress(plan, position);
  }, [plan, position]);

  // Reset transient state whenever a new route starts.
  useEffect(() => {
    setPosition(null);
    setError(null);
    setOffRoute(false);
    offSinceRef.current = null;
    lastSpokenRef.current = null;
    lastFollowRef.current = 0;
    lastTransitAlertRef.current = null;
  }, [plan?.id, active]);

  // Live GPS.
  useEffect(() => {
    if (!active || !plan || simulate) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Location is not available in this browser.");
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lon: pos.coords.longitude,
          lat: pos.coords.latitude,
          heading:
            typeof pos.coords.heading === "number" && !Number.isNaN(pos.coords.heading)
              ? pos.coords.heading
              : null,
          speedMps:
            typeof pos.coords.speed === "number" && !Number.isNaN(pos.coords.speed)
              ? pos.coords.speed
              : null,
          accuracyM:
            typeof pos.coords.accuracy === "number" ? pos.coords.accuracy : null,
        });
        setError(null);
      },
      (err) => setError(err.message),
      {
        // A train is usually followed on the timetable; walking to/from the
        // stop still needs a precise fix. Avoid a hot GPS while on board.
        enableHighAccuracy: plan.mode !== "transit",
        maximumAge: plan.mode === "transit" ? 5_000 : 0,
        timeout: 20_000,
      },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [active, plan, simulate]);

  // Simulation mode — move along the polyline at a fixed speed.
  useEffect(() => {
    if (!active || !plan || !simulate) return;
    const coords = plan.coordinates;
    if (coords.length < 2) return;
    let cancelled = false;
    let last = performance.now();
    let travelled = 0;
    const total = Math.max(1, plan.distanceKm * 1000);
    const speed = previewSpeedMps(plan);
    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      travelled = Math.min(total, travelled + speed * dt);
      const sample = sampleRouteAtDistance(coords, travelled);
      if (!sample) {
        setError("Route geometry is not available.");
        return;
      }
      setPosition({
        lon: sample.lon,
        lat: sample.lat,
        heading: sample.bearing,
        speedMps: speed,
        accuracyM: 5,
      });
      if (travelled >= total) {
        setError("Destination reached.");
        return;
      }
      window.setTimeout(tick, 120);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [active, plan, simulate]);

  // Off-route detection: must be off-route continuously for 10 s.
  useEffect(() => {
    if (!active || !progress) return;
    if (isOffRoute(progress)) {
      if (offSinceRef.current == null) offSinceRef.current = Date.now();
      else if (Date.now() - offSinceRef.current > 10_000) setOffRoute(true);
    } else {
      offSinceRef.current = null;
      setOffRoute(false);
    }
  }, [active, progress]);

  // Voice guidance — one utterance per maneuver.
  useEffect(() => {
    if (!active || muted || !progress?.next) return;
    const key = progress.next.startIndex;
    if (lastSpokenRef.current === key) return;
    lastSpokenRef.current = key;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utter = new SpeechSynthesisUtterance(progress.next.verbal);
    utter.lang = navigator.language?.toLowerCase().startsWith("de")
      ? "de-DE"
      : "en-US";
    utter.rate = 0.95;
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    } catch {
      /* not fatal */
    }
  }, [active, muted, progress?.next]);

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Camera follow. Throttle to at most once per second and only when the
  // position moved meaningfully.
  useEffect(() => {
    const map = mapRef.current;
    if (!active || !plan || !map || !position) return;
    const now = Date.now();
    if (now - lastFollowRef.current < 900) return;
    if (map.isMoving() && follow === "north") return;
    lastFollowRef.current = now;
    const bearing =
      follow === "course" ? (position.heading ?? map.getBearing()) : 0;
    try {
      map.easeTo({
        center: [position.lon, position.lat],
        bearing,
        zoom:
          plan.mode === "transit"
            ? Math.max(12, Math.min(15, map.getZoom()))
            : Math.max(15, map.getZoom()),
        duration: 700,
        pitch: 0,
      });
    } catch {
      /* style not loaded */
    }
  }, [active, mapRef, position, follow, plan]);

  // Transit exit alert: vibrate and speak shortly before the alighting stop.
  useEffect(() => {
    if (!active || muted || guidance !== "live" || !plan?.transit) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const legs = plan.transit?.legs ?? [];
      for (let index = 0; index < legs.length; index += 1) {
        const leg = legs[index];
        if (leg.mode !== "transit" || leg.cancelled) continue;
        const arrival = Date.parse(leg.arrival);
        if (!Number.isFinite(arrival)) continue;
        const minutes = (arrival - now) / 60_000;
        if (minutes <= 0 || minutes > 2) continue;
        const key = `${leg.to.stopId ?? leg.to.name}@${leg.arrival}`;
        if (lastTransitAlertRef.current === key) break;
        lastTransitAlertRef.current = key;
        const nav = navigator as Navigator & {
          vibrate?: (pattern: number | number[]) => boolean;
        };
        nav.vibrate?.([180, 80, 180]);
        if ("speechSynthesis" in window) {
          const nextTransit = legs
            .slice(index + 1)
            .find((candidate) => candidate.mode === "transit");
          const platform = leg.to.platform ? ` Platform ${leg.to.platform}.` : "";
          const utter = new SpeechSynthesisUtterance(
            nextTransit
              ? `Change at ${leg.to.name} for ${nextTransit.line ?? "the next service"}.${platform}`
              : `Next stop: ${leg.to.name}.${platform}`,
          );
          utter.lang = navigator.language?.toLowerCase().startsWith("de")
            ? "de-DE"
            : "en-US";
          utter.rate = 0.95;
          try {
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(utter);
          } catch {
            /* not fatal */
          }
        }
        break;
      }
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [active, guidance, muted, plan]);

  // Keep the screen awake while navigating.
  useEffect(() => {
    if (!active) return;
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<Sentinel> };
    };
    let sentinel: Sentinel | null = null;
    nav.wakeLock
      ?.request("screen")
      .then((s) => {
        sentinel = s;
      })
      .catch(() => {});
    return () => {
      sentinel?.release().catch(() => {});
    };
  }, [active]);

  return { progress, position, error, offRoute };
}
