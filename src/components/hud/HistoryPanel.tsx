"use client";

import { HudPanel } from "./HudPanel";
import { HistoryTimeline } from "./HistoryTimeline";

interface HistoryPanelProps {
  year: number;
  onYearChange: (year: number) => void;
  earliestVisibleYear: number | null;
  visibleCount: number;
  loading: boolean;

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
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={`${label} on/off`}
      onClick={() => onChange(!on)}
      className="hud-switch"
      data-on={on}
    >
      <span className="hud-switch-thumb" aria-hidden />
    </button>
  );
}

export function HistoryPanel(props: HistoryPanelProps) {
  const showYearSlider = props.mapOn || props.landmarksOn;
  return (
    <div className="flex flex-col gap-3">
      {showYearSlider && (
        <HudPanel>
          <HistoryTimeline
            year={props.year}
            onYearChange={props.onYearChange}
            earliestVisibleYear={props.earliestVisibleYear}
            visibleCount={props.visibleCount}
            loading={props.loading}
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
          <span className="ui-kicker">Landmarks</span>
          <div className="ui-row">
            <div className="ui-row-main">
              <div className="ui-row-title">Historic sites</div>
              <div className="ui-row-sub">
                Castles, ruins, monuments, archaeological sites and
                battlefields from OSM and Wikidata.
              </div>
            </div>
            <Switch
              label="Historic landmarks"
              on={props.landmarksOn}
              onChange={props.onLandmarksOnChange}
            />
          </div>

          {props.landmarksOn && (
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
            <span
              className="inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: "var(--landmark-wikidata)" }}
            />{" "}
            Wikidata (named, dated, links to Wikipedia){" "}
            <span
              className="inline-block h-2 w-2 rounded-full align-middle"
              style={{ background: "var(--landmark-osm)" }}
            />{" "}
            OpenStreetMap <span className="hud-mono">historic=*</span>. Tap a
            marker for its summary and, where available, a photo. The year
            slider hides sites that did not exist yet.
          </p>
        </div>
      </HudPanel>
    </div>
  );
}
