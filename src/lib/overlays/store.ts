"use client";

/**
 * Overlay state.
 *
 * Deliberately separate from `useSettings`: the overlay registry is open for
 * new modules, and every new overlay would otherwise need a settings
 * migration. Toggles and opacity persist; playback state and fetched data do
 * not.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { WarningAreaCollection } from "./types";
import type {
  RadarFramesPayload,
  WarningItem,
  WarningsPayload,
} from "./api";

export type LoadStatus = "idle" | "loading" | "ready" | "error";

const clamp01 = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;

interface OverlayState {
  enabled: Record<string, boolean>;
  opacity: Record<string, number>;

  radarStatus: LoadStatus;
  radarError: string | null;
  radarFrames: RadarFramesPayload | null;
  radarIndex: number;
  radarPlaying: boolean;
  /** Whether the PNG for the selected frame actually arrived. */
  radarImageStatus: LoadStatus;
  radarImageError: string | null;

  warningsStatus: LoadStatus;
  warningsError: string | null;
  warnings: WarningsPayload | null;

  isEnabled: (id: string, fallback?: boolean) => boolean;
  opacityFor: (id: string, fallback: number) => number;
  setEnabled: (id: string, on: boolean) => void;
  toggle: (id: string) => void;
  setOpacity: (id: string, value: number) => void;

  setRadarStatus: (status: LoadStatus, error?: string | null) => void;
  setRadarFrames: (payload: RadarFramesPayload) => void;
  setRadarIndex: (index: number) => void;
  setRadarPlaying: (playing: boolean) => void;
  setRadarImageStatus: (status: LoadStatus, error?: string | null) => void;
  resetRadarIndex: () => void;

  setWarningsStatus: (status: LoadStatus, error?: string | null) => void;
  setWarnings: (payload: WarningsPayload) => void;
}

/** Index of the newest analysis frame in a frame list. */
export function latestAnalysisIndex(payload: RadarFramesPayload | null): number {
  if (!payload) return 0;
  let index = 0;
  payload.frames.forEach((frame, i) => {
    if (frame.kind === "analysis") index = i;
  });
  return index;
}

export const useOverlays = create<OverlayState>()(
  persist(
    (set, get) => ({
      enabled: {},
      opacity: {},

      radarStatus: "idle",
      radarError: null,
      radarFrames: null,
      radarIndex: 0,
      radarPlaying: false,
      radarImageStatus: "idle",
      radarImageError: null,

      warningsStatus: "idle",
      warningsError: null,
      warnings: null,

      isEnabled: (id, fallback = false) => get().enabled[id] ?? fallback,
      opacityFor: (id, fallback) => get().opacity[id] ?? fallback,

      setEnabled: (id, on) =>
        set((state) => ({ enabled: { ...state.enabled, [id]: on } })),
      toggle: (id) =>
        set((state) => ({
          enabled: { ...state.enabled, [id]: !(state.enabled[id] ?? false) },
        })),
      setOpacity: (id, value) => {
        // A slider can emit NaN mid-drag; keep the last good value instead of
        // snapping the layer to transparent.
        if (!Number.isFinite(value)) return;
        set((state) => ({
          opacity: { ...state.opacity, [id]: clamp01(value) },
        }));
      },

      setRadarStatus: (status, error = null) =>
        set({ radarStatus: status, radarError: status === "error" ? error : null }),
      setRadarFrames: (payload) =>
        set((state) => {
          // Keep the user's position on the timeline unless they were parked
          // on the live edge — then follow the new newest frame.
          const wasLatest =
            !state.radarFrames || state.radarIndex >= latestAnalysisIndex(state.radarFrames);
          return {
            radarFrames: payload,
            radarStatus: "ready",
            radarError: null,
            radarIndex: wasLatest ? latestAnalysisIndex(payload) : Math.min(state.radarIndex, payload.frames.length - 1),
          };
        }),
      setRadarIndex: (index) =>
        set((state) => {
          const max = (state.radarFrames?.frames.length ?? 1) - 1;
          return { radarIndex: Math.max(0, Math.min(max, Math.round(index))) };
        }),
      setRadarPlaying: (playing) => set({ radarPlaying: playing }),
      setRadarImageStatus: (status, error = null) =>
        set({
          radarImageStatus: status,
          radarImageError: status === "error" ? error : null,
        }),
      resetRadarIndex: () =>
        set((state) => ({ radarIndex: latestAnalysisIndex(state.radarFrames) })),

      setWarningsStatus: (status, error = null) =>
        set({
          warningsStatus: status,
          warningsError: status === "error" ? error : null,
        }),
      setWarnings: (payload) =>
        set({ warnings: payload, warningsStatus: "ready", warningsError: null }),
    }),
    {
      name: "dewmap:overlays",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        enabled: state.enabled,
        opacity: state.opacity,
      }),
    },
  ),
);

/** Areas for the map, with a stable empty collection as fallback. */
export function warningAreasOf(
  payload: WarningsPayload | null,
): WarningAreaCollection | null {
  if (!payload) return null;
  return payload.areas as unknown as WarningAreaCollection;
}

/** The warning list the panel renders, hardest first. */
export function sortedWarnings(payload: WarningsPayload | null): WarningItem[] {
  return payload?.warnings ?? [];
}
