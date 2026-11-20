"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { RoutePlan } from "../routing";
import type { PlannerPhase } from "./carStore";
import { bestJourneyId, type JourneySort } from "./transitFormat";
import { migrateLegacyStorage } from "../legacyStorage";

migrateLegacyStorage();

export interface TransitPlace {
  name: string;
  lat: number;
  lon: number;
  id?: string;
  city?: string;
  /** "address" means lat/lon belongs to an address; "stop" is a station. */
  kind?: "address" | "stop";
}

export interface TransitPageMeta {
  nextPageCursor?: string;
  previousPageCursor?: string;
}

interface TransitState {
  from: TransitPlace | null;
  to: TransitPlace | null;
  /** Ordered intermediate stations, at most two (MOTIS limit). A null slot keeps the editor open. */
  via: (TransitPlace | null)[];
  /** ISO local datetime string (`YYYY-MM-DDTHH:mm`) or empty for "now". */
  when: string;
  arriveBy: boolean;
  maxTransfers: number;
  wheelchair: boolean;
  cityFilter: string;
  sort: JourneySort;
  maxWalkMin: number;
  modes: string[];
  accessible: boolean;
  bike: boolean;
  autoRefresh: boolean;
  /** Show real-time vehicle positions on the map. */
  liveVehicles: boolean;
  liveVehicleCount: number;
  liveVehiclesUpdatedAt: number | null;
  liveVehiclesError: string | null;
  journeys: RoutePlan[];
  selectedId: string | null;
  phase: PlannerPhase;
  notice: string | null;
  /** Results exist but were produced before the current input. */
  stale: boolean;
  lastSearchedAt: number | null;
  nextCursor: string | null;
  previousCursor: string | null;
  favorites: TransitPlace[];
  recents: TransitPlace[];
  /** Bumped when another mode hands over a ready-to-run transit search. */
  searchToken: number;

  setFrom: (p: TransitPlace | null) => void;
  setTo: (p: TransitPlace | null) => void;
  setRouteInput: (
    from: TransitPlace | null,
    to: TransitPlace | null,
    via: TransitPlace[],
  ) => void;
  requestSearch: () => void;
  addVia: (p: TransitPlace) => void;
  setVia: (places: TransitPlace[]) => void;
  setViaAt: (index: number, p: TransitPlace | null) => void;
  removeVia: (index: number) => void;
  swap: () => void;
  setWhen: (w: string) => void;
  setArriveBy: (v: boolean) => void;
  setMaxTransfers: (n: number) => void;
  setWheelchair: (v: boolean) => void;
  setCityFilter: (v: string) => void;
  setSort: (s: JourneySort) => void;
  setMaxWalkMin: (n: number) => void;
  setModes: (modes: string[]) => void;
  setAccessible: (v: boolean) => void;
  setBike: (v: boolean) => void;
  setAutoRefresh: (v: boolean) => void;
  setLiveVehicles: (v: boolean) => void;
  setLiveVehicleStatus: (count: number, updatedAt: number | null) => void;
  setLiveVehiclesError: (message: string | null) => void;
  setJourneys: (j: RoutePlan[], meta?: TransitPageMeta) => void;
  selectJourney: (id: string | null) => void;
  setPhase: (p: PlannerPhase) => void;
  setNotice: (n: string | null) => void;
  markStale: () => void;
  toggleFavorite: (place: TransitPlace) => void;
  rememberPlace: (place: TransitPlace) => void;
  reset: () => void;
}

/** Local datetime input value, second precision removed. No rounding. */
export function nowLocalInput(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** @deprecated Use `nowLocalInput`; kept for existing callers/tests. */
const defaultWhen = nowLocalInput;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function placeKey(place: TransitPlace): string {
  return `${place.name.trim().toLowerCase()}|${place.lat.toFixed(5)}|${place.lon.toFixed(5)}`;
}

function isPlace(value: unknown): value is TransitPlace {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.name === "string"
    && p.name.trim().length > 0
    && typeof p.lat === "number"
    && Number.isFinite(p.lat)
    && Math.abs(p.lat) <= 90
    && typeof p.lon === "number"
    && Number.isFinite(p.lon)
    && Math.abs(p.lon) <= 180
    && (p.kind === undefined || p.kind === "address" || p.kind === "stop")
  );
}

function validPlaces(value: unknown, max: number): TransitPlace[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: TransitPlace[] = [];
  for (const entry of value) {
    if (!isPlace(entry)) continue;
    const key = placeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
    if (result.length >= max) break;
  }
  return result;
}

