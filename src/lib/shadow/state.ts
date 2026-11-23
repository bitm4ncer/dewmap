"use client";

/**
 * Shadow layer state, in two stores with different lifetimes.
 *
 * `useShadowSettings` is user intent and survives reloads (slider offset).
 * `useShadowRuntime` is the current computation: phase, stats, the rendered
 * image. Keeping them apart means a reload restores "13:40" without replaying
 * a stale mask, and the map never shows yesterday's shadows.
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Bbox, SolarPosition } from "./types";

export const MAX_OFFSET_MINUTES = 12 * 60;
export const OFFSET_STEP_MINUTES = 5;

const clampOffset = (minutes: number) =>
  Number.isFinite(minutes)
    ? Math.max(-MAX_OFFSET_MINUTES, Math.min(MAX_OFFSET_MINUTES, Math.round(minutes / OFFSET_STEP_MINUTES) * OFFSET_STEP_MINUTES))
    : 0;

interface ShadowSettingsState {
  /** Minutes from "now", −720..+720, in 5-minute steps. */
  offsetMinutes: number;
  setOffsetMinutes: (minutes: number) => void;
  resetToNow: () => void;
}

export const useShadowSettings = create<ShadowSettingsState>()(
  persist(
    (set) => ({
      offsetMinutes: 0,
      setOffsetMinutes: (minutes) => set({ offsetMinutes: clampOffset(minutes) }),
      resetToNow: () => set({ offsetMinutes: 0 }),
    }),
    {
      name: "dewmap:shadow",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ offsetMinutes: state.offsetMinutes }),
    },
  ),
);

export type ShadowPhase =
  | "off"
  | "zoomed-out"
  | "outside"
  | "loading"
  | "ready"
  | "empty"
  | "night"
  | "error";

export interface ShadowStatsView {
  buildings: number;
  shadowFraction: number;
  computeMs: number;
  encodeMs: number;
  resolutionM: number;
  width: number;
  height: number;
  /** Tiles actually fetched for this run (0 = fully cached). */
  tiles: number;
  tileBytes: number;
  cacheHits: number;
  /** Window was clipped to the pilot area or to 6 × 6 km. */
  partial: boolean;
}

interface ShadowRuntimeState {
  phase: ShadowPhase;
  message: string | null;
  zoom: number;
  bbox: Bbox | null;
  sun: SolarPosition | null;
  stats: ShadowStatsView | null;
  /** Bumped on every state that belongs to a specific render. */
  runId: number;
  setViewport: (zoom: number, bbox: Bbox) => void;
  begin: (message?: string) => void;
  ready: (result: { sun: SolarPosition; stats: ShadowStatsView }) => void;
  empty: (phase: "empty" | "night", message: string, sun: SolarPosition | null) => void;
  outside: (message: string) => void;
  zoomedOut: (message: string) => void;
  fail: (message: string) => void;
  off: () => void;
}

export const useShadowRuntime = create<ShadowRuntimeState>()((set) => ({
  phase: "off",
  message: null,
  zoom: 0,
  bbox: null,
  sun: null,
  stats: null,
  runId: 0,
  setViewport: (zoom, bbox) => set({ zoom, bbox }),
  begin: (message) =>
    set((state) => ({
      phase: "loading",
      message: message ?? null,
      runId: state.runId + 1,
    })),
  // `bbox` is deliberately *not* part of `ready`: it is the map viewport and
  // replacing it here would re-trigger the render effect after every result
  // (the identity changes, the values do not).
  ready: ({ sun, stats }) =>
    set((state) => ({
      phase: "ready",
      message: null,
      sun,
      stats,
      runId: state.runId + 1,
    })),
  empty: (phase, message, sun) =>
    set((state) => ({
      phase,
      message,
      sun,
      stats: null,
      runId: state.runId + 1,
    })),
  outside: (message) =>
    set((state) => ({
      phase: "outside",
      message,
      stats: null,
      runId: state.runId + 1,
    })),
  zoomedOut: (message) =>
    set((state) => ({
      phase: "zoomed-out",
      message,
      stats: null,
      runId: state.runId + 1,
    })),
  fail: (message) =>
    set((state) => ({
      phase: "error",
      message,
      stats: null,
      runId: state.runId + 1,
    })),
  off: () =>
    set((state) => ({
      phase: "off",
      message: null,
      stats: null,
      sun: null,
      runId: state.runId + 1,
    })),
}));

/** The instant the slider currently points at. */
export function shadowTimeFor(offsetMinutes: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + clampOffset(offsetMinutes) * 60_000);
}
