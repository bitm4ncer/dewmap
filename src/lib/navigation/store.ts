"use client";

import { create } from "zustand";
import type { RoutePlan, TravelMode } from "@/lib/routing";

interface NavigationState {
  active: boolean;
  plan: RoutePlan | null;
  mode: TravelMode | null;
  muted: boolean;
  follow: "course" | "north";
  simulate: boolean;
  start: (plan: RoutePlan, options?: { simulate?: boolean; mode?: TravelMode }) => void;
  stop: () => void;
  setMuted: (m: boolean) => void;
  setFollow: (f: "course" | "north") => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  active: false,
  plan: null,
  mode: null,
  muted: false,
  follow: "course",
  simulate: false,
  start: (plan, options) =>
    set({
      active: true,
      plan,
      mode: options?.mode ?? plan.mode,
      simulate: options?.simulate ?? false,
      follow: "course",
    }),
  stop: () => set({ active: false, plan: null, mode: null, simulate: false }),
  setMuted: (muted) => set({ muted }),
  setFollow: (follow) => set({ follow }),
}));
