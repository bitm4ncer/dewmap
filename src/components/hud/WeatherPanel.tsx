"use client";

/**
 * Weather section of the Nature pane: DWD rain radar (with the frame
 * timeline) and the official DWD warnings. Both are overlays from the
 * registry; this file only renders controls for their store state.
 */
import { LayerCard } from "./LayerCard";
import { PauseIcon, PlayIcon, RainIcon, WarningIcon } from "../ui/icons";
import {
  RADAR_GRADIENT,
  RADAR_LEGEND_LABELS,
  formatClock,
  frameHint,
  sliderKeyTarget,
} from "@/lib/overlays/radar";
import { RADAR_OVERLAY_ID, WARNINGS_OVERLAY_ID } from "@/lib/overlays/definitions";
import { latestAnalysisIndex, useOverlays } from "@/lib/overlays/store";
import {
  severityColor,
  severityCounts,
  severityLabel,
  warningsSummary,
  validityHint,
} from "@/lib/overlays/warnings";

const MAX_WARNINGS_SHOWN = 30;

function Attribution({
  label,
  url,
}: {
  label: string;
  url?: string;
}) {
  const text = `Daten: ${label}`;
  return (
    <p className="text-[11px] leading-snug text-[color:var(--ink-mute)]">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[color:var(--surf-3)] underline-offset-2 hover:text-[color:var(--ink-dim)]"
        >
          {text}
        </a>
      ) : (
        text
      )}
    </p>
  );
}

