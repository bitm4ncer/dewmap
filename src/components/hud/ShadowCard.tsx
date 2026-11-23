"use client";

/**
 * The Shadows card in the Nature pane.
 *
 * Controls only: the rendering lives in `useShadowOverlayData`, the data in
 * the shadow stores. Keeping it that way means the card can unmount (pane
 * closed) without stopping the layer.
 */
import { useEffect, useState } from "react";
import { LayerCard } from "./LayerCard";
import { ClockIcon } from "@/components/ui/icons";
import {
  SHADOW_OVERLAY_DEFAULT_OPACITY,
  SHADOW_OVERLAY_ID,
  SHADOW_OVERLAY_MIN_ZOOM,
} from "@/lib/shadow/overlay";
import {
  formatShadowClock,
  formatShadowDay,
  formatShadowOffset,
  shadowStatusLine,
} from "@/lib/shadow/panel";
import { MAX_OFFSET_MINUTES, OFFSET_STEP_MINUTES, shadowTimeFor, useShadowRuntime, useShadowSettings } from "@/lib/shadow/state";
import { useOverlays } from "@/lib/overlays/store";

const LOD1_URL = "https://www.opengeodata.nrw.de/produkte/geobasis/3dg/lod1_gml/lod1_gml/";
const LICENSE_URL = "https://www.govdata.de/dl-de/zero-2-0";
const OSM_URL = "https://www.openstreetmap.org/copyright";

function ShadowControls() {
  const offsetMinutes = useShadowSettings((state) => state.offsetMinutes);
  const setOffsetMinutes = useShadowSettings((state) => state.setOffsetMinutes);
  const resetToNow = useShadowSettings((state) => state.resetToNow);
  const phase = useShadowRuntime((state) => state.phase);
  const stats = useShadowRuntime((state) => state.stats);

  // The card clock ticks every 30 s while it shows "now"; the shadow mask is
  // only recomputed on the 5-minute boundary in the data hook.
  const [clockTick, setClockTick] = useState(() => new Date());
  useEffect(() => {
    if (offsetMinutes !== 0) return;
    const id = window.setInterval(() => setClockTick(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [offsetMinutes]);
  const now = offsetMinutes === 0 ? clockTick : new Date();
  const time = shadowTimeFor(offsetMinutes, now);
  const clock = formatShadowClock(time);
  const day = formatShadowDay(time, now);
  const offsetLabel = formatShadowOffset(offsetMinutes);
  const fill = Math.round(((offsetMinutes + MAX_OFFSET_MINUTES) / (2 * MAX_OFFSET_MINUTES)) * 100);
  const atNow = Math.abs(offsetMinutes) < 1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ClockIcon size={14} />
        <span className="hud-mono text-[13px] text-[color:var(--ink)]">{clock}</span>
        {day && (
          <span className="hud-mono text-[11px] text-[color:var(--ink-mute)]">{day}</span>
        )}
        <span className="hud-mono text-[11px] text-[color:var(--ink-mute)]">
          {offsetLabel}
        </span>
        <button
          type="button"
          onClick={resetToNow}
          aria-label="Reset shadow time to now"
          aria-pressed={atNow}
          disabled={atNow}
          className="ml-auto inline-flex h-11 min-w-11 items-center justify-center rounded-full bg-[color:var(--surf-2)] px-3 text-[12px] font-medium text-[color:var(--ink)] transition-colors hover:bg-[color:var(--surf-3)] disabled:opacity-45"
        >
          Now
        </button>
      </div>

      <input
        type="range"
        min={-MAX_OFFSET_MINUTES}
        max={MAX_OFFSET_MINUTES}
        step={OFFSET_STEP_MINUTES}
        value={offsetMinutes}
        onChange={(event) => setOffsetMinutes(Number(event.target.value))}
        onDoubleClick={resetToNow}
        className="hud-slider hud-slider-tall w-full"
        style={{ ["--hud-fill" as string]: `${fill}%` }}
        aria-label="Shadow time"
        aria-valuetext={`${clock}${day ? ` ${day}` : ""}, ${offsetLabel}`}
      />
      <div className="flex justify-between text-[10.5px] text-[color:var(--ink-mute)]">
        <span>−12 h</span>
        <span>now</span>
        <span>+12 h</span>
      </div>

      <p className="text-[11.5px] leading-snug text-[color:var(--ink-mute)]">
        Düsseldorf pilot · buildings only · LoD1 block models, flat terrain
      </p>
      {phase === "ready" && stats && (
        <p className="hud-mono text-[10.5px] text-[color:var(--ink-mute)]">
          {stats.width}×{stats.height} cells ·{" "}
          {stats.tileBytes > 0
            ? `${(stats.tileBytes / 1024).toFixed(0)} kB tiles (uncompressed)`
            : "tiles cached"}
          {stats.encodeMs > 0 ? ` · ${Math.round(stats.encodeMs)} ms encode` : ""}
        </p>
      )}
    </div>
  );
}

export function ShadowCard() {
  const on = useOverlays((state) => state.enabled[SHADOW_OVERLAY_ID] ?? false);
  const opacity = useOverlays(
    (state) => state.opacity[SHADOW_OVERLAY_ID] ?? SHADOW_OVERLAY_DEFAULT_OPACITY,
  );
  const setEnabled = useOverlays((state) => state.setEnabled);
  const setOpacity = useOverlays((state) => state.setOpacity);
  const phase = useShadowRuntime((state) => state.phase);
  const message = useShadowRuntime((state) => state.message);
  const stats = useShadowRuntime((state) => state.stats);
  const sun = useShadowRuntime((state) => state.sun);

  const status = on
    ? shadowStatusLine({ phase, message, stats, sun })
    : null;

  return (
    <LayerCard
      label="Shadows"
      icon={<ClockIcon size={16} />}
      on={on}
      opacity={opacity}
      tallSliders
      onToggle={(next) => setEnabled(SHADOW_OVERLAY_ID, next)}
      onOpacityChange={(next) => setOpacity(SHADOW_OVERLAY_ID, next)}
      caption={`Cast building shadows for a chosen time · 2–8 m · visible from zoom ${SHADOW_OVERLAY_MIN_ZOOM} · Düsseldorf`}
      status={status}
      extras={on ? <ShadowControls /> : null}
      footer={
        <p className="text-[11px] leading-snug text-[color:var(--ink-mute)]">
          Data:{" "}
          <a
            href={LOD1_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-[color:var(--surf-3)] underline-offset-2 hover:text-[color:var(--ink-dim)]"
          >
            Geobasis NRW LoD1
          </a>{" "}
          ·{" "}
          <a
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-[color:var(--surf-3)] underline-offset-2 hover:text-[color:var(--ink-dim)]"
          >
            dl-de/zero-2.0
          </a>{" "}
          ·{" "}
          <a
            href={OSM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-[color:var(--surf-3)] underline-offset-2 hover:text-[color:var(--ink-dim)]"
          >
            © OpenStreetMap contributors
          </a>
        </p>
      }
    />
  );
}
