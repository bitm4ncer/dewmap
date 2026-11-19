"use client";

import { create } from "zustand";
import type { RoutePlan, TravelMode } from "@/lib/routing";

interface NavigationState {
  active: boolean;
  plan: RoutePlan | null;
  mode: TravelMode | null;
  muted: boolean;
  follow: "course" | "north";
  /** True while the user has panned away and the camera must not
   *  re-center on the location marker. The locate button re-engages. */
  freeCamera: boolean;
  simulate: boolean;
  guidance: "live" | "schedule";
  start: (plan: RoutePlan, options?: { simulate?: boolean; mode?: TravelMode }) => void;
  stop: () => void;
  setMuted: (m: boolean) => void;
  setFollow: (f: "course" | "north") => void;
  setFreeCamera: (free: boolean) => void;
  setGuidance: (g: "live" | "schedule") => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  active: false,
  plan: null,
  mode: null,
  muted: false,
  follow: "course",
  freeCamera: false,
  simulate: false,
  guidance: "live",
  start: (plan, options) =>
    set({
      active: true,
      plan,
      mode: options?.mode ?? plan.mode,
      simulate: options?.simulate ?? false,
      // Google/Apple convention: drive course-up, everything else
      // north-up (walking headings are too noisy to steer the camera
      // and trains have no "course" worth following).
      follow:
        (options?.mode ?? plan.mode) === "car" ? "course" : "north",
      freeCamera: false,
    }),
  stop: () => set({ active: false, plan: null, mode: null, simulate: false }),
  setMuted: (muted) => set({ muted }),
  setFollow: (follow) => set({ follow }),
  setFreeCamera: (freeCamera) => set({ freeCamera }),
  setGuidance: (guidance) => set({ guidance }),
}));
