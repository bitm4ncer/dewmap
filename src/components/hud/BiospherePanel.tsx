"use client";

import { LayerCard, type LegendSpec, type SwatchSpec } from "./LayerCard";
import { WeatherPanel } from "./WeatherPanel";
import {
  AirQualityIcon,
  ForestLossIcon,
  LandCoverIcon,
  NaturaIcon,
  NdviIcon,
  SpeciesIcon,
} from "@/components/ui/icons";

interface SpeciesTaxonOption {
  key: string | null;
  label: string;
}

interface BiospherePanelProps {
  // NDVI (NASA GIBS · MODIS Terra 8-day)
  ndviOn: boolean;
  ndviOpacity: number;
  onNdviOnChange: (on: boolean) => void;
  onNdviOpacityChange: (o: number) => void;

  // Species (GBIF)
  speciesOn: boolean;
  speciesOpacity: number;
  speciesTaxonKey: string | null;
  speciesTaxonOptions: readonly SpeciesTaxonOption[];
  onSpeciesOnChange: (on: boolean) => void;
  onSpeciesOpacityChange: (o: number) => void;
  onSpeciesTaxonKeyChange: (key: string | null) => void;

  // Forest Loss (Global Forest Watch)
  forestLossOn: boolean;
  forestLossOpacity: number;
  forestLossProbeFinished: boolean;
  forestLossResolvedLabel: string | null;
  onForestLossOnChange: (on: boolean) => void;
  onForestLossOpacityChange: (o: number) => void;

  // NO₂ (NASA OMI / Sentinel-5P)
  no2On: boolean;
  no2Opacity: number;
  no2ProbeFinished: boolean;
  no2ResolvedLabel: string | null;
  no2ResolvedDate: string | null;
  onNo2OnChange: (on: boolean) => void;
  onNo2OpacityChange: (o: number) => void;

  // Natura 2000 (EEA)
  naturaSitesOn: boolean;
  naturaSitesOpacity: number;
  naturaProbeFinished: boolean;
  naturaResolvedLabel: string | null;
  onNaturaSitesOnChange: (on: boolean) => void;
  onNaturaSitesOpacityChange: (o: number) => void;

  // Land Cover (ESA WorldCover)
  landCoverOn: boolean;
  landCoverOpacity: number;
  onLandCoverOnChange: (on: boolean) => void;
  onLandCoverOpacityChange: (o: number) => void;
}

const SPECIES_GRADIENT =
  "linear-gradient(to right, #fde047, #fb923c, #ef4444, #7f1d1d)";

const NDVI_GRADIENT =
  "linear-gradient(to right, #c89674, #f6d75c, #b9d860, #5fa83a, #1f5e1f)";

const FOREST_LOSS_LEGENDS: Record<string, LegendSpec> = {
  "GLAD-DIST integrated alerts": {
    gradient: "linear-gradient(to right, #67e8f9, #22d3ee, #1e40af)",
    minLabel: "low confidence",
    midLabel: "moderate",
    maxLabel: "high confidence",
    unit: "vegetation disturbance",
  },
  "GLAD-L weekly alerts": {
    gradient: "linear-gradient(to right, #fed7aa, #fb923c, #b91c1c)",
    minLabel: "older",
    midLabel: "this month",
    maxLabel: "this week",
    unit: "tree-cover loss alerts",
  },
  "Hansen tree-cover loss (≥30 %)": {
    gradient: "linear-gradient(to right, #fbcfe8, #ec4899, #581c87)",
    minLabel: "2001",
    midLabel: "2013",
    maxLabel: "2024",
    unit: "year of tree-cover loss",
  },
};
const FOREST_LOSS_LEGEND_FALLBACK: LegendSpec = {
  gradient: "linear-gradient(to right, #67e8f9, #22d3ee, #1e40af)",
  minLabel: "older",
  maxLabel: "recent",
  unit: "tree-cover / disturbance",
};

const NO2_GRADIENT =
  "linear-gradient(to right, #1e3a8a, #06b6d4, #fde047, #fb923c, #b91c1c)";

const NATURA_SWATCHES: SwatchSpec = {
  swatches: [
    { color: "#16a34a", label: "FFH (Habitats Directive)" },
    { color: "#a855f7", label: "SPA (Birds Directive)" },
  ],
  unit: "EEA Natura 2000 · default WMS style",
};

const LAND_COVER_SWATCHES: SwatchSpec = {
  swatches: [
    { color: "#006400", label: "Tree cover" },
    { color: "#ffbb22", label: "Shrubland" },
    { color: "#ffff4c", label: "Grassland" },
    { color: "#f096ff", label: "Cropland" },
    { color: "#fa0000", label: "Built-up" },
    { color: "#0064c8", label: "Water" },
    { color: "#0096a0", label: "Wetland" },
    { color: "#00cf75", label: "Mangroves" },
    { color: "#fae6a0", label: "Sparse / bare" },
  ],
  unit: "ESA WorldCover 2021 · 10 m",
};

