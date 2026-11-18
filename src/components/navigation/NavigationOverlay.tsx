"use client";

import { useEffect, useState } from "react";
import { ManeuverIcon, RecenterIcon, SpeakerIcon } from "@/components/ui/icons";
import { useNavigation } from "@/lib/navigation/store";
import type { RouteProgress } from "@/lib/navigation/progress";
import type { LivePosition } from "@/lib/navigation/useNavigation";
import {
  formatClock,
  formatDistance,
  formatDuration,
} from "@/lib/routing";

interface Props {
  progress: RouteProgress | null;
  position: LivePosition | null;
  error: string | null;
  offRoute: boolean;
  onRecenter: () => void;
}

function TrainGlyph() {
  return (
    <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="3" width="14" height="14" rx="3" />
      <path d="M8 7h8M8 11h8M7 21l2-4M17 21l-2-4" />
      <circle cx="9" cy="14" r=".8" fill="currentColor" />
      <circle cx="15" cy="14" r=".8" fill="currentColor" />
    </svg>
  );
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
  const stop = useNavigation((s) => s.stop);
  const setMuted = useNavigation((s) => s.setMuted);
  const setFollow = useNavigation((s) => s.setFollow);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active || !plan) return null;

  const next = progress?.next ?? null;
  const distance = progress?.nextDistanceM ?? 0;
  const distanceLabel =
    distance >= 1000
      ? `${(distance / 1000).toFixed(1)} km`
      : `${Math.max(0, Math.round(distance / 10) * 10)} m`;
  const transitLegs = plan.transit?.legs ?? [];
  const currentLeg =
    transitLegs.find((l) => {
      const start = Date.parse(l.departure);
      const end = Date.parse(l.arrival);
      return Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end;
    }) ??
    transitLegs.find((l) => Date.parse(l.departure) > now) ??
    transitLegs[0] ??
    null;
  const transitLeg = currentLeg;
  const isTransit = plan.mode === "transit" && transitLeg != null;
  const remaining = isTransit
    ? `Arrives ${formatClock(plan.transit!.arrival)} · ${formatDuration(plan.durationMin)}`
    : progress
      ? `${formatDuration(progress.remainingMin)} · ${formatDistance(progress.remainingM / 1000)}`
      : "Locating…";
  const eta = isTransit
    ? formatClock(transitLeg!.departure)
    : progress
      ? formatClock(new Date(now + progress.remainingMin * 60_000).toISOString())
      : "—";
  const transitStart = plan.transit ? Date.parse(plan.transit.departure) : NaN;
  const transitEnd = plan.transit ? Date.parse(plan.transit.arrival) : NaN;
  const transitFraction =
    Number.isFinite(transitStart) && Number.isFinite(transitEnd) && transitEnd > transitStart
      ? Math.min(1, Math.max(0, (now - transitStart) / (transitEnd - transitStart)))
      : 0;
  const fraction = progress?.fraction ?? (isTransit ? transitFraction : 0);

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[45] flex justify-center px-3 pt-[calc(var(--safe-top)+10px)]">
        <div className="pointer-events-auto flex w-full max-w-[520px] items-center gap-3 rounded-[16px] bg-[color:var(--glass-strong)] p-3 backdrop-blur-[22px]">
          <span
            aria-hidden
            className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-[color:var(--accent)] text-[24px] font-bold text-[color:var(--accent-ink)]"
          >
            {isTransit ? <TrainGlyph /> : <ManeuverIcon maneuver={next} size={28} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[17px] font-semibold leading-tight text-[color:var(--ink)]">
              {isTransit
                ? `${transitLeg!.line ?? transitLeg!.rawMode ?? "Transit"} to ${
                    transitLeg!.headsign ?? transitLeg!.to.name
                  }`
                : next
                  ? `${distanceLabel} · ${next.instruction}`
                  : offRoute
                    ? "Off route"
                    : "Following route"}
            </div>
            <div className="truncate text-[12px] text-[color:var(--ink-dim)]">
              {offRoute
                ? "Return to the highlighted line or recalculate."
                : isTransit
                  ? `${formatClock(transitLeg!.departure)} · ${transitLeg!.from.name}`
                  : next?.streetName ?? "Follow the route"}
            </div>
          </div>
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
                {isTransit ? remaining : `${eta} · ${remaining}`}
              </div>
              <div className="text-[11px] text-[color:var(--ink-dim)]">
                {error
                  ? error
                  : position
                    ? `GPS ±${Math.round(position.accuracyM ?? 0)} m`
                    : isTransit
                      ? "Live transit guidance"
                      : "Waiting for GPS…"}
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
              <button
                type="button"
                onClick={() => {
                  setFollow(follow === "course" ? "north" : "course");
                  onRecenter();
                }}
                aria-label="Recenter map"
                className="hud-icon-btn"
              >
                {follow === "course" ? <RecenterIcon size={19} /> : "N"}
              </button>
              <button
                type="button"
                onClick={stop}
                aria-label="End navigation"
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
