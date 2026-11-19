"use client";

import { Fragment } from "react";
import { formatClock, formatDayOffset, formatDistance, formatDuration } from "@/lib/routing";
import { WalkIcon } from "@/components/ui/icons";
import type { RoutePlan, TransitStopRef } from "@/lib/routing";
import {
  allowsBikes,
  isAccessibleJourney,
  delayIntensity,
  isLiveJourney,
  journeyDelayMinutes,
  legDelayMinutes,
  legDirection,
  legDurationMin,
  lineColor,
  lineLabel,
  lineTextColor,
  journeyTimeZone,
  modeLabel,
  needsReservation,
  stopLabel,
  transferMinutes,
  transferSeverity,
  transferWarnings,
  walkTotals,
} from "@/lib/planner/transitFormat";

interface Props {
  journey: RoutePlan;
  onStart: () => void;
  onPreview: () => void;
  onShare: () => void;
  onCalendar: () => void;
  startDisabled?: boolean;
  startHint?: string;
}

function platformLabel(stop: TransitStopRef): string | null {
  if (!stop.platform) return null;
  const changed =
    stop.scheduledPlatform && stop.scheduledPlatform !== stop.platform;
  return `Platform ${stop.platform}${changed ? ` (was ${stop.scheduledPlatform})` : ""}`;
}

