"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LIVE_MIN_ZOOM, filterLiveVehicles, type LiveModeGroup } from "@/lib/routing";
import {
  alertSeverityLabel,
  alertSeverityTone,
  delayIntensity,
  formatAlertPeriod,
} from "@/lib/planner/transitFormat";
import { useTransit } from "@/lib/planner/transitStore";
import { liveDataSaverNotice } from "@/lib/planner/liveDataPolicy";
import { HudPanel } from "@/components/hud/HudPanel";

const GROUP_FILTERS: { key: LiveModeGroup; label: string }[] = [
  { key: "RAIL", label: "Rail" },
  { key: "BUS", label: "Bus" },
  { key: "TRAM", label: "Tram" },
  { key: "SUBWAY", label: "Metro" },
  { key: "FERRY", label: "Ferry" },
];

function updatedClock(value: number | null): string {
  if (!value) return "--:--";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lineBadgeStyle(color: string, textColor: string) {
  return {
    color: textColor,
    background: color,
    borderColor: "transparent",
  } as const;
}

/**
 * Always-visible live-transit strip.
 *
 * It sits directly under the transit header, outside the collapsible form and
 * outside "Route options", so the switch and the current state never need a
 * second click. It also hosts the mode filter, the disruption list and a
 * compact delay board for the vehicles currently in view.
 */
export function LiveTransitBar() {
  const liveVehicles = useTransit((s) => s.liveVehicles);
  const liveDataSaver = useTransit((s) => s.liveDataSaver);
  const setLiveVehicles = useTransit((s) => s.setLiveVehicles);
  const groups = useTransit((s) => s.liveVehicleGroups);
  const setGroups = useTransit((s) => s.setLiveVehicleGroups);
  const count = useTransit((s) => s.liveVehicleCount);
  const updatedAt = useTransit((s) => s.liveVehiclesUpdatedAt);
  const error = useTransit((s) => s.liveVehiclesError);
  const zoomLow = useTransit((s) => s.liveVehiclesZoomLow);
  const vehicles = useTransit((s) => s.liveVehicleData);
  const alerts = useTransit((s) => s.liveAlerts);
  const alertsUpdatedAt = useTransit((s) => s.liveAlertsUpdatedAt);
  const alertsError = useTransit((s) => s.liveAlertsError);

  const [alertsOpen, setAlertsOpen] = useState(false);
  const [vehiclesOpen, setVehiclesOpen] = useState(false);
  const [filterNotice, setFilterNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const shown = useMemo(
    () => filterLiveVehicles(vehicles, groups),
    [vehicles, groups],
  );
  const ferries = shown.filter((vehicle) => vehicle.modeGroup === "FERRY").length;
  const filtered = shown.length !== count && count > 0;
  const delayed = useMemo(
    () =>
      [...shown]
        .filter((vehicle) => vehicle.delayMin > 0 || vehicle.phase === "dwell")
        .sort(
          (a, b) =>
            b.delayMin - a.delayMin
            || a.line.localeCompare(b.line, undefined, { numeric: true }),
        )
        .slice(0, 14),
    [shown],
  );

  // N3: one concise live region for state changes only. The time/count text
  // below updates every poll and stays out of aria-live.
  const dataSaverNotice = liveDataSaverNotice(liveDataSaver, liveVehicles);
  const announcement = !liveVehicles
    ? liveDataSaver
      ? "Data Saver is on. Live vehicles are off."
      : "Live vehicles off."
    : error
      ? `Live vehicles error. ${error}`
      : zoomLow
        ? `Zoom in to level ${LIVE_MIN_ZOOM} to load live vehicles.`
        : count === 0
          ? "No live vehicles in this view."
          : "Live vehicles visible in this view.";

  const status = !liveVehicles
    ? "Off. Vehicles will not load."
    : error
      ? error
      : zoomLow
        ? `Zoom in to level ${LIVE_MIN_ZOOM} to load vehicles.`
        : count === 0
          ? "No vehicles in this view. Pan or zoom in."
          : `${shown.length}${filtered ? ` of ${count}` : ""} in this view · updated ${updatedClock(updatedAt)}${
              ferries > 0 ? ` · ${ferries} ${ferries === 1 ? "ferry" : "ferries"}` : ""
            }`;

  const toggleGroup = (group: { key: LiveModeGroup; label: string }) => {
    // F9: keep every chip focusable. An unavailable mode explains itself
    // instead of silently disabling the button.
    const available = vehicles.some(
      (vehicle) => vehicle.modeGroup === group.key,
    );
    if (!available && !groups.includes(group.key)) {
      setFilterNotice(`No ${group.label.toLowerCase()} vehicles in this view.`);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setFilterNotice(null), 4000);
      return;
    }
    setFilterNotice(null);
    setGroups(
      groups.includes(group.key)
        ? groups.filter((entry) => entry !== group.key)
        : [...groups, group.key],
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <HudPanel>
        <button
          type="button"
          role="switch"
          aria-checked={liveVehicles}
          onClick={() => setLiveVehicles(!liveVehicles)}
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="ui-status-dot"
              data-tone={error ? "warn" : undefined}
              aria-hidden
            />
            <span className="min-w-0">
              <span className="ui-row-title">Live vehicles</span>
              <span className="ui-row-sub block">
                Real-time positions from the current map view.
              </span>
            </span>
          </span>
          <span className="hud-switch shrink-0" data-on={liveVehicles} aria-hidden>
            <span className="hud-switch-thumb" />
          </span>
        </button>

        {/* Not a live region: the time changes every poll. State changes are
            announced by the switch, the chips and one-shot notices instead. */}
        <p className="mt-1 text-[11px] leading-relaxed text-[color:var(--ink-dim)]">
          {status}
        </p>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        {dataSaverNotice && (
          <div className="mt-1 flex items-center justify-between gap-2 rounded-[10px] bg-[color:var(--surf-2)] p-2">
            <span className="text-[11px] text-[color:var(--ink-dim)]">
              {dataSaverNotice}
            </span>
            {!liveVehicles && (
              <button
                type="button"
                className="ui-badge !min-h-9 !px-2 shrink-0"
                data-tone="accent"
                onClick={() => setLiveVehicles(true)}
              >
                Turn on
              </button>
            )}
          </div>
        )}

        {filterNotice && (
          <p className="mt-1 text-[11px] text-[color:var(--warn)]" role="status">
            {filterNotice}
          </p>
        )}

        {liveVehicles && count > 0 && shown.length === 0 && groups.length > 0 && (
          <div className="mt-1 flex items-center justify-between gap-2 rounded-[10px] bg-[color:var(--surf-2)] p-2">
            <span className="text-[11px] text-[color:var(--ink-dim)]">
              The filter hides all {count} vehicles in this view.
            </span>
            <button
              type="button"
              className="ui-badge !min-h-9 !px-2 shrink-0"
              data-tone="accent"
              onClick={() => setGroups([])}
            >
              Show all
            </button>
          </div>
        )}

        {liveVehicles && (
          <div
            className="mt-2 flex flex-wrap gap-1"
            role="group"
            aria-label="Filter live vehicles by mode"
          >
            <button
              type="button"
              className="ui-badge !min-h-9 !px-2"
              data-tone={groups.length === 0 ? "accent" : undefined}
              aria-pressed={groups.length === 0}
              onClick={() => setGroups([])}
            >
              All
            </button>
            {GROUP_FILTERS.map((group) => {
              const active = groups.includes(group.key);
              return (
                <button
                  key={group.key}
                  type="button"
                  className="ui-badge !min-h-9 !px-2"
                  data-tone={active ? "accent" : undefined}
                  aria-pressed={active}
                  onClick={() => toggleGroup(group)}
                >
                  {group.label}
                </button>
              );
            })}
          </div>
        )}

        {liveVehicles && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="ui-badge !min-h-10 !px-3"
              data-tone={alerts.length > 0 ? "warn" : undefined}
              aria-expanded={alertsOpen}
              onClick={() => setAlertsOpen((open) => !open)}
            >
              {alerts.length > 0
                ? `${alerts.length} disruption${alerts.length === 1 ? "" : "s"}`
                : "Disruptions"}
            </button>
            {vehicles.length > 0 && (
              <button
                type="button"
                className="ui-badge !min-h-10 !px-3"
                aria-expanded={vehiclesOpen}
                onClick={() => setVehiclesOpen((open) => !open)}
              >
                {vehiclesOpen ? "Hide vehicles" : "Vehicles in view"}
              </button>
            )}
            {alertsUpdatedAt && alerts.length > 0 && (
              <span className="text-[10.5px] text-[color:var(--ink-mute)]">
                checked {updatedClock(alertsUpdatedAt)}
              </span>
            )}
          </div>
        )}

        {liveVehicles && alertsOpen && (
          <div className="mt-2 flex flex-col gap-2">
            {alertsError && (
              <p className="text-[11.5px] text-[color:var(--warn)]">{alertsError}</p>
            )}
            {!alertsError && alerts.length === 0 && (
              <p className="text-[11.5px] text-[color:var(--ink-mute)]">
                No active disruptions reported at the sampled stops. Alerts are
                sampled from rail-first stops that currently have vehicles.
              </p>
            )}
            {alerts.map((alert) => {
              const tone = alertSeverityTone(alert.severity);
              const severity = alertSeverityLabel(alert.severity);
              return (
                <div
                  key={alert.id}
                  className="flex flex-col gap-1 rounded-[10px] bg-[color:var(--surf-2)] p-2"
                >
                  <div className="flex flex-wrap items-center gap-1">
                    {severity && (
                      <span className="ui-badge" data-tone={tone}>
                        {severity}
                      </span>
                    )}
                    {alert.lines.map((line) => (
                      <span key={line} className="ui-badge">
                        {line}
                      </span>
                    ))}
                    <span className="text-[10.5px] text-[color:var(--ink-mute)]">
                      {formatAlertPeriod(alert)}
                    </span>
                  </div>
                  <span className="text-[11.5px] font-semibold text-[color:var(--ink)]">
                    {alert.header}
                  </span>
                  {alert.description && (
                    <details className="text-[11px] text-[color:var(--ink-dim)]">
                      <summary className="cursor-pointer text-[color:var(--ink-mute)]">
                        Details
                      </summary>
                      <p className="mt-1 whitespace-pre-line">{alert.description}</p>
                    </details>
                  )}
                  {alert.stops.length > 0 && (
                    <span className="text-[10.5px] text-[color:var(--ink-mute)]">
                      {alert.stops
                        .slice(0, 4)
                        .map((stop) => stop.name)
                        .join(" · ")}
                      {alert.stops.length > 4 ? ` +${alert.stops.length - 4}` : ""}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {liveVehicles && vehiclesOpen && (
          <div className="mt-2 flex flex-col gap-1">
            {delayed.length === 0 ? (
              <p className="text-[11.5px] text-[color:var(--ink-mute)]">
                All vehicles in view are on time.
              </p>
            ) : (
              <>
                <p className="text-[10.5px] text-[color:var(--ink-mute)]">
                  Delayed or dwelling, worst first. Positions are interpolated
                  unless marked GPS.
                </p>
                {delayed.map((vehicle) => (
                  <div
                    key={vehicle.id}
                    className="flex items-center gap-2 text-[11.5px]"
                  >
                    <span
                      className="ui-badge shrink-0"
                      style={lineBadgeStyle(vehicle.color, vehicle.textColor)}
                    >
                      {vehicle.line}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[color:var(--ink-dim)]">
                      {vehicle.toName}
                    </span>
                    {vehicle.phase === "dwell" && (
                      <span className="shrink-0 text-[10.5px] text-[color:var(--ink-mute)]">
                        at stop
                      </span>
                    )}
                    {vehicle.delayMin > 0 && (
                      <span
                        className="ui-badge shrink-0"
                        data-tone="delay"
                        style={{ ["--delay" as string]: delayIntensity(vehicle.delayMin) }}
                        title={`${vehicle.delayMin} minutes late`}
                      >
                        +{vehicle.delayMin} min
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </HudPanel>
    </div>
  );
}
