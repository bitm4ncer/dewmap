"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { HudPanel } from "@/components/hud/HudPanel";
import { useCar, CAR_PROFILES, type CarProfile } from "@/lib/planner/carStore";
import { PlacePicker, type PickedPlace } from "./PlacePicker";
import { planRoutes, formatDuration, formatDistance, isAbortError } from "@/lib/routing";
import type { RoutePlan } from "@/lib/routing";
import { useNavigation } from "@/lib/navigation/store";

interface Props {
  mapRef: React.MutableRefObject<MLMap | null>;
}

export function CarPanel({ mapRef }: Props) {
  const waypoints = useCar((s) => s.waypoints);
  const profile = useCar((s) => s.profile);
  const routes = useCar((s) => s.routes);
  const selectedId = useCar((s) => s.selectedId);
  const phase = useCar((s) => s.phase);
  const notice = useCar((s) => s.notice);
  const addWaypoint = useCar((s) => s.addWaypoint);
  const removeWaypoint = useCar((s) => s.removeWaypoint);
  const moveWaypoint = useCar((s) => s.moveWaypoint);
  const clear = useCar((s) => s.clear);
  const setProfile = useCar((s) => s.setProfile);
  const setRoutes = useCar((s) => s.setRoutes);
  const selectRoute = useCar((s) => s.selectRoute);
  const setPhase = useCar((s) => s.setPhase);
  const setNotice = useCar((s) => s.setNotice);

  const abortRef = useRef<AbortController | null>(null);
  const lastFitRef = useRef<string | null>(null);
  const startNavigation = useNavigation((s) => s.start);

  const selected = useMemo(
    () => routes.find((r) => r.id === selectedId) ?? null,
    [routes, selectedId],
  );

  useEffect(() => {
    if (waypoints.length < 2) {
      abortRef.current?.abort();
      setRoutes([]);
      setPhase({ kind: "idle" });
      return;
    }
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    const timer = window.setTimeout(async () => {
      setPhase({ kind: "routing" });
      setNotice(null);
      try {
        const plans = await planRoutes({
          mode: "car",
          waypoints: waypoints.map((w) => ({ lat: w.lat, lon: w.lon })),
          profile,
          alternatives: 2,
          signal: ctrl.signal,
          options:
            profile === "avoid-highways"
              ? { avoidHighways: true }
              : profile === "avoid-tolls"
                ? { avoidTolls: true }
                : profile === "shortest"
                  ? { shortest: true }
                  : undefined,
        });
        if (ctrl.signal.aborted) return;
        setRoutes(plans);
      } catch (err) {
        if (isAbortError(err) || ctrl.signal.aborted) return;
        setPhase({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [waypoints, profile, setRoutes, setPhase, setNotice]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected || lastFitRef.current === selected.id) return;
    if (map.isMoving()) return;
    let south = Infinity;
    let west = Infinity;
    let north = -Infinity;
    let east = -Infinity;
    for (const [lon, lat] of selected.coordinates) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    if (!Number.isFinite(south)) return;
    lastFitRef.current = selected.id;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: { top: 90, bottom: typeof window !== "undefined" && window.innerWidth < 768 ? 280 : 80, left: 60, right: 60 }, duration: 650, maxZoom: 14 },
    );
  }, [mapRef, selected]);

  const addPlace = useCallback(
    (p: PickedPlace) => {
      addWaypoint({
        lat: p.lat,
        lon: p.lon,
        label: p.name,
        source: "search",
      });
    },
    [addWaypoint],
  );

  const addGps = useCallback(() => {
    if (!navigator.geolocation) {
      setNotice("Location is not available in this browser.");
      return;
    }
    setNotice("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        addWaypoint({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: "My location",
          source: "gps",
        });
        setNotice(null);
      },
      (err) => setNotice(err.message),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }, [addWaypoint, setNotice]);

  return (
    <div className="flex flex-col gap-3">
      <HudPanel>
        <div className="ui-section">
          <span className="ui-kicker">Drive</span>
          <div className="ui-row">
            <div className="ui-row-main">
              <div className="ui-row-title">
                {phase.kind === "routing"
                  ? "Calculating route…"
                  : selected
                    ? `${formatDuration(selected.durationMin)} · ${formatDistance(selected.distanceKm)}`
                    : "Plan a drive"}
              </div>
              <div className="ui-row-sub">
                {selected
                  ? selected.summary ?? "Turn-by-turn guidance with voice."
                  : "Add a start and destination. Valhalla routing · OpenStreetMap."}
              </div>
            </div>
          </div>
        </div>
      </HudPanel>

      <HudPanel>
        <div className="ui-section">
          <div className="flex items-center justify-between">
            <span className="ui-kicker">Stops · {waypoints.length}</span>
            {waypoints.length > 0 && (
              <button
                type="button"
                onClick={clear}
                className="text-[11.5px] font-semibold text-[color:var(--ink-mute)] hover:text-[color:var(--ink)]"
              >
                Clear
              </button>
            )}
          </div>
          {waypoints.length === 0 && (
            <p className="text-[12px] leading-relaxed text-[color:var(--ink-dim)]">
              Add a start and destination below, long-press the map, or use your
              current location.
            </p>
          )}
          <ul className="flex flex-col gap-1">
            {waypoints.map((w, i) => (
              <li
                key={w.id}
                className="flex items-center gap-2 rounded-[10px] bg-[color:var(--surf-0)] px-2 py-1.5"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--surf-2)] text-[11px] font-bold text-[color:var(--ink-dim)]">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[color:var(--ink)]">
                  {w.label}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveWaypoint(w.id, -1)}
                    disabled={i === 0}
                    aria-label="Move stop up"
                    className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--ink-dim)] hover:bg-[color:var(--surf-2)] disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveWaypoint(w.id, 1)}
                    disabled={i === waypoints.length - 1}
                    aria-label="Move stop down"
                    className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--ink-dim)] hover:bg-[color:var(--surf-2)] disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeWaypoint(w.id)}
                    aria-label="Remove stop"
                    className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--ink-dim)] hover:bg-[color:var(--surf-2)] hover:text-[color:var(--danger)]"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={addGps}
              className="hud-btn-ghost !h-10 !w-auto shrink-0 px-3 text-[12px] font-semibold"
            >
              GPS
            </button>
            <PlacePicker
              placeholder="Add stop or address"
              kind="address"
              onPick={addPlace}
              getNearby={() => {
                const m = mapRef.current;
                if (!m) return undefined;
                const c = m.getCenter();
                return [c.lng, c.lat];
              }}
            />
          </div>
        </div>
      </HudPanel>

      {routes.length > 0 && (
        <HudPanel>
          <div className="ui-section">
            <span className="ui-kicker">Routes · {routes.length}</span>
            {routes.map((r, i) => (
              <RouteCard
                key={r.id}
                route={r}
                index={i}
                active={r.id === selectedId}
                onSelect={() => selectRoute(r.id)}
              />
            ))}
            {selected && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => startNavigation(selected)}
                  className="hud-btn-primary"
                >
                  Navigate
                </button>
                <button
                  type="button"
                  onClick={() => startNavigation(selected, { simulate: true })}
                  className="hud-btn-ghost !w-auto justify-center px-3 text-[12px] font-medium"
                >
                  Preview
                </button>
              </div>
            )}
          </div>
        </HudPanel>
      )}

      {phase.kind === "error" && (
        <p className="px-1 text-[12px] text-[color:var(--danger)]">
          {phase.message}
        </p>
      )}
      {notice && phase.kind !== "error" && (
        <p className="px-1 text-[12px] text-[color:var(--warn)]">{notice}</p>
      )}

      <HudPanel>
        <div className="ui-section">
          <span className="ui-kicker">Profile</span>
          <div className="ui-segmented">
            {CAR_PROFILES.map((p) => (
              <button
                key={p.id}
                type="button"
                className="ui-seg"
                data-active={profile === p.id}
                aria-pressed={profile === p.id}
                onClick={() => setProfile(p.id as CarProfile)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </HudPanel>
    </div>
  );
}

function RouteCard({
  route,
  index,
  active,
  onSelect,
}: {
  route: RoutePlan;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active}
      className={[
        "flex w-full flex-col gap-2 rounded-[12px] border p-3 text-left transition-colors",
        active
          ? "border-[color:var(--accent)] bg-[color:var(--accent-soft)]"
          : "border-[color:var(--hairline)] bg-[color:var(--surf-0)] hover:bg-[color:var(--surf-2)]",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-[color:var(--ink)]">
          {index === 0 ? "Recommended" : `Alternative ${index}`}
        </span>
        <span className="hud-mono text-[12px] text-[color:var(--ink-dim)]">
          {formatDistance(route.distanceKm)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold text-[color:var(--ink)]">
          {formatDuration(route.durationMin)}
        </span>
        <div className="flex flex-wrap gap-1">
          {route.hasHighway && <span className="ui-badge">Motorway</span>}
          {route.hasToll && <span className="ui-badge" data-tone="warn">Toll</span>}
          {route.hasFerry && <span className="ui-badge" data-tone="info">Ferry</span>}
        </div>
      </div>
    </button>
  );
}
