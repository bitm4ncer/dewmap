"use client";

import { HudPanel } from "./HudPanel";
import { HistoryFilters } from "./HistoryFilters";
import { HistoryTimeline } from "./HistoryTimeline";
import { panelSummary } from "@/lib/history/panel-state";
import type { HistoricCategory } from "@/lib/history/types";

interface HistoryPanelProps {
  year: number;
  onYearChange: (year: number) => void;
  earliestVisibleYear: number | null;
  visibleCount: number;
  loading: boolean;

  globalStatus: "idle" | "loading" | "ready" | "error";
  globalCount: number;
  globalTotal: number;
  globalDataAsOf: string | null;
  categories: readonly HistoricCategory[];
  onCategoriesChange: (categories: HistoricCategory[]) => void;
  heritageOnly: boolean;
  onHeritageOnlyChange: (on: boolean) => void;
  unescoOnly: boolean;
  onUnescoOnlyChange: (on: boolean) => void;

  mapOn: boolean;
  onMapOnChange: (on: boolean) => void;

  landmarksOn: boolean;
  landmarksOpacity: number;
  onLandmarksOnChange: (on: boolean) => void;
  onLandmarksOpacityChange: (o: number) => void;
}

function Switch({
  label,
  on,
  onChange,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} on/off`}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="hud-switch"
      data-on={on}
      data-disabled={disabled}
    >
      <span className="hud-switch-thumb" aria-hidden />
    </button>
  );
}

export function HistoryPanel(props: HistoryPanelProps) {
  const globalReady = props.globalStatus === "ready";
  const showYearSlider = props.mapOn || props.landmarksOn || globalReady;
  const shownCount =
    globalReady && props.globalCount > 0
      ? props.globalCount
      : globalReady
        ? props.globalTotal
        : props.visibleCount;
  const parsedDataAsOf = props.globalDataAsOf
    ? new Date(props.globalDataAsOf)
    : null;
  const dataAsOf =
    parsedDataAsOf && !Number.isNaN(parsedDataAsOf.getTime())
      ? parsedDataAsOf.toISOString().slice(0, 10)
      : null;
  return (
    <div className="flex flex-col gap-3">
      {showYearSlider && (
        <HudPanel>
          <HistoryTimeline
            year={props.year}
            onYearChange={props.onYearChange}
            earliestVisibleYear={props.earliestVisibleYear}
            visibleCount={shownCount}
            loading={
              (!globalReady && props.loading) ||
              (props.globalStatus === "loading" && !props.landmarksOn)
            }
          />
        </HudPanel>
      )}

      <HudPanel>
        <div className="ui-section">
          <span className="ui-kicker">Time travel</span>
          <div className="ui-row">
            <div className="ui-row-main">
              <div className="ui-row-title">Historical map</div>
              <div className="ui-row-sub">
                Replaces the basemap with OpenHistoricalMap&apos;s sepia
                historical style for the chosen year — including period-aware
                political borders, settlements and roads where mapped.
              </div>
            </div>
            <Switch
              label="Historical map"
              on={props.mapOn}
              onChange={props.onMapOnChange}
            />
          </div>
        </div>
      </HudPanel>

      <HudPanel>
        <div className="ui-section">
          <span className="ui-kicker">Heritage worldwide</span>
          <div className="ui-row">
            <div className="ui-row-main">
              <div className="ui-row-title">Historic sites</div>
              <div className="ui-row-sub">
                A curated Wikidata heritage layer with clusters at world and
                country scale, individual sites from city scale, and
                Wikipedia/Commons detail on tap.
              </div>
            </div>
            <span
              className="hud-mono text-[11px] text-[color:var(--ink-dim)]"
              data-state={props.globalStatus}
            >
              {props.globalStatus === "error"
                ? "offline"
                : panelSummary({
                    status: props.globalStatus,
                    count: props.globalCount,
                    total: props.globalTotal,
                    filters: {
                      heritageOnly: props.heritageOnly,
                      unescoOnly: props.unescoOnly,
                      categories: props.categories,
                    },
                  })}
            </span>
          </div>

          {props.globalStatus === "error" && (
            <p className="text-[13px] leading-relaxed text-[color:var(--ink-dim)]">
              Global dataset unavailable — local OSM detail only.
            </p>
          )}

          {props.globalStatus === "ready" && (
            <>
              <div className="ui-row">
                <div className="ui-row-main">
                  <div className="ui-row-title">Heritage only</div>
                  <div className="ui-row-sub">
                    Show only sites with a heritage designation.
                  </div>
                </div>
                <Switch
                  label="Heritage only"
                  on={props.heritageOnly}
                  onChange={props.onHeritageOnlyChange}
                />
              </div>
              <div className="ui-row">
                <div className="ui-row-main">
                  <div className="ui-row-title">UNESCO only</div>
                  <div className="ui-row-sub">
                    World Heritage Sites only.
                  </div>
                </div>
                <Switch
                  label="UNESCO only"
                  on={props.unescoOnly}
                  onChange={props.onUnescoOnlyChange}
                />
              </div>
              <HistoryFilters
                categories={props.categories}
                onCategoriesChange={props.onCategoriesChange}
              />
              <p className="hud-mono text-[11px] text-[color:var(--ink-dim)]">
                Year and category filters apply from city zoom (z8).
                {dataAsOf ? ` Data as of ${dataAsOf}.` : ""}
              </p>
            </>
          )}

          <div className="ui-row">
            <div className="ui-row-main">
              <div className="ui-row-title">Local OSM detail</div>
              <div className="ui-row-sub">
                {globalReady
                  ? "Covered by the global dataset in v1; local OSM returns at z11+ in v1.1."
                  : "Legacy live OSM/Wikidata detail when the global dataset is unavailable."}
              </div>
            </div>
            <Switch
              label="Local OSM detail"
              on={props.landmarksOn}
              onChange={props.onLandmarksOnChange}
              disabled={globalReady}
            />
          </div>

          {props.landmarksOn && !globalReady && (
            <div className="flex items-center gap-3">
              <span className="hud-label w-14 shrink-0">Opacity</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={props.landmarksOpacity}
                onChange={(e) =>
                  props.onLandmarksOpacityChange(Number(e.target.value))
                }
                className="hud-slider flex-1"
                style={{
                  ["--hud-fill" as string]: `${Math.round(
                    props.landmarksOpacity * 100,
                  )}%`,
                }}
                aria-label="Historic landmarks opacity"
              />
              <span className="hud-mono w-10 shrink-0 text-right text-[12px] text-[color:var(--ink-dim)]">
                {Math.round(props.landmarksOpacity * 100)}%
              </span>
            </div>
          )}

          <p className="text-[13px] leading-relaxed text-[color:var(--ink-dim)]">
            Heritage sites are clustered at low zoom; tap a cluster to zoom
            in. Site dots are coloured by heritage/UNESCO status. The year
            slider hides sites that did not exist yet; undated sites remain
            visible with a muted style.
          </p>
        </div>
      </HudPanel>
    </div>
  );
}
