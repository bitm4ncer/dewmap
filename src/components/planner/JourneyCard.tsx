"use client";

import { formatDuration } from "@/lib/routing";
import type { RoutePlan } from "@/lib/routing";
import {
  allowsBikes,
  isAccessibleJourney,
  isLiveJourney,
  journeyDelayMinutes,
  journeyTimeZone,
  legDurationMin,
  lineColor,
  stopClock,
  stopDayOffset,
  lineLabel,
  lineTextColor,
  modeLabel,
  needsReservation,
  walkTotals,
} from "@/lib/planner/transitFormat";

interface Props {
  journey: RoutePlan;
  best: boolean;
  active: boolean;
  onSelect: () => void;
}

export function JourneyCard({ journey, best, active, onSelect }: Props) {
  const transit = journey.transit;
  if (!transit) return null;
  const legs = transit.legs.filter(
    (leg) => leg.mode !== "walk" || (leg.distanceKm ?? 0) > 0.05,
  );
  const delay = journeyDelayMinutes(journey);
  const cancelled = transit.legs.some((leg) => leg.cancelled);
  const live = isLiveJourney(journey);
  const walk = walkTotals(journey);
  const accessible = isAccessibleJourney(journey);
  const bikes = allowsBikes(journey);
  const reservation = needsReservation(journey);
  const firstLeg = transit.legs[0];
  const lastLeg = transit.legs[transit.legs.length - 1];
  const zone = journeyTimeZone(journey);
  const arrivalOffset = lastLeg
    ? stopDayOffset(transit.arrival, transit.departure, lastLeg.to, zone)
    : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      data-active={active}
      aria-pressed={active}
      className={[
        "flex w-full flex-col gap-2 rounded-[12px] p-3 text-left transition-colors",
        active
          ? "bg-[color:var(--accent-soft)]"
          : "bg-[color:var(--surf-0)] hover:bg-[color:var(--surf-2)]",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="hud-mono text-[15px] font-semibold text-[color:var(--ink)]">
          {firstLeg
            ? stopClock(transit.departure, firstLeg.from, zone)
            : "—"}{" "}
          – {lastLeg ? stopClock(transit.arrival, lastLeg.to, zone) : "—"}
          {arrivalOffset && (
            <span className="ml-1 text-[10px] font-medium text-[color:var(--ink-mute)]">
              {arrivalOffset}
            </span>
          )}
        </span>
        <span className="text-[12px] text-[color:var(--ink-dim)]">
          {formatDuration(transit.durationMin)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {legs.map((leg, i) =>
            leg.mode === "walk" ? (
              <span key={i} className="text-[11px] text-[color:var(--ink-mute)]">
                walk {formatDuration(legDurationMin(leg))}
              </span>
            ) : (
              <span
                key={i}
                className="ui-badge"
                title={`${modeLabel(leg)}${leg.agency ? ` · ${leg.agency}` : ""}`}
                style={{
                  color: lineTextColor(leg),
                  background: lineColor(leg),
                  borderColor: "transparent",
                }}
              >
                {lineLabel(leg)}
              </span>
            ),
          )}
        </div>
        <span className="shrink-0 text-[11.5px] text-[color:var(--ink-dim)]">
          {transit.transfers === 0
            ? "direct"
            : `${transit.transfers} change${transit.transfers === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {best && <span className="ui-badge" data-tone="accent">Best</span>}
        {delay > 0 && (
          <span className="ui-badge" data-tone="warn">+{delay} min</span>
        )}
        {cancelled && (
          <span className="ui-badge" data-tone="danger">Cancelled</span>
        )}
        {live && <span className="ui-badge" data-tone="info">Live</span>}
        {accessible && <span className="ui-badge">Step-free</span>}
        {bikes && <span className="ui-badge">Bike</span>}
        {reservation && <span className="ui-badge" data-tone="warn">Reservation</span>}
        {walk.minutes > 0 && (
          <span className="text-[10.5px] text-[color:var(--ink-mute)]">
            {formatDuration(walk.minutes)} walk
          </span>
        )}
      </div>
    </button>
  );
}
