"use client";

/**
 * Data side of the weather overlays.
 *
 * Both upstream payloads refresh every five minutes; both are only fetched
 * while their overlay is switched on. Radar animation is a plain interval —
 * a 600 ms frame rate needs no rAF loop and stays cheap when the tab is
 * hidden.
 */
import { useEffect } from "react";
import {
  fetchRadarFrames,
  fetchWarnings,
  isAbortError,
  overlayErrorMessage,
} from "./api";
import { RADAR_OVERLAY_ID, WARNINGS_OVERLAY_ID } from "./definitions";
import { useOverlays } from "./store";

const REFRESH_MS = 5 * 60_000;
export const RADAR_FRAME_MS = 650;

function visible(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/** Frames metadata while the radar overlay is on. */
export function useRadarFrames(): void {
  const enabled = useOverlays((s) => s.enabled[RADAR_OVERLAY_ID] ?? false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const load = async () => {
      if (!alive) return;
      if (!visible()) {
        timer = window.setTimeout(() => void load(), REFRESH_MS);
        return;
      }
      controller = new AbortController();
      const { radarFrames, setRadarStatus, setRadarFrames } = useOverlays.getState();
      if (!radarFrames) setRadarStatus("loading");
      try {
        const payload = await fetchRadarFrames({ signal: controller.signal });
        if (!alive) return;
        setRadarFrames(payload);
      } catch (error) {
        if (!alive || isAbortError(error)) return;
        setRadarStatus("error", overlayErrorMessage(error));
      } finally {
        controller = null;
      }
      if (alive) timer = window.setTimeout(() => void load(), REFRESH_MS);
    };

    void load();
    return () => {
      alive = false;
      controller?.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled]);
}

/** Normalised warnings while the warnings overlay is on. */
export function useWeatherWarnings(): void {
  const enabled = useOverlays((s) => s.enabled[WARNINGS_OVERLAY_ID] ?? false);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: number | undefined;
    let controller: AbortController | null = null;

    const load = async () => {
      if (!alive) return;
      controller = new AbortController();
      const { warnings, setWarningsStatus, setWarnings } = useOverlays.getState();
      if (!warnings) setWarningsStatus("loading");
      try {
        const payload = await fetchWarnings({ signal: controller.signal });
        if (!alive) return;
        setWarnings(payload);
      } catch (error) {
        if (!alive || isAbortError(error)) return;
        setWarningsStatus("error", overlayErrorMessage(error));
      } finally {
        controller = null;
      }
      if (alive) timer = window.setTimeout(() => void load(), REFRESH_MS);
    };

    void load();
    return () => {
      alive = false;
      controller?.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled]);
}

/** Step through the frames while the animation is running. */
export function useRadarPlayback(): void {
  const playing = useOverlays((s) => s.radarPlaying);
  const enabled = useOverlays((s) => s.enabled[RADAR_OVERLAY_ID] ?? false);

  useEffect(() => {
    if (!playing || !enabled) return;
    const id = window.setInterval(() => {
      if (!visible()) return;
      const state = useOverlays.getState();
      const total = state.radarFrames?.frames.length ?? 0;
      if (total === 0) return;
      state.setRadarIndex((state.radarIndex + 1) % total);
    }, RADAR_FRAME_MS);
    return () => window.clearInterval(id);
  }, [playing, enabled]);
}

/** Mount everything the weather overlays need. */
export function useWeatherOverlayData(): void {
  useRadarFrames();
  useWeatherWarnings();
  useRadarPlayback();
}
