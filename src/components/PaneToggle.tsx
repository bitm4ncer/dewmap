import type { ReactNode } from "react";

interface PaneToggleProps {
  active: boolean;
  label: string;
  onToggle: () => void;
  /** Visual variant — `tab` is the large mobile sheet tab, `panel` is
   *  the desktop panel tab. `handle` remains for legacy callers. */
  variant: "handle" | "tab" | "panel";
  /** Pane key — controls the signature colour dot via [data-pane]. */
  pane: "map" | "biosphere" | "history" | "hiking";
  children: ReactNode;
}

export function PaneToggle({
  active,
  label,
  onToggle,
  variant,
  pane,
  children,
}: PaneToggleProps) {
  const className =
    variant === "handle"
      ? "hud-handle"
      : variant === "panel"
        ? "hud-panel-tab"
        : "hud-sheet-tab";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={active}
      data-active={active}
      data-pane={pane}
      className={`${className} pointer-events-auto`}
    >
      {children}
      {variant !== "handle" && <span className="hud-tab-label">{label}</span>}
    </button>
  );
}
