"use client";

import type { Map as MLMap } from "maplibre-gl";
import { HikingPanel } from "./HikingPanel";
import { CarPanel } from "@/components/planner/CarPanel";
import { TransitPanel } from "@/components/planner/TransitPanel";
import { useHiking } from "@/lib/hiking/store";
import {
  BROUTER_PROFILES,
  profileMode,
  type BrouterProfile,
} from "@/lib/hiking/routing";

export type RoutesMode = "walk" | "bike" | "car" | "transit";

const MODES: { id: RoutesMode; label: string }[] = [
  { id: "transit", label: "Train" },
  { id: "walk", label: "Walk" },
  { id: "bike", label: "Bike" },
  { id: "car", label: "Car" },
];

function defaultProfileFor(mode: "walk" | "bike"): BrouterProfile {
  const match = BROUTER_PROFILES.find((p) => p.mode === mode);
  return match?.id ?? "hiking-beta";
}

interface Props {
  mapRef: React.MutableRefObject<MLMap | null>;
  mode: RoutesMode;
  onModeChange: (mode: RoutesMode) => void;
}

export function RoutesPanel({ mapRef, mode, onModeChange }: Props) {
  const profile = useHiking((s) => s.profile);
  const setProfile = useHiking((s) => s.setProfile);

  const choose = (next: RoutesMode) => {
    onModeChange(next);
    if (next === "walk" || next === "bike") {
      if (profileMode(profile) !== next) setProfile(defaultProfileFor(next));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="ui-segmented" role="group" aria-label="Travel mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className="ui-seg"
            data-active={mode === m.id}
            aria-pressed={mode === m.id}
            onClick={() => choose(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "car" ? (
        <CarPanel mapRef={mapRef} />
      ) : mode === "transit" ? (
        <TransitPanel mapRef={mapRef} />
      ) : (
        <HikingPanel
          key={mode}
          mapRef={mapRef}
          hideModeSwitch
        />
      )}
    </div>
  );
}
