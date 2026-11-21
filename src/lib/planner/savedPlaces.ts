"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Home, work and manually saved places, shared by every route planner.
 * Persisted to localStorage like the other app stores.
 */
export interface SavedPlace {
  name: string;
  lat: number;
  lon: number;
  id?: string;
  city?: string;
}

interface SavedPlacesState {
  home: SavedPlace | null;
  work: SavedPlace | null;
  saved: SavedPlace[];
  setHome: (place: SavedPlace | null) => void;
  setWork: (place: SavedPlace | null) => void;
  toggleSaved: (place: SavedPlace) => void;
}

export const SAVED_PLACES_MAX = 12;

export function savedPlaceKey(place: SavedPlace): string {
  return `${place.name.trim().toLowerCase()}@${place.lat.toFixed(5)},${place.lon.toFixed(5)}`;
}

export const useSavedPlaces = create<SavedPlacesState>()(
  persist(
    (set) => ({
      home: null,
      work: null,
      saved: [],
      setHome: (home) => set({ home }),
      setWork: (work) => set({ work }),
      toggleSaved: (place) =>
        set((s) => {
          const key = savedPlaceKey(place);
          const exists = s.saved.some((p) => savedPlaceKey(p) === key);
          return {
            saved: exists
              ? s.saved.filter((p) => savedPlaceKey(p) !== key)
              : [place, ...s.saved].slice(0, SAVED_PLACES_MAX),
          };
        }),
    }),
    {
      name: "dewmap.saved-places",
      version: 1,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
