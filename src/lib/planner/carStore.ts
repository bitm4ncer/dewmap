"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { RoutePlan } from "@/lib/routing";
import type { Waypoint } from "@/lib/hiking/types";
import { migrateLegacyStorage } from "../legacyStorage";

migrateLegacyStorage();

export type CarProfile = "fastest" | "shortest" | "avoid-highways" | "avoid-tolls";

export const CAR_PROFILES: { id: CarProfile; label: string }[] = [
  { id: "fastest", label: "Fastest" },
  { id: "shortest", label: "Shortest" },
  { id: "avoid-highways", label: "No Hwy" },
  { id: "avoid-tolls", label: "No Toll" },
];

export type PlannerPhase =
  | { kind: "idle" }
  | { kind: "routing" }
  | { kind: "routed" }
  | { kind: "error"; message: string };

interface CarState {
  waypoints: Waypoint[];
  profile: CarProfile;
  routes: RoutePlan[];
  selectedId: string | null;
  phase: PlannerPhase;
  notice: string | null;

  addWaypoint: (w: Omit<Waypoint, "id">) => void;
  setWaypoints: (waypoints: Omit<Waypoint, "id">[]) => void;
  removeWaypoint: (id: string) => void;
  moveWaypoint: (id: string, dir: -1 | 1) => void;
  clear: () => void;
  setProfile: (p: CarProfile) => void;
  setRoutes: (routes: RoutePlan[]) => void;
  selectRoute: (id: string | null) => void;
  setPhase: (p: PlannerPhase) => void;
  setNotice: (n: string | null) => void;
}

let counter = 0;
function id(): string {
  counter += 1;
  return `car-${Date.now().toString(36)}-${counter}`;
}

const DEFAULTS = {
  waypoints: [] as Waypoint[],
  profile: "fastest" as CarProfile,
  routes: [] as RoutePlan[],
  selectedId: null as string | null,
};

export const useCar = create<CarState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      phase: { kind: "idle" },
      notice: null,

      addWaypoint: (w) =>
        set((s) => ({
          waypoints: [...s.waypoints, { ...w, id: id() }],
          routes: [],
          selectedId: null,
          phase: { kind: "idle" },
        })),
      setWaypoints: (waypoints) =>
        set({
          waypoints: waypoints.map((w) => ({ ...w, id: id() })),
          routes: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
        }),
      removeWaypoint: (wId) =>
        set((s) => ({
          waypoints: s.waypoints.filter((w) => w.id !== wId),
          routes: [],
          selectedId: null,
          phase: { kind: "idle" },
        })),
      moveWaypoint: (wId, dir) =>
        set((s) => {
          const i = s.waypoints.findIndex((w) => w.id === wId);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= s.waypoints.length) return s;
          const next = s.waypoints.slice();
          const [item] = next.splice(i, 1);
          next.splice(j, 0, item);
          return { waypoints: next, routes: [], selectedId: null, phase: { kind: "idle" } };
        }),
      clear: () =>
        set({
          waypoints: [],
          routes: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
        }),
      setProfile: (profile) =>
        set({ profile, routes: [], selectedId: null, phase: { kind: "idle" } }),
      setRoutes: (routes) =>
        set((s) => {
          const keep =
            s.selectedId != null && routes.some((r) => r.id === s.selectedId);
          return {
            routes,
            selectedId: keep ? s.selectedId : (routes[0]?.id ?? null),
            phase: { kind: "routed" },
          };
        }),
      selectRoute: (selectedId) => set({ selectedId }),
      setPhase: (phase) => set({ phase }),
      setNotice: (notice) => set({ notice }),
    }),
    {
      name: "dewmap:car",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        waypoints: s.waypoints,
        profile: s.profile,
      }),
    },
  ),
);