function RadarControls() {
  const frames = useOverlays((s) => s.radarFrames);
  const index = useOverlays((s) => s.radarIndex);
  const playing = useOverlays((s) => s.radarPlaying);
  const setIndex = useOverlays((s) => s.setRadarIndex);
  const setPlaying = useOverlays((s) => s.setRadarPlaying);

  if (!frames) return null;
  const list = frames.frames;
  const clamped = Math.min(index, list.length - 1);
  const frame = list[clamped];
  if (!frame) return null;

  // The frame list is not evenly spaced (5-minute analysis, 15-minute nowcast),
  // so the slider runs on real minutes, not on frame indices. Without this the
  // "Jetzt" marker would sit at 65 % while the actual now is at 38 % of the
  // time range.
  const startMs = Date.parse(list[0].time);
  const offsets = list.map((f) => Math.round((Date.parse(f.time) - startMs) / 60_000));
  const maxOffset = offsets[offsets.length - 1] || 0;
  const currentOffset = offsets[clamped] ?? 0;
  const anchorOffset = offsets[latestAnalysisIndex(frames)] ?? 0;
  const nowPct = maxOffset ? (anchorOffset / maxOffset) * 100 : 0;
  const fillPct = maxOffset ? (currentOffset / maxOffset) * 100 : 0;

  /**
   * Keyboard: one frame per arrow press. Without this the native slider moves
   * by a single minute, snaps back to the same frame and the thumb looks dead.
   */
  const onSliderKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const target = sliderKeyTarget(event.key, clamped, list.length - 1);
    if (target === null) return;
    event.preventDefault();
    setPlaying(false);
    setIndex(target);
  };

  /** Snap a minute value onto the frame that is closest in time. */
  const selectByOffset = (value: number) => {
    let best = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    offsets.forEach((offset, i) => {
      const delta = Math.abs(offset - value);
      if (delta < bestDelta) {
        best = i;
        bestDelta = delta;
      }
    });
    setIndex(best);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? "Radar-Animation pausieren" : "Radar-Animation abspielen"}
          aria-pressed={playing}
          data-playing={playing}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[color:var(--surf-2)] text-[color:var(--ink)] transition-colors hover:bg-[color:var(--surf-3)] data-[playing=true]:bg-[color:var(--accent-soft)] data-[playing=true]:text-[color:var(--accent)]"
        >
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="hud-mono text-[13px] text-[color:var(--ink)]">
              {formatClock(frame.time)}
            </span>
            <span className="hud-mono text-[11px] text-[color:var(--ink-mute)]">
              {frameHint(frame, frames.anchor)}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={maxOffset}
            step={1}
            value={currentOffset}
            onChange={(e) => {
              setPlaying(false);
              selectByOffset(Number(e.target.value));
            }}
            onKeyDown={onSliderKeyDown}
            className="hud-slider w-full"
            style={{ ["--hud-fill" as string]: `${fillPct}%` }}
            aria-label="Radar-Zeitpunkt"
            aria-valuetext={`${formatClock(frame.time)}, ${frameHint(frame, frames.anchor)}`}
          />
        </div>
      </div>
      <div className="relative h-3 text-[10.5px] text-[color:var(--ink-mute)]">
        <span className="absolute left-0">
          {frameHint(list[0], frames.anchor)}
        </span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${nowPct}%` }}
        >
          Jetzt
        </span>
        <span className="absolute right-0">
          {frameHint(list[list.length - 1], frames.anchor)}
        </span>
      </div>
    </div>
  );
}

function RadarCard() {
  const on = useOverlays((s) => s.enabled[RADAR_OVERLAY_ID] ?? false);
  const opacity = useOverlays((s) => s.opacity[RADAR_OVERLAY_ID] ?? 0.72);
  const status = useOverlays((s) => s.radarStatus);
  const error = useOverlays((s) => s.radarError);
  const frames = useOverlays((s) => s.radarFrames);
  const setEnabled = useOverlays((s) => s.setEnabled);
  const setOpacity = useOverlays((s) => s.setOpacity);

  const statusLine = !on
    ? null
    : status === "loading" && !frames
      ? "resolving radar frames…"
      : status === "error"
        ? error ?? "Radar nicht erreichbar."
        : frames
          ? `${frames.frames.filter((f) => f.kind === "analysis").length} Analyse- und ${
              frames.frames.filter((f) => f.kind === "forecast").length
            } Nowcast-Frames · ${formatClock(frames.generated)} geladen`
          : null;

  return (
    <LayerCard
      label="Rain radar"
      icon={<RainIcon size={16} />}
      on={on}
      opacity={opacity}
      onToggle={(next) => setEnabled(RADAR_OVERLAY_ID, next)}
      onOpacityChange={(next) => setOpacity(RADAR_OVERLAY_ID, next)}
      caption="Radar composite RV · 1 km · 5 min · analysis plus 90 min nowcast · Germany · visible to zoom 12"
      status={statusLine}
      extras={on ? <RadarControls /> : null}
      legend={{
        gradient: RADAR_GRADIENT,
        minLabel: RADAR_LEGEND_LABELS[0],
        midLabel: RADAR_LEGEND_LABELS[2],
        maxLabel: RADAR_LEGEND_LABELS[RADAR_LEGEND_LABELS.length - 1],
        unit: "mm/h · DWD radar scale",
      }}
      footer={
        <Attribution
          label="Deutscher Wetterdienst (DWD), Radar RV"
          url="https://www.dwd.de"
        />
      }
    />
  );
}

function WarningList() {
  const payload = useOverlays((s) => s.warnings);
  if (!payload) return null;
  const warnings = payload.warnings.slice(0, MAX_WARNINGS_SHOWN);
  const hidden = payload.total - warnings.length;

  if (payload.total === 0) {
    return (
      <p className="text-[12px] text-[color:var(--ink-dim)]">
        Aktuell keine amtlichen Warnungen für Deutschland.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        {severityCounts(payload.counts).map(({ level, count }) => (
          <span
            key={level}
            className="inline-flex items-center gap-1 rounded-full bg-[color:var(--surf-2)] px-2 py-1 text-[11px] text-[color:var(--ink-dim)]"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: severityColor(level) }}
              aria-hidden
            />
            <span className="hud-mono">{count}</span>
            <span>{severityLabel(level)}</span>
          </span>
        ))}
      </div>
      <ul className="hud-scrollbar flex max-h-[260px] flex-col gap-1 overflow-y-auto pr-1">
        {warnings.map((warning) => (
          <li
            key={warning.id}
            className="flex gap-2 rounded-[10px] bg-[color:var(--surf-2)] p-2"
          >
            <span
              className="mt-1 h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: severityColor(warning.level) }}
              aria-hidden
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[12px] font-medium text-[color:var(--ink)]">
                {warning.event}
              </span>
              <span className="truncate text-[11.5px] text-[color:var(--ink-dim)]">
                {warning.area}
                {warning.stateShort ? ` · ${warning.stateShort}` : ""}
              </span>
              <span className="hud-mono text-[11px] text-[color:var(--ink-mute)]">
                {validityHint(warning.to)}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <p className="hud-mono text-[11px] text-[color:var(--ink-mute)]">
          +{hidden} weitere Warnungen
        </p>
      )}
      {payload.areasUnavailable ? (
        <p className="hud-mono text-[11px] text-[color:var(--ink-mute)]">
          Gebietsgrenzen derzeit nicht abrufbar
        </p>
      ) : (
        (payload.areasMissing ?? 0) > 0 && (
          <p className="hud-mono text-[11px] text-[color:var(--ink-mute)]">
            {payload.areasMissing} Warnzellen ohne Gebietsfläche (Kombi- oder Seezellen)
          </p>
        )
      )}
    </div>
  );
}

function WarningsCard() {
  const on = useOverlays((s) => s.enabled[WARNINGS_OVERLAY_ID] ?? false);
  const status = useOverlays((s) => s.warningsStatus);
  const error = useOverlays((s) => s.warningsError);
  const payload = useOverlays((s) => s.warnings);
  const setEnabled = useOverlays((s) => s.setEnabled);
  const setOpacity = useOverlays((s) => s.setOpacity);

  const statusLine = !on
    ? null
    : status === "loading" && !payload
      ? "resolving warnings…"
      : status === "error"
        ? error ?? "Warnungen nicht erreichbar."
        : payload
          ? `${warningsSummary(payload.total, payload.maxLevel)} · Stand ${formatClock(
              payload.issuedAt ?? payload.generated,
            )}${payload.areasComplete ? "" : " · Gebietsgrenzen unvollständig"}`
          : null;

  return (
    <LayerCard
      label="Weather warnings"
      icon={<WarningIcon size={16} />}
      on={on}
      opacity={1}
      hideOpacity
      onToggle={(next) => setEnabled(WARNINGS_OVERLAY_ID, next)}
      onOpacityChange={(next) => setOpacity(WARNINGS_OVERLAY_ID, next)}
      caption="Official DWD warnings by district and municipality · severity areas on the map"
      status={statusLine}
      extras={on ? <WarningList /> : null}
      footer={
        <Attribution
          label="Deutscher Wetterdienst (DWD), Warnungen"
          url="https://www.dwd.de"
        />
      }
    />
  );
}

export function WeatherPanel() {
  return (
    <div className="flex flex-col gap-3">
      <RadarCard />
      <WarningsCard />
    </div>
  );
}
