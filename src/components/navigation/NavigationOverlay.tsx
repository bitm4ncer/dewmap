"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ManeuverIcon, RecenterIcon, SpeakerIcon, CloseIcon } from "@/components/ui/icons";
import { haptic } from "@/lib/haptics";
import { useNavigation } from "@/lib/navigation/store";
import type { RouteProgress } from "@/lib/navigation/progress";
import type { LivePosition } from "@/lib/navigation/useNavigation";
import {
  formatClock,
  formatDayOffset,
  formatDistance,
  formatDuration,
  isAbortError,
  planRoutes,
} from "@/lib/routing";
import {
  journeyTimeZone,
  legDelayMinutes,
  lineColor,
  lineLabel,
  lineTextColor,
  stopLabel,
  transferWarnings,
} from "@/lib/planner/transitFormat";

interface Props {
  progress: RouteProgress | null;
  position: LivePosition | null;
  error: string | null;
  offRoute: boolean;
  onRecenter: () => void;
}

export function NavigationOverlay({
  progress,
  position,
  error,
  offRoute,
  onRecenter,
}: Props) {
  const active = useNavigation((s) => s.active);
  const plan = useNavigation((s) => s.plan);
  const muted = useNavigation((s) => s.muted);
  const follow = useNavigation((s) => s.follow);
  const freeCamera = useNavigation((s) => s.freeCamera);
  const simulate = useNavigation((s) => s.simulate);
  const guidance = useNavigation((s) => s.guidance);
  const stop = useNavigation((s) => s.stop);
  const start = useNavigation((s) => s.start);
  const setMuted = useNavigation((s) => s.setMuted);
  const setFollow = useNavigation((s) => s.setFollow);
  const setFreeCamera = useNavigation((s) => s.setFreeCamera);
  const setGuidance = useNavigation((s) => s.setGuidance);

  /**
   * Ending guidance leaves the plan in the panel: the results, their line on
   * the map and the start/destination stay, so looking around after a trip
   * does not cost a new search. Only the guidance itself stops.
   */
  const endNavigation = () => {
    stop();
  };
  const [now, setNow] = useState(() => Date.now());
  const [recalculating, setRecalculating] = useState(false);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const recalcAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      recalcAbortRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [active]);

  const transitLegs = useMemo(() => plan?.transit?.legs ?? [], [plan]);
  const currentIndex = useMemo(() => {
    if (!active) return -1;
    return transitLegs.findIndex((leg) => {
      const start = Date.parse(leg.departure);
      const end = Date.parse(leg.arrival);
      return Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end;
    });
  }, [active, now, transitLegs]);
  const currentLeg =
    currentIndex >= 0
      ? transitLegs[currentIndex]
      : transitLegs.find((leg) => Date.parse(leg.departure) > now)
        ?? transitLegs[transitLegs.length - 1]
        ?? null;
  const currentIsTransit = plan?.mode === "transit" && currentLeg?.mode === "transit";
  const activeTransitLeg =
    currentIsTransit
      ? currentLeg
      : transitLegs.find(
          (leg) => leg.mode === "transit" && Date.parse(leg.departure) > now,
        ) ?? null;
  const nextTransitLeg = activeTransitLeg
    ? transitLegs
        .slice(transitLegs.indexOf(activeTransitLeg) + 1)
        .find((leg) => leg.mode === "transit") ?? null
    : null;
  const warning = activeTransitLeg
    ? transferWarnings([activeTransitLeg, ...(nextTransitLeg ? [nextTransitLeg] : [])])[0]
    : null;

  const transitStart = plan?.transit ? Date.parse(plan.transit.departure) : NaN;
  const transitEnd = plan?.transit ? Date.parse(plan.transit.arrival) : NaN;
  const scheduleFraction =
    Number.isFinite(transitStart) && Number.isFinite(transitEnd) && transitEnd > transitStart
      ? Math.min(1, Math.max(0, (now - transitStart) / (transitEnd - transitStart)))
      : 0;
  const fraction =
    plan?.mode === "transit"
      ? guidance === "schedule"
        ? scheduleFraction
        : progress?.fraction ?? scheduleFraction
      : progress?.fraction ?? 0;

  if (!active || !plan) return null;

  const next = progress?.next ?? null;
  const distance = progress?.nextDistanceM ?? 0;
  const distanceLabel =
    distance >= 1000
      ? `${(distance / 1000).toFixed(1)} km`
      : `${Math.max(0, Math.round(distance / 10) * 10)} m`;

  const primary = currentIsTransit && activeTransitLeg
    ? `${lineLabel(activeTransitLeg)} → ${stopLabel(activeTransitLeg.to)}`
    : plan.mode === "transit" && activeTransitLeg
      ? `Walk to ${stopLabel(activeTransitLeg.from)}`
      : next
        ? `${distanceLabel} · ${next.instruction}`
        : offRoute
          ? "Off route"
          : "Following route";

  const departureDelay = activeTransitLeg ? legDelayMinutes(activeTransitLeg) : 0;
  const arrivalDelay = activeTransitLeg
    ? legDelayMinutes(activeTransitLeg, "arrival")
    : 0;
  const transitDelay = Math.max(departureDelay, arrivalDelay);
  const zone = plan.transit ? journeyTimeZone(plan) : undefined;
  const arrivalOffset = activeTransitLeg
    ? formatDayOffset(
        activeTransitLeg.arrival,
        activeTransitLeg.departure,
        undefined,
        activeTransitLeg.to.tz ?? zone,
      )
    : null;
  const secondary = currentIsTransit && activeTransitLeg
    ? `Alight ${stopLabel(activeTransitLeg.to)}${
        activeTransitLeg.to.platform ? ` · platform ${activeTransitLeg.to.platform}` : ""
      } · ${formatClock(
        activeTransitLeg.arrival,
        undefined,
        activeTransitLeg.to.tz ?? zone,
      )}${arrivalOffset ? ` ${arrivalOffset}` : ""}${
        arrivalDelay > 0 ? ` · +${arrivalDelay} min` : ""
      }`
    : plan.mode === "transit" && activeTransitLeg
      ? `Board ${lineLabel(activeTransitLeg)} at ${stopLabel(activeTransitLeg.from)}${
          activeTransitLeg.from.platform
            ? ` · platform ${activeTransitLeg.from.platform}`
            : ""
        } · ${formatClock(
          activeTransitLeg.departure,
          undefined,
          activeTransitLeg.from.tz ?? zone,
        )}`
      : offRoute
        ? "Return to the highlighted line or recalculate."
        : next?.streetName ?? "Follow the route";

  const transferText = warning
    ? `Change at ${warning.at} · ${Math.max(0, Math.round(warning.minutes))} min${
        warning.platformChange
          ? ` · platform ${warning.fromPlatform} → ${warning.toPlatform}`
          : ""
      }${warning.tight ? " · tight" : ""}`
    : null;

  const remaining = currentIsTransit && activeTransitLeg
    ? `Arrives ${formatClock(
        activeTransitLeg.arrival,
        undefined,
        activeTransitLeg.to.tz ?? zone,
      )}${arrivalOffset ? ` ${arrivalOffset}` : ""} · ${formatDuration(
        plan.durationMin,
      )}`
    : plan.mode === "transit" && activeTransitLeg
      ? `Board ${formatClock(
          activeTransitLeg.departure,
          undefined,
          activeTransitLeg.from.tz ?? zone,
        )} · ${formatDuration(plan.durationMin)}`
      : progress
        ? `${formatDuration(progress.remainingMin)} · ${formatDistance(
            progress.remainingM / 1000,
          )}`
        : "Locating…";

  const eta = currentIsTransit && activeTransitLeg
    ? formatClock(
        activeTransitLeg.arrival,
        undefined,
        activeTransitLeg.to.tz ?? zone,
      )
    : progress
      ? formatClock(
          new Date(now + progress.remainingMin * 60_000).toISOString(),
          undefined,
          zone,
        )
      : "—";

  async function recalculate() {
    if (!plan) return;
    const destination = plan.coordinates[plan.coordinates.length - 1];
    if (!destination) return;
    const origin = position
      ? { lon: position.lon, lat: position.lat }
      : { lon: plan.coordinates[0][0], lat: plan.coordinates[0][1] };
    recalcAbortRef.current?.abort();
    const ctrl = new AbortController();
    recalcAbortRef.current = ctrl;
    setRecalculating(true);
    setRecalcError(null);
    try {
      const plans = await planRoutes({
        mode: plan.mode,
        waypoints: [origin, { lon: destination[0], lat: destination[1] }],
        alternatives: 1,
        departAt: plan.mode === "transit" ? new Date() : undefined,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted || !useNavigation.getState().active) return;
      if (plans[0]) start(plans[0], { simulate });
      else setRecalcError("No new route found.");
    } catch (err) {
      if (isAbortError(err) || ctrl.signal.aborted) return;
      setRecalcError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!ctrl.signal.aborted) setRecalculating(false);
    }
  }

  const glyphColor =
    currentIsTransit && activeTransitLeg ? lineColor(activeTransitLeg) : "var(--accent)";
  const glyphText =
    currentIsTransit && activeTransitLeg ? lineTextColor(activeTransitLeg) : "var(--accent-ink)";

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[45] flex justify-center px-3 pt-[calc(var(--safe-top)+10px)]">
        <div
          className="pointer-events-auto flex w-full max-w-[520px] items-center gap-3 rounded-[16px] bg-[color:var(--glass-strong)] p-3 backdrop-blur-[22px]"
          aria-live="polite"
        >
          <span
            aria-hidden
            className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] text-[24px] font-bold"
            style={{ background: glyphColor, color: glyphText }}
          >
            {currentIsTransit && activeTransitLeg ? (
              <span className="px-1 text-center text-[11px] leading-tight">
                {lineLabel(activeTransitLeg)}
              </span>
            ) : (
              <ManeuverIcon maneuver={next} size={28} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold leading-tight text-[color:var(--ink)]">
              {primary}
            </div>
            <div className="truncate text-[12px] text-[color:var(--ink-dim)]">
              {secondary}
            </div>
            {transferText && (
              <div className="truncate text-[11px] text-[color:var(--warn)]">
                {transferText}
              </div>
            )}
          </div>
          {/* Always-visible way out: an X on the instruction banner, so
           * ending navigation never depends on spotting the small "End"
           * button in the bottom bar. */}
          <button
            type="button"
            onClick={endNavigation}
            aria-label="End navigation"
            title="End navigation"
            className="hud-icon-btn !h-9 !w-9 shrink-0"
          >
            <CloseIcon size={18} />
          </button>
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[45] flex justify-center px-3 pb-[calc(var(--safe-bottom)+10px)]">
        <div className="pointer-events-auto w-full max-w-[520px] rounded-[18px] bg-[color:var(--glass-strong)] p-3 backdrop-blur-[22px]">
          <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-[color:var(--surf-3)]">
            <div
              className="h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-500"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-[color:var(--ink)]">
                {plan.mode === "transit" ? remaining : `${eta} · ${remaining}`}
              </div>
              <div className="truncate text-[11px] text-[color:var(--ink-dim)]">
                {recalcError
                  ? recalcError
                  : error
                    ? error
                    : position
                      ? `GPS ±${Math.round(position.accuracyM ?? 0)} m`
                      : plan.mode === "transit"
                        ? "Transit guidance"
                        : "Waiting for GPS…"}
                {transitDelay > 0 ? ` · +${transitDelay} min` : ""}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setMuted(!muted)}
                aria-label={muted ? "Unmute voice guidance" : "Mute voice guidance"}
                className="hud-icon-btn"
              >
                <SpeakerIcon muted={muted} size={19} />
              </button>
              {plan.mode === "transit" && (
                <button
                  type="button"
                  onClick={() =>
                    setGuidance(guidance === "live" ? "schedule" : "live")
                  }
                  aria-label={
                    guidance === "live"
                      ? "Switch to timetable guidance"
                      : "Switch to live guidance"
                  }
                  aria-pressed={guidance === "schedule"}
                  className="hud-icon-btn bg-[color:var(--surf-2)] text-[9px] font-semibold"
                >
                  {guidance === "live" ? "LIVE" : "PLAN"}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  haptic("tap");
                  if (freeCamera) {
                    // Re-engage follow on the current bearing mode.
                    setFreeCamera(false);
                  } else {
                    setFollow(follow === "course" ? "north" : "course");
                  }
                  onRecenter();
                }}
                aria-label={
                  freeCamera
                    ? "Follow current position"
                    : follow === "course"
                      ? "Switch to north-up"
                      : "Switch to course-up"
                }
                aria-pressed={!freeCamera}
                className="hud-icon-btn"
                data-active={!freeCamera}
              >
                {follow === "course" || freeCamera ? (
                  <RecenterIcon size={19} />
                ) : (
                  "N"
                )}
              </button>
              {(offRoute || recalcError || plan.mode === "transit") && (
                <button
                  type="button"
                  onClick={() => void recalculate()}
                  disabled={recalculating}
                  aria-label="Recalculate route"
                  className="hud-btn-ghost !min-h-10 !w-auto px-2 text-[11px] font-medium"
                >
                  {recalculating ? "…" : "Recalc"}
                </button>
              )}
              <button
                type="button"
                onClick={endNavigation}
                aria-label="End navigation and clear route"
                className="hud-btn-primary !min-h-10 !px-4"
              >
                End
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
