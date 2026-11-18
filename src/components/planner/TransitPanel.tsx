"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { HudPanel } from "@/components/hud/HudPanel";
import {
  useTransit,
  defaultWhen,
  type TransitPlace,
} from "@/lib/planner/transitStore";
import { PlacePicker, type PickedPlace } from "./PlacePicker";
import { useNavigation } from "@/lib/navigation/store";
import { SwapIcon } from "@/components/ui/icons";
import {
  planRoutes,
  formatDuration,
  formatClock,
  isAbortError,
  type RoutePlan,
  type TransitLeg,
} from "@/lib/routing";

interface Props {
  mapRef: React.MutableRefObject<MLMap | null>;
}

export function TransitPanel({ mapRef }: Props) {
  const from = useTransit((s) => s.from);
  const to = useTransit((s) => s.to);
  const when = useTransit((s) => s.when);
  const arriveBy = useTransit((s) => s.arriveBy);
  const maxTransfers = useTransit((s) => s.maxTransfers);
  const wheelchair = useTransit((s) => s.wheelchair);
  const cityFilter = useTransit((s) => s.cityFilter);
  const journeys = useTransit((s) => s.journeys);
  const selectedId = useTransit((s) => s.selectedId);
  const phase = useTransit((s) => s.phase);
  const notice = useTransit((s) => s.notice);
  const setFrom = useTransit((s) => s.setFrom);
  const setTo = useTransit((s) => s.setTo);
  const swap = useTransit((s) => s.swap);
  const setWhen = useTransit((s) => s.setWhen);
  const setArriveBy = useTransit((s) => s.setArriveBy);
  const setMaxTransfers = useTransit((s) => s.setMaxTransfers);
  const setWheelchair = useTransit((s) => s.setWheelchair);
  const setCityFilter = useTransit((s) => s.setCityFilter);
  const setJourneys = useTransit((s) => s.setJourneys);
  const selectJourney = useTransit((s) => s.selectJourney);
  const setPhase = useTransit((s) => s.setPhase);
  const setNotice = useTransit((s) => s.setNotice);

  const abortRef = useRef<AbortController | null>(null);
  const lastFitRef = useRef<string | null>(null);
  const selected = useMemo(
    () => journeys.find((j) => j.id === selectedId) ?? null,
    [journeys, selectedId],
  );

  const toPlace = (p: PickedPlace): TransitPlace => ({
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    id: p.id,
    city: p.city,
    kind: p.kind,
    station: p.station,
  });

  const search = useCallback(async () => {
    if (!from || !to) {
      setNotice("Choose a start and destination stop first.");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase({ kind: "routing" });
    setNotice(null);
    try {
      const plans = await planRoutes({
        mode: "transit",
        waypoints: [
          { lat: from.lat, lon: from.lon },
          { lat: to.lat, lon: to.lon },
        ],
        departAt: new Date(when || defaultWhen()).toISOString(),
        arriveBy,
        maxTransfers,
        wheelchair,
        alternatives: 4,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      setJourneys(plans);
      if (plans.length === 0) setNotice("No connections found for this time.");
    } catch (err) {
      if (isAbortError(err) || ctrl.signal.aborted) return;
      setPhase({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [
    from,
    to,
    when,
    arriveBy,
    maxTransfers,
    wheelchair,
    setJourneys,
    setPhase,
    setNotice,
  ]);

  const journey = selected ?? journeys[0] ?? null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !journey || lastFitRef.current === journey.id) return;
    if (map.isMoving()) return;
    let south = Infinity;
    let west = Infinity;
    let north = -Infinity;
    let east = -Infinity;
    for (const [lon, lat] of journey.coordinates) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    if (!Number.isFinite(south)) return;
    lastFitRef.current = journey.id;
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: { top: 90, bottom: typeof window !== "undefined" && window.innerWidth < 768 ? 280 : 80, left: 48, right: 48 }, duration: 650, maxZoom: 14 },
    );
  }, [journey, mapRef]);

  return (
    <div className="flex flex-col gap-3">
      <HudPanel>
        <div className="ui-section">
          <span className="ui-kicker">Train &amp; local transit</span>
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <PlacePicker
                placeholder="From station or address"
                kind="transit"
                cityFilter={cityFilter}
                selectedLabel={
                  from ? `${from.name}${from.city ? ` · ${from.city}` : ""}` : undefined
                }
                onPick={(p) => setFrom(toPlace(p))}
                getNearby={() => {
                  const m = mapRef.current;
                  if (!m) return undefined;
                  const c = m.getCenter();
                  return [c.lng, c.lat];
                }}
              />
              <PlacePicker
                placeholder="To station or address"
                kind="transit"
                cityFilter={cityFilter}
                selectedLabel={
                  to ? `${to.name}${to.city ? ` · ${to.city}` : ""}` : undefined
                }
                onPick={(p) => setTo(toPlace(p))}
                getNearby={() => {
                  const m = mapRef.current;
                  if (!m) return undefined;
                  const c = m.getCenter();
                  return [c.lng, c.lat];
                }}
              />
            </div>
            <button
              type="button"
              onClick={swap}
              aria-label="Swap origin and destination"
              className="hud-icon-btn w-11 shrink-0 self-center"
            >
              <SwapIcon size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="hud-label w-10 shrink-0">Stadt</span>
            <input
              type="text"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              placeholder="Stadt filtern (optional)"
              aria-label="Filter results by city"
              className="ui-input !min-h-10"
              spellCheck={false}
            />
          </div>

          {(from || to) && (
            <div className="flex flex-col gap-1.5 text-[11.5px]">
              {from && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="ui-badge" data-tone="accent">
                    A · {from.name}
                  </span>
                  {from.city && <span className="ui-badge">{from.city}</span>}
                  {from.kind === "address" && from.station && (
                    <span className="text-[color:var(--ink-dim)]">
                      Nearest station: {from.station.name}
                      {from.station.city ? `, ${from.station.city}` : ""}
                      {from.station.distanceM != null
                        ? ` (${from.station.distanceM} m)`
                        : ""}
                    </span>
                  )}
                  {from.kind === "address" && !from.station && (
                    <span className="text-[color:var(--warn)]">
                      No station found nearby; routing from the address.
                    </span>
                  )}
                </div>
              )}
              {to && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="ui-badge">B · {to.name}</span>
                  {to.city && <span className="ui-badge">{to.city}</span>}
                  {to.kind === "address" && to.station && (
                    <span className="text-[color:var(--ink-dim)]">
                      Nearest station: {to.station.name}
                      {to.station.city ? `, ${to.station.city}` : ""}
                      {to.station.distanceM != null
                        ? ` (${to.station.distanceM} m)`
                        : ""}
                    </span>
                  )}
                  {to.kind === "address" && !to.station && (
                    <span className="text-[color:var(--warn)]">
                      No station found nearby; routing to the address.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </HudPanel>

      <HudPanel>
        <div className="ui-section">
          <span className="ui-kicker">When</span>
          <div className="ui-segmented" role="group" aria-label="Depart or arrive">
            <button
              type="button"
              className="ui-seg"
              data-active={!arriveBy}
              aria-pressed={!arriveBy}
              onClick={() => setArriveBy(false)}
            >
              Depart at
            </button>
            <button
              type="button"
              className="ui-seg"
              data-active={arriveBy}
              aria-pressed={arriveBy}
              onClick={() => setArriveBy(true)}
            >
              Arrive by
            </button>
          </div>
          <input
            type="datetime-local"
            value={when || defaultWhen()}
            onChange={(e) => setWhen(e.target.value)}
            className="ui-input"
            aria-label="Travel date and time"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="ui-row-title">Max transfers</span>
            <div className="ui-segmented w-[180px]">
              {[0, 1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="ui-seg"
                  data-active={maxTransfers === n}
                  aria-pressed={maxTransfers === n}
                  onClick={() => setMaxTransfers(n)}
                >
                  {n === 3 ? "3+" : n}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={wheelchair}
            onClick={() => setWheelchair(!wheelchair)}
            className="flex min-h-10 items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="ui-row-title">Step-free / wheelchair</span>
              <span className="ui-row-sub block">
                Prefer accessible connections where data is available.
              </span>
            </span>
            <span className="hud-switch" data-on={wheelchair} aria-hidden>
              <span className="hud-switch-thumb" />
            </span>
          </button>
          <button
            type="button"
            onClick={search}
            disabled={phase.kind === "routing" || !from || !to}
            className="hud-btn-primary mt-1 w-full"
          >
            {phase.kind === "routing" ? "Searching…" : "Find connections"}
          </button>
        </div>
      </HudPanel>

      {journeys.length > 0 && (
        <HudPanel>
          <div className="ui-section">
            <div className="flex items-center justify-between">
              <span className="ui-kicker">Connections · {journeys.length}</span>
              <button
                type="button"
                onClick={search}
                disabled={phase.kind === "routing"}
                className="text-[11.5px] font-semibold text-[color:var(--ink-mute)] hover:text-[color:var(--ink)] disabled:opacity-40"
              >
                {phase.kind === "routing" ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            {journeys.map((j, i) => (
              <JourneyCard
                key={j.id}
                journey={j}
                index={i}
                active={j.id === selectedId}
                onSelect={() => selectJourney(j.id)}
              />
            ))}
          </div>
        </HudPanel>
      )}

      {journey && <JourneyDetail journey={journey} />}

      {phase.kind === "error" && (
        <p className="px-1 text-[12px] text-[color:var(--danger)]">
          {phase.message}
        </p>
      )}
      {notice && phase.kind !== "error" && (
        <p className="px-1 text-[12px] text-[color:var(--warn)]">{notice}</p>
      )}

      <p className="px-1 text-[10.5px] leading-relaxed text-[color:var(--ink-mute)]">
        Routing by Transitous (MOTIS) · schedules and real-time data from
        DELFI/GTFS.de, OpenStreetMap and local operators. Times may include
        live delays where the operator publishes them.
      </p>
    </div>
  );
}

function delayMinutes(leg: TransitLeg): number {
  const actual = new Date(leg.departure).getTime();
  const planned = new Date(leg.scheduledDeparture).getTime();
  if (!Number.isFinite(actual) || !Number.isFinite(planned)) return 0;
  return Math.round((actual - planned) / 60_000);
}

function JourneyCard({
  journey,
  index,
  active,
  onSelect,
}: {
  journey: RoutePlan;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const t = journey.transit;
  if (!t) return null;
  const legs = t.legs.filter((l) => l.mode !== "walk" || l.distanceKm! > 0.05);
  const delayed = t.legs.some((l) => delayMinutes(l) > 0);
  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active}
      className={[
        "flex w-full flex-col gap-2 rounded-[12px] p-3 text-left transition-colors",
        active
          ? "bg-[color:var(--accent-soft)]"
          : "bg-[color:var(--surf-0)] hover:bg-[color:var(--surf-2)]",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="hud-mono text-[15px] font-semibold text-[color:var(--ink)]">
          {formatClock(t.departure)} – {formatClock(t.arrival)}
        </span>
        <span className="text-[12px] text-[color:var(--ink-dim)]">
          {formatDuration(t.durationMin)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {legs.map((leg, i) =>
            leg.mode === "walk" ? (
              <span key={i} className="text-[11px] text-[color:var(--ink-mute)]">
                walk
              </span>
            ) : (
              <span
                key={i}
                className="ui-badge"
                style={
                  leg.line
                    ? { color: "var(--accent-ink)", background: "var(--accent)" }
                    : undefined
                }
              >
                {leg.line ?? leg.rawMode ?? "transit"}
              </span>
            ),
          )}
        </div>
        <span className="shrink-0 text-[11.5px] text-[color:var(--ink-dim)]">
          {t.transfers === 0 ? "direct" : `${t.transfers} change${t.transfers === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        {index === 0 && <span className="ui-badge">Best</span>}
        {delayed && <span className="ui-badge" data-tone="warn">Delayed</span>}
        {t.legs.some((l) => l.cancelled) && (
          <span className="ui-badge" data-tone="danger">Cancelled</span>
        )}
        {t.legs.some((l) => l.realTime) && (
          <span className="ui-badge" data-tone="info">Live</span>
        )}
      </div>
    </button>
  );
}

function JourneyDetail({ journey }: { journey: RoutePlan }) {
  const t = journey.transit;
  const startNavigation = useNavigation((s) => s.start);
  if (!t) return null;
  return (
    <HudPanel>
      <div className="ui-section">
        <span className="ui-kicker">Journey detail</span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => startNavigation(journey)}
            className="hud-btn-primary"
          >
            Start journey
          </button>
          <button
            type="button"
            onClick={() => startNavigation(journey, { simulate: true })}
            className="hud-btn-ghost !w-auto justify-center px-3 text-[12px] font-medium"
          >
            Preview
          </button>
        </div>
        <div className="flex flex-col">
          {t.legs.map((leg, i) => {
            const delay = delayMinutes(leg);
            return (
              <div key={i} className="flex gap-3 py-2">
                <div className="flex w-12 shrink-0 flex-col items-end">
                  <span className="hud-mono text-[12px] text-[color:var(--ink)]">
                    {formatClock(leg.departure)}
                  </span>
                  <span className="hud-mono text-[10.5px] text-[color:var(--ink-mute)]">
                    {formatClock(leg.arrival)}
                  </span>
                </div>
                <div className="relative flex w-4 shrink-0 justify-center">
                  <span
                    className="mt-2 h-2.5 w-2.5 rounded-full"
                    style={{
                      background:
                        leg.mode === "walk" ? "var(--ink-mute)" : "var(--accent)",
                    }}
                  />
                  {i < t.legs.length - 1 && (
                    <span className="absolute top-5 h-[calc(100%-8px)] w-px bg-[color:var(--surf-3)]" />
                  )}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold text-[color:var(--ink)]">
                      {leg.mode === "walk"
                        ? `Walk ${leg.distanceKm ? `${leg.distanceKm.toFixed(1)} km` : ""}`
                        : leg.line ?? leg.rawMode ?? "Transit"}
                    </span>
                    {leg.mode !== "walk" && leg.agency && (
                      <span className="truncate text-[11px] text-[color:var(--ink-mute)]">
                        {leg.agency}
                      </span>
                    )}
                    {delay > 0 && (
                      <span className="ui-badge" data-tone="warn">+{delay} min</span>
                    )}
                    {leg.cancelled && (
                      <span className="ui-badge" data-tone="danger">Cancelled</span>
                    )}
                  </div>
                  <div className="truncate text-[11.5px] text-[color:var(--ink-dim)]">
                    {leg.from.name}
                    {leg.from.city ? `, ${leg.from.city}` : ""}
                    {leg.from.platform ? ` · ${leg.from.platform}` : ""}
                  </div>
                  {leg.mode !== "walk" && (
                    <div className="truncate text-[11.5px] text-[color:var(--ink-dim)]">
                      to {leg.to.name}
                      {leg.to.city ? `, ${leg.to.city}` : ""}
                      {leg.to.platform ? ` · ${leg.to.platform}` : ""}
                      {leg.headsign ? ` · ${leg.headsign}` : ""}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </HudPanel>
  );
}