export function JourneyDetail({
  journey,
  onStart,
  onPreview,
  onShare,
  onCalendar,
  startDisabled = false,
  startHint,
}: Props) {
  const transit = journey.transit;
  if (!transit) return null;
  const delay = journeyDelayMinutes(journey);
  const cancelled = transit.legs.some((leg) => leg.cancelled);
  const live = isLiveJourney(journey);
  const walk = walkTotals(journey);
  const warnings = transferWarnings(transit.legs);
  const firstLeg = transit.legs[0];
  const lastLeg = transit.legs[transit.legs.length - 1];
  const zone = journeyTimeZone(journey);
  const arrivalOffset = lastLeg
    ? formatDayOffset(transit.arrival, transit.departure, undefined, lastLeg.to.tz ?? zone)
    : null;

  return (
    <div className="ui-section">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="ui-kicker">Journey detail</span>
        <span className="hud-mono text-[13px] font-semibold text-[color:var(--ink)]">
          {firstLeg
            ? formatClock(transit.departure, undefined, firstLeg.from.tz ?? zone)
            : "—"}{" "}
          – {lastLeg ? formatClock(transit.arrival, undefined, lastLeg.to.tz ?? zone) : "—"}
          {arrivalOffset && (
            <span className="ml-1 text-[10px] font-medium text-[color:var(--ink-mute)]">
              {arrivalOffset}
            </span>
          )}
          {" · "}
          <span className="font-normal text-[color:var(--ink-dim)]">
            {formatDuration(transit.durationMin)}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {delay > 0 && (
          <span
            className="ui-badge"
            data-tone="delay"
            style={{ ["--delay" as string]: delayIntensity(delay) }}
            title="Delay grows from amber to red with every minute"
          >
            +{delay} min
          </span>
        )}
        {cancelled && <span className="ui-badge" data-tone="danger">Cancelled</span>}
        {live && <span className="ui-badge" data-tone="info">Live</span>}
        {isAccessibleJourney(journey) && <span className="ui-badge">Step-free</span>}
        {allowsBikes(journey) && <span className="ui-badge">Bike</span>}
        {needsReservation(journey) && (
          <span
            className="ui-badge"
            title="Seat reservation required — book before boarding"
          >
            Reservation required
          </span>
        )}
        {walk.minutes > 0 && (
          <span className="ui-badge">
            {formatDuration(walk.minutes)} walk · {formatDistance(walk.distanceKm)}
          </span>
        )}
      </div>

      {needsReservation(journey) && (
        <p className="text-[10.5px] leading-relaxed text-[color:var(--ink-mute)]">
          Reservation required: book a seat before boarding.
        </p>
      )}

      <div className="flex flex-wrap gap-2 py-1">
        <button
          type="button"
          onClick={onStart}
          disabled={startDisabled}
          title={startHint}
          className="hud-btn-primary"
        >
          {startDisabled ? "Cannot start" : "Start journey"}
        </button>
        <button
          type="button"
          onClick={onPreview}
          className="hud-btn-ghost !w-auto justify-center px-3 text-[12px] font-medium"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={onShare}
          className="hud-btn-ghost !w-auto justify-center px-3 text-[12px] font-medium"
        >
          Share
        </button>
        <button
          type="button"
          onClick={onCalendar}
          className="hud-btn-ghost !w-auto justify-center px-3 text-[12px] font-medium"
        >
          Calendar
        </button>
      </div>
      {startDisabled && startHint && (
        <p className="text-[11.5px] text-[color:var(--warn)]">{startHint}</p>
      )}

      <div className="flex flex-col">
        {transit.legs.map((leg, i) => {
          const departureDelay = legDelayMinutes(leg);
          const arrivalDelay = legDelayMinutes(leg, "arrival");
          const arrivalDay = formatDayOffset(
            leg.arrival,
            leg.departure,
            undefined,
            leg.to.tz ?? zone,
          );
          const direction = legDirection(leg);
          const showDirection =
            leg.mode === "transit"
            && direction !== stopLabel(leg.to)
            && Boolean(leg.headsign);
          const platform = platformLabel(leg.from);
          const toPlatform = platformLabel(leg.to);
          return (
            <Fragment key={i}>
            <div className="flex gap-3 py-2">
              <div className="flex w-14 shrink-0 flex-col items-end">
                <span className="hud-mono text-[12px] text-[color:var(--ink)]">
                  {formatClock(leg.departure, undefined, leg.from.tz ?? zone)}
                </span>
                <span className="hud-mono text-[10.5px] text-[color:var(--ink-mute)]">
                  {formatClock(leg.arrival, undefined, leg.to.tz ?? zone)}
                  {arrivalDay && (
                    <span className="ml-1 text-[9px]">{arrivalDay}</span>
                  )}
                </span>
              </div>
              <div className="relative flex w-4 shrink-0 justify-center">
                <span
                  className="mt-2 h-2.5 w-2.5 rounded-full"
                  style={{
                    background:
                      leg.mode === "walk" ? "var(--ink-mute)" : lineColor(leg),
                  }}
                />
                {i < transit.legs.length - 1 && (
                  <span className="absolute top-5 h-[calc(100%-8px)] w-px bg-[color:var(--surf-3)]" />
                )}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  {leg.mode === "walk" ? (
                    <span className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-[color:var(--ink)]">
                      <WalkIcon size={16} />
                      {formatDuration(legDurationMin(leg))}
                      {leg.distanceKm
                        ? ` · ${formatDistance(leg.distanceKm)}`
                        : ""}
                    </span>
                  ) : (
                    <>
                      <span
                        className="ui-badge"
                        style={{
                          color: lineTextColor(leg),
                          background: lineColor(leg),
                          borderColor: "transparent",
                        }}
                      >
                        {lineLabel(leg)}
                      </span>
                      <span className="text-[11px] text-[color:var(--ink-mute)]">
                        {modeLabel(leg)} · {formatDuration(legDurationMin(leg))}
                      </span>
                    </>
                  )}
                  {leg.agency && (
                    <span className="truncate text-[11px] text-[color:var(--ink-mute)]">
                      {leg.agency}
                    </span>
                  )}
                  {departureDelay !== 0 && (
                    <span
                      className="ui-badge"
                      data-tone={departureDelay > 0 ? "delay" : "info"}
                      style={
                        departureDelay > 0
                          ? { ["--delay" as string]: delayIntensity(departureDelay) }
                          : undefined
                      }
                    >
                      {departureDelay > 0 ? "+" : ""}
                      {departureDelay} min
                    </span>
                  )}
                  {arrivalDelay !== 0 && arrivalDelay !== departureDelay && (
                    <span
                      className="ui-badge"
                      data-tone={arrivalDelay > 0 ? "delay" : "info"}
                      style={
                        arrivalDelay > 0
                          ? { ["--delay" as string]: delayIntensity(arrivalDelay) }
                          : undefined
                      }
                    >
                      arr {arrivalDelay > 0 ? "+" : ""}
                      {arrivalDelay} min
                    </span>
                  )}
                  {leg.cancelled && (
                    <span className="ui-badge" data-tone="danger">Cancelled</span>
                  )}
                  {leg.reservation && (
                    <span
                      className="ui-badge"
                      title="Seat reservation required — book before boarding"
                    >
                      Reservation
                    </span>
                  )}
                  {leg.bikesAllowed === false && (
                    <span className="ui-badge">No bike</span>
                  )}
                  {leg.wheelchairAccessible === "YES" && (
                    <span className="ui-badge">Step-free</span>
                  )}
                </div>

                <div className="truncate text-[11.5px] text-[color:var(--ink-dim)]">
                  {stopLabel(leg.from)}
                  {leg.from.city ? `, ${leg.from.city}` : ""}
                  {platform ? ` · ${platform}` : ""}
                </div>
                {leg.mode !== "walk" && (
                  <div className="truncate text-[11.5px] text-[color:var(--ink-dim)]">
                    → {stopLabel(leg.to)}
                    {leg.to.city ? `, ${leg.to.city}` : ""}
                    {toPlatform ? ` · ${toPlatform}` : ""}
                  </div>
                )}
                {showDirection && (
                  <div className="truncate text-[10.5px] text-[color:var(--ink-mute)]">
                    Direction {leg.headsign}
                  </div>
                )}
                {leg.intermediateStops && leg.intermediateStops.length > 0 && (
                  <details className="mt-1 text-[11px] text-[color:var(--ink-dim)]">
                    <summary className="cursor-pointer text-[color:var(--ink-mute)]">
                      {leg.intermediateStops.length} intermediate stop
                      {leg.intermediateStops.length === 1 ? "" : "s"}
                    </summary>
                    <ul className="mt-1 flex flex-col gap-1 pl-2">
                      {leg.intermediateStops.map((stop, stopIndex) => (
                        <li key={`${stop.stopId ?? stop.name}-${stopIndex}`} className="truncate">
                          {stop.departure ?? stop.arrival ? (
                            <span className="hud-mono mr-1 text-[10px] text-[color:var(--ink-mute)]">
                              {formatClock(
                                stop.departure ?? stop.arrival ?? "",
                                undefined,
                                stop.tz ?? zone,
                              )}
                            </span>
                          ) : null}
                          {stopLabel(stop)}
                          {stop.platform ? ` · ${stop.platform}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </div>
            {i < transit.legs.length - 1 && (() => {
              const next = transit.legs[i + 1];
              // A transfer only exists between two ride legs. The gap
              // after a walk (e.g. the approach to the first stop) is
              // not a transfer — showing "Transfer · 0 min" there was
              // pure noise.
              if (leg.mode !== "transit" || next.mode !== "transit") return null;
              const gap = transferMinutes(leg, next);
              if (gap == null) return null;
              const severity = transferSeverity(gap);
              return (
                <div className="transfer-row flex gap-3 py-1" data-tone={severity}>
                  <div className="w-14 shrink-0" />
                  <div className="flex w-4 shrink-0 justify-center">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-current" />
                  </div>
                  <div className="min-w-0 flex-1 text-[11px]">
                    Transfer · {gap} min
                    {severity !== "none" && (
                      <span
                        className="ui-badge ml-1"
                        data-tone={severity === "critical" ? "danger" : "warn"}
                      >
                        {severity === "critical" ? "very tight" : "tight"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })()}
            </Fragment>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[10px] bg-[color:var(--surf-2)] p-2">
          <span className="ui-kicker">Transfers</span>
          {warnings.map((warning, i) => {
            const severity = transferSeverity(warning.minutes);
            return (
              <div
                key={`${warning.at}-${i}`}
                className="transfer-warning text-[11.5px]"
                data-tone={severity}
              >
                <span className="font-semibold text-[color:var(--ink)]">
                  {warning.at}
                </span>
                <span>
                  {" · "}
                  {warning.missed
                    ? "connection may be missed"
                    : `${Math.max(0, Math.round(warning.minutes))} min`}
                  {warning.platformChange
                    ? ` · platform ${warning.fromPlatform} → ${warning.toPlatform}`
                    : ""}
                </span>
                {severity !== "none" && (
                  <span
                    className="ui-badge ml-1"
                    data-tone={severity === "critical" ? "danger" : "warn"}
                  >
                    {warning.missed
                      ? "missed"
                      : severity === "critical"
                        ? "very tight"
                        : "tight"}
                  </span>
                )}
              </div>
            );
          })}
          <p className="text-[10px] leading-relaxed text-[color:var(--ink-mute)]">
            Transfer colours: amber under 5 min, red under 2 min or missed.
          </p>
        </div>
      )}

      <p className="text-[10.5px] text-[color:var(--ink-mute)]">
        Times are shown in each stop&apos;s local time zone.
      </p>
    </div>
  );
}