const initialState = {
  from: null,
  to: null,
  via: [] as (TransitPlace | null)[],
  when: "",
  arriveBy: false,
  maxTransfers: 3,
  wheelchair: false,
  cityFilter: "",
  sort: "best" as JourneySort,
  maxWalkMin: 30,
  modes: [] as string[],
  accessible: false,
  bike: false,
  autoRefresh: false,
  liveVehicles: false,
  liveVehicleCount: 0,
  liveVehiclesUpdatedAt: null as number | null,
  liveVehiclesError: null as string | null,
  journeys: [] as RoutePlan[],
  selectedId: null,
  phase: { kind: "idle" } as PlannerPhase,
  notice: null,
  stale: false,
  lastSearchedAt: null,
  nextCursor: null,
  previousCursor: null,
  favorites: [] as TransitPlace[],
  recents: [] as TransitPlace[],
  searchToken: 0,
};

function invalidate(
  state: TransitState,
): Pick<TransitState, "stale" | "notice" | "nextCursor" | "previousCursor"> {
  return {
    stale: state.journeys.length > 0,
    notice: null,
    nextCursor: null,
    previousCursor: null,
  };
}

export const useTransit = create<TransitState>()(
  persist(
    (set) => ({
      ...initialState,

      setFrom: (from) =>
        set({
          from,
          journeys: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
          stale: false,
          lastSearchedAt: null,
          nextCursor: null,
          previousCursor: null,
        }),
      setTo: (to) =>
        set({
          to,
          journeys: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
          stale: false,
          lastSearchedAt: null,
          nextCursor: null,
          previousCursor: null,
        }),
      setRouteInput: (from, to, via) =>
        set({
          from,
          to,
          via: via.slice(0, 2),
          journeys: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
          stale: false,
          lastSearchedAt: null,
          nextCursor: null,
          previousCursor: null,
        }),
      requestSearch: () =>
        set((s) => ({ searchToken: s.searchToken + 1 })),
      addVia: (place) =>
        set((s) => {
          if (s.via.some((entry) => entry && placeKey(entry) === placeKey(place))) {
            return {};
          }
          const via = [...s.via];
          const empty = via.findIndex((entry) => entry === null);
          if (empty >= 0) via[empty] = place;
          else if (via.length < 2) via.push(place);
          else return {};
          return {
            via: via.slice(0, 2),
            journeys: [],
            selectedId: null,
            phase: { kind: "idle" },
            notice: null,
            stale: false,
            lastSearchedAt: null,
            nextCursor: null,
            previousCursor: null,
          };
        }),
      setVia: (places) =>
        set({
          via: places.slice(0, 2),
          journeys: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
          stale: false,
          lastSearchedAt: null,
          nextCursor: null,
          previousCursor: null,
        }),
      setViaAt: (index, place) =>
        set((s) => {
          if (index < 0 || index > 1) return {};
          const via = [...s.via];
          while (via.length <= index) via.push(null);
          via[index] = place;
          return {
            via: via.slice(0, 2),
            journeys: [],
            selectedId: null,
            phase: { kind: "idle" },
            notice: null,
            stale: false,
            lastSearchedAt: null,
            nextCursor: null,
            previousCursor: null,
          };
        }),
      removeVia: (index) =>
        set((s) => ({
          via: s.via.filter((_, i) => i !== index).slice(0, 2),
          journeys: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
          stale: false,
          lastSearchedAt: null,
          nextCursor: null,
          previousCursor: null,
        })),
      swap: () =>
        set((s) => ({
          from: s.to,
          to: s.from,
          journeys: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
          stale: false,
          lastSearchedAt: null,
          nextCursor: null,
          previousCursor: null,
        })),
      setWhen: (when) => set((s) => ({ when, ...invalidate(s) })),
      setArriveBy: (arriveBy) => set((s) => ({ arriveBy, ...invalidate(s) })),
      setMaxTransfers: (maxTransfers) =>
        set((s) => ({ maxTransfers: clamp(maxTransfers, 0, 5), ...invalidate(s) })),
      setWheelchair: (wheelchair) =>
        set((s) => ({ wheelchair, ...invalidate(s) })),
      setCityFilter: (cityFilter) =>
        set((s) => ({ cityFilter, ...invalidate(s) })),
      setSort: (sort) => set({ sort }),
      setMaxWalkMin: (maxWalkMin) =>
        set((s) => ({ maxWalkMin: clamp(maxWalkMin, 0, 60), ...invalidate(s) })),
      setModes: (modes) =>
        set((s) => ({ modes: [...new Set(modes)], ...invalidate(s) })),
      setAccessible: (accessible) =>
        set((s) => ({ accessible, ...invalidate(s) })),
      setBike: (bike) => set((s) => ({ bike, ...invalidate(s) })),
      setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
      setLiveVehicles: (liveVehicles) =>
        set({ liveVehicles, liveVehiclesError: null }),
      setLiveVehicleStatus: (count, updatedAt) =>
        set({
          liveVehicleCount: Math.max(0, Math.round(count)),
          liveVehiclesUpdatedAt: updatedAt,
        }),
      setLiveVehiclesError: (liveVehiclesError) =>
        set({ liveVehiclesError }),
      setJourneys: (journeys, meta) =>
        set((s) => {
          const keep =
            s.selectedId != null
            && journeys.some((j) => j.id === s.selectedId);
          return {
            journeys,
            selectedId: keep ? s.selectedId : bestJourneyId(journeys),
            phase: { kind: "routed" },
            stale: false,
            notice: null,
            lastSearchedAt: Date.now(),
            nextCursor: meta?.nextPageCursor ?? null,
            previousCursor: meta?.previousPageCursor ?? null,
          };
        }),
      selectJourney: (selectedId) => set({ selectedId }),
      setPhase: (phase) => set({ phase }),
      setNotice: (notice) => set({ notice }),
      markStale: () =>
        set((s) => ({
          stale: s.journeys.length > 0,
          nextCursor: null,
          previousCursor: null,
        })),
      toggleFavorite: (place) =>
        set((s) => {
          const key = placeKey(place);
          const exists = s.favorites.some((p) => placeKey(p) === key);
          return {
            favorites: exists
              ? s.favorites.filter((p) => placeKey(p) !== key)
              : [place, ...s.favorites].slice(0, 12),
          };
        }),
      rememberPlace: (place) =>
        set((s) => ({
          recents: [place, ...s.recents.filter((p) => placeKey(p) !== placeKey(place))].slice(
            0,
            8,
          ),
        })),
      reset: () =>
        set((s) => ({
          ...initialState,
          favorites: s.favorites,
          recents: s.recents,
        })),
    }),
    {
      name: "kugelmaps:transit",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        from: s.from,
        to: s.to,
        via: s.via,
        arriveBy: s.arriveBy,
        maxTransfers: s.maxTransfers,
        wheelchair: s.wheelchair,
        cityFilter: s.cityFilter,
        sort: s.sort,
        maxWalkMin: s.maxWalkMin,
        modes: s.modes,
        accessible: s.accessible,
        bike: s.bike,
        autoRefresh: s.autoRefresh,
        liveVehicles: s.liveVehicles,
        favorites: s.favorites,
        recents: s.recents,
      }),
      merge: (persisted, current) => {
        const p = (
          typeof persisted === "object" && persisted !== null ? persisted : {}
        ) as Partial<TransitState>;
        return {
          ...current,
          from: isPlace(p.from) ? p.from : null,
          to: isPlace(p.to) ? p.to : null,
          via: validPlaces(p.via, 2),
          arriveBy: typeof p.arriveBy === "boolean" ? p.arriveBy : current.arriveBy,
          maxTransfers:
            typeof p.maxTransfers === "number"
              ? clamp(p.maxTransfers, 0, 5)
              : current.maxTransfers,
          wheelchair:
            typeof p.wheelchair === "boolean" ? p.wheelchair : current.wheelchair,
          cityFilter:
            typeof p.cityFilter === "string" ? p.cityFilter : current.cityFilter,
          sort:
            p.sort === "best"
            || p.sort === "departure"
            || p.sort === "arrival"
            || p.sort === "duration"
            || p.sort === "transfers"
              ? p.sort
              : current.sort,
          maxWalkMin:
            typeof p.maxWalkMin === "number"
              ? clamp(p.maxWalkMin, 0, 60)
              : current.maxWalkMin,
          modes: Array.isArray(p.modes)
            ? p.modes.filter((m): m is string => typeof m === "string")
            : current.modes,
          accessible:
            typeof p.accessible === "boolean" ? p.accessible : current.accessible,
          bike: typeof p.bike === "boolean" ? p.bike : current.bike,
          autoRefresh:
            typeof p.autoRefresh === "boolean" ? p.autoRefresh : current.autoRefresh,
          liveVehicles:
            typeof p.liveVehicles === "boolean"
              ? p.liveVehicles
              : current.liveVehicles,
          liveVehicleCount: 0,
          liveVehiclesUpdatedAt: null,
          liveVehiclesError: null,
          favorites: validPlaces(p.favorites, 12),
          recents: validPlaces(p.recents, 8),
          journeys: [],
          selectedId: null,
          phase: { kind: "idle" },
          notice: null,
          stale: false,
          lastSearchedAt: null,
          nextCursor: null,
          previousCursor: null,
        };
      },
    },
  ),
);

export { defaultWhen };
