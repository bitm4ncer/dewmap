"use client";

import type { ReactNode } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { BikeIcon, CarIcon, TransitIcon, WalkIcon } from "@/components/ui/icons";
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

const MODES: { id: RoutesMode; label: string; icon: ReactNode }[] = [
  { id: "transit", label: "Transit", icon: <TransitIcon size={16} /> },
  { id: "walk", label: "Walk", icon: <WalkIcon size={16} /> },
  { id: "bike", label: "Bike", icon: <BikeIcon size={16} /> },
  { id: "car", label: "Car", icon: <CarIcon size={16} /> },
];

function defaultProfileFor(mode: "walk" | "bike"): BrouterProfile {
  const match = BROUTER_PROFILES.find((p) => p.mode === mode);
  return match?.id ?? "hiking-beta";
}

interface Props {
  mapRef: React.MutableRefObject<MLMap | null>;
  mode: RoutesMode;
  onModeChange: (mode: RoutesMode) => void;
  onSearchComplete?: () => void;
}

export function RoutesPanel({
  mapRef,
  mode,
  onModeChange,
  onSearchComplete,
}: Props) {
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
            <span className="inline-flex items-center gap-1.5">
              {m.icon}
              {m.label}
            </span>
          </button>
        ))}
      </div>

      {mode === "car" ? (
        <CarPanel mapRef={mapRef} />
      ) : mode === "transit" ? (
        <TransitPanel mapRef={mapRef} onSearchComplete={onSearchComplete} />
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
