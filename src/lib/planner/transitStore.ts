"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { RoutePlan } from "@/lib/routing";
import type { PlannerPhase } from "./carStore";

export interface TransitPlace {
  name: string;
  lat: number;
  lon: number;
  id?: string;
  city?: string;
  /** "address" means lat/lon belongs to an address; the nearest stop is
   * resolved separately and shown in the UI. */
  kind?: "address" | "stop";
  /** Nearest stop for an address origin/destination. */
  station?: {
    name: string;
    lat: number;
    lon: number;
    city?: string;
    distanceM?: number;
  };
}

interface TransitState {
  from: TransitPlace | null;
  to: TransitPlace | null;
  /** ISO local datetime string (`YYYY-MM-DDTHH:mm`) or empty for "now". */
  when: string;
  arriveBy: boolean;
  maxTransfers: number;
  wheelchair: boolean;
  cityFilter: string;
  journeys: RoutePlan[];
  selectedId: string | null;
  phase: PlannerPhase;
  notice: string | null;

  setFrom: (p: TransitPlace | null) => void;
  setTo: (p: TransitPlace | null) => void;
  swap: () => void;
  setWhen: (w: string) => void;
  setArriveBy: (v: boolean) => void;
  setMaxTransfers: (n: number) => void;
  setWheelchair: (v: boolean) => void;
  setCityFilter: (v: string) => void;
  setJourneys: (j: RoutePlan[]) => void;
  selectJourney: (id: string | null) => void;
  setPhase: (p: PlannerPhase) => void;
  setNotice: (n: string | null) => void;
  reset: () => void;
}

function defaultWhen(): string {
  const d = new Date();
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export const useTransit = create<TransitState>()(
  persist(
    (set) => ({
      from: null,
      to: null,
      when: "",
      arriveBy: false,
      maxTransfers: 3,
      wheelchair: false,
      cityFilter: "",
      journeys: [],
      selectedId: null,
      phase: { kind: "idle" },
      notice: null,

      setFrom: (from) =>
        set({ from, journeys: [], selectedId: null, phase: { kind: "idle" } }),
      setTo: (to) =>
        set({ to, journeys: [], selectedId: null, phase: { kind: "idle" } }),
      swap: () =>
        set((s) => ({
          from: s.to,
          to: s.from,
          journeys: [],
          selectedId: null,
          phase: { kind: "idle" },
        })),
      setWhen: (when) => set({ when }),
      setArriveBy: (arriveBy) => set({ arriveBy }),
      setMaxTransfers: (maxTransfers) =>
        set({ maxTransfers: Math.max(0, Math.min(5, Math.round(maxTransfers))) }),
      setWheelchair: (wheelchair) => set({ wheelchair }),
      setCityFilter: (cityFilter) => set({ cityFilter }),
      setJourneys: (journeys) =>
        set((s) => {
          const keep =
            s.selectedId != null &&
            journeys.some((j) => j.id === s.selectedId);
          return {
            journeys,
            selectedId: keep ? s.selectedId : (journeys[0]?.id ?? null),
            phase: { kind: "routed" },
          };
        }),
      selectJourney: (selectedId) => set({ selectedId }),
      setPhase: (phase) => set({ phase }),
      setNotice: (notice) => set({ notice }),
      reset: () =>
        set({
          from: null,
          to: null,
          when: "",
          journeys: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
        }),
    }),
    {
      name: "biosphere1:transit",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        from: s.from,
        to: s.to,
        arriveBy: s.arriveBy,
        maxTransfers: s.maxTransfers,
        wheelchair: s.wheelchair,
        cityFilter: s.cityFilter,
      }),
    },
  ),
);

export { defaultWhen };