export function BiospherePanel(props: BiospherePanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="hud-label px-1">Weather</h2>
      <WeatherPanel />

      <div className="flex items-center gap-2 px-1">
        <span className="h-px flex-1 bg-[color:var(--surf-3)]" aria-hidden />
        <h2 className="hud-label">Biosphere</h2>
        <span className="h-px flex-1 bg-[color:var(--surf-3)]" aria-hidden />
      </div>

      <LayerCard
        label="Land Cover"
        icon={<LandCoverIcon size={16} />}
        on={props.landCoverOn}
        opacity={props.landCoverOpacity}
        onToggle={props.onLandCoverOnChange}
        onOpacityChange={props.onLandCoverOpacityChange}
        caption="ESA WorldCover 2021 · 10 m · global · 11 classes incl. cropland"
        status={null}
        swatches={LAND_COVER_SWATCHES}
      />

      <LayerCard
        label="NDVI"
        icon={<NdviIcon size={16} />}
        on={props.ndviOn}
        opacity={props.ndviOpacity}
        onToggle={props.onNdviOnChange}
        onOpacityChange={props.onNdviOpacityChange}
        caption="Vegetation greenness · MODIS Terra · 8-day · 1 km · global"
        status={props.ndviOn ? "NASA GIBS · MODIS_Terra_NDVI_8Day" : null}
        legend={{
          gradient: NDVI_GRADIENT,
          minLabel: "bare / water",
          midLabel: "moderate",
          maxLabel: "dense canopy",
          unit: "NDVI",
        }}
      />

      <LayerCard
        label="Species"
        icon={<SpeciesIcon size={16} />}
        on={props.speciesOn}
        opacity={props.speciesOpacity}
        onToggle={props.onSpeciesOnChange}
        onOpacityChange={props.onSpeciesOpacityChange}
        caption="Live biodiversity observations · GBIF · 2 B+ records · global"
        status={props.speciesOn ? "density tiles · classic-point style" : null}
        legend={{
          gradient: SPECIES_GRADIENT,
          minLabel: "few",
          midLabel: "many",
          maxLabel: "very many",
          unit: "observations / tile",
        }}
        extras={
          props.speciesOn && (
            <div className="flex flex-col gap-2">
              <span className="hud-label">Taxon</span>
              <div className="hud-variant-chips no-scrollbar" role="radiogroup" aria-label="Taxonomic filter">
                {props.speciesTaxonOptions.map((opt) => {
                  const active = (opt.key ?? null) === (props.speciesTaxonKey ?? null);
                  return (
                    <button
                      key={opt.key ?? "all"}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => props.onSpeciesTaxonKeyChange(opt.key)}
                      data-active={active}
                      className="hud-variant-chip"
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )
        }
      />

      <LayerCard
        label="Forest Loss"
        icon={<ForestLossIcon size={16} />}
        on={props.forestLossOn}
        opacity={props.forestLossOpacity}
        onToggle={props.onForestLossOnChange}
        onOpacityChange={props.onForestLossOpacityChange}
        caption="Recent deforestation alerts · Global Forest Watch / UMD"
        status={
          !props.forestLossOn
            ? null
            : !props.forestLossProbeFinished
              ? "resolving source…"
              : props.forestLossResolvedLabel
                ? props.forestLossResolvedLabel
                : "no source available"
        }
        legend={
          props.forestLossResolvedLabel
            ? FOREST_LOSS_LEGENDS[props.forestLossResolvedLabel] ??
              FOREST_LOSS_LEGEND_FALLBACK
            : FOREST_LOSS_LEGEND_FALLBACK
        }
      />

      <LayerCard
        label="Air Quality · NO₂"
        icon={<AirQualityIcon size={16} />}
        on={props.no2On}
        opacity={props.no2Opacity}
        onToggle={props.onNo2OnChange}
        onOpacityChange={props.onNo2OpacityChange}
        caption="Tropospheric NO₂ column · NASA OMI / Sentinel-5P · daily"
        status={
          !props.no2On
            ? null
            : !props.no2ProbeFinished
              ? "resolving source…"
              : props.no2ResolvedLabel
                ? `${props.no2ResolvedLabel}${props.no2ResolvedDate ? ` · ${props.no2ResolvedDate}` : ""}`
                : "no source available"
        }
        legend={{
          gradient: NO2_GRADIENT,
          minLabel: "low",
          midLabel: "moderate",
          maxLabel: "high",
          unit: "molecules/cm² · 10¹⁵",
        }}
      />

      <LayerCard
        label="Protected Areas"
        icon={<NaturaIcon size={16} />}
        on={props.naturaSitesOn}
        opacity={props.naturaSitesOpacity}
        onToggle={props.onNaturaSitesOnChange}
        onOpacityChange={props.onNaturaSitesOpacityChange}
        caption="Natura 2000 (FFH + Vogelschutzgebiete) · EEA · Europe-wide. Zoom in for individual sites — at low zoom polygons merge visually."
        status={
          !props.naturaSitesOn
            ? null
            : !props.naturaProbeFinished
              ? "resolving WMS layers…"
              : props.naturaResolvedLabel
                ? props.naturaResolvedLabel
                : "no WMS sublayer responded"
        }
        swatches={NATURA_SWATCHES}
      />
    </div>
  );
}
