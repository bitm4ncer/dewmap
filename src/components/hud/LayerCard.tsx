"use client";

import type { ReactNode } from "react";
import { HudPanel } from "./HudPanel";
import { Spinner } from "../ui/Spinner";

export interface LegendSpec {
  gradient: string;
  minLabel: string;
  midLabel?: string;
  maxLabel: string;
  unit?: string;
}

export interface SwatchSpec {
  swatches: { color: string; label: string }[];
  unit?: string;
}

export interface LayerCardProps {
  label: string;
  icon?: ReactNode;
  caption: ReactNode;
  on: boolean;
  opacity: number;
  status: ReactNode | null;
  legend?: LegendSpec;
  swatches?: SwatchSpec;
  extras?: ReactNode;
  footer?: ReactNode;
  /** Hide the opacity row even when the layer is on (e.g. warnings). */
  hideOpacity?: boolean;
  onToggle: (on: boolean) => void;
  onOpacityChange: (o: number) => void;
}

/**
 * One overlay row in a HUD panel: title, switch, opacity, controls, caption,
 * legend and a status line. Shared by the Nature (Biosphere) panel and the
 * weather overlays so every layer reads the same.
 */
export function LayerCard({
  label,
  icon,
  caption,
  on,
  opacity,
  status,
  legend,
  swatches,
  extras,
  footer,
  hideOpacity = false,
  onToggle,
  onOpacityChange,
}: LayerCardProps) {
  return (
    <HudPanel>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {icon && (
              <span
                className={
                  on ? "text-[color:var(--accent)]" : "text-[color:var(--ink-dim)]"
                }
              >
                {icon}
              </span>
            )}
            <h3 className="text-[14px] font-semibold text-[color:var(--ink)]">
              {label}
            </h3>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`${label} on/off`}
            onClick={() => onToggle(!on)}
            className="hud-switch"
            data-on={on}
          >
            <span className="hud-switch-thumb" aria-hidden />
          </button>
        </div>

        {on && !hideOpacity && (
          <div className="flex items-center gap-2">
            <span className="hud-label w-12 shrink-0">Opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => onOpacityChange(Number(e.target.value))}
              className="hud-slider flex-1"
              style={{ ["--hud-fill" as string]: `${Math.round(opacity * 100)}%` }}
              aria-label={`${label} opacity`}
            />
            <span className="hud-mono w-9 shrink-0 text-right text-[11.5px] text-[color:var(--ink-dim)]">
              {Math.round(opacity * 100)}%
            </span>
          </div>
        )}

        {extras}

        <p className="text-[12px] leading-snug text-[color:var(--ink-dim)]">
          {caption}
        </p>

        {legend && on && <LegendBar spec={legend} />}
        {swatches && on && <SwatchGrid spec={swatches} />}

        {status
          && (typeof status === "string" && status.startsWith("resolving") ? (
            <span
              className="ui-loading-inline hud-mono text-[11.5px] text-[color:var(--ink-mute)]"
              role="status"
              aria-live="polite"
            >
              <Spinner size={12} />
              <span>{status}</span>
            </span>
          ) : (
            <p className="hud-mono text-[11.5px] text-[color:var(--ink-mute)]">
              {status}
            </p>
          ))}

        {footer}
      </div>
    </HudPanel>
  );
}

export function LegendBar({ spec }: { spec: LegendSpec }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-[10px] bg-[color:var(--surf-2)] p-2"
      aria-label="Legend"
    >
      <div
        className="h-1.5 w-full rounded-full"
        style={{ background: spec.gradient }}
        aria-hidden
      />
      <div className="flex justify-between text-[11.5px] text-[color:var(--ink-mute)]">
        <span>{spec.minLabel}</span>
        {spec.midLabel && <span>{spec.midLabel}</span>}
        <span>{spec.maxLabel}</span>
      </div>
      {spec.unit && (
        <span className="hud-mono text-[11.5px] text-[color:var(--ink-mute)]">
          {spec.unit}
        </span>
      )}
    </div>
  );
}

export function SwatchGrid({ spec }: { spec: SwatchSpec }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-[10px] bg-[color:var(--surf-2)] p-2"
      aria-label="Class legend"
    >
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {spec.swatches.map((s) => (
          <div key={s.label} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="text-[11.5px] text-[color:var(--ink-dim)]">
              {s.label}
            </span>
          </div>
        ))}
      </div>
      {spec.unit && (
        <span className="hud-mono text-[11.5px] text-[color:var(--ink-mute)]">
          {spec.unit}
        </span>
      )}
    </div>
  );
}
