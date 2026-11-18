import type { ReactNode } from "react";

interface PaneToggleProps {
  active: boolean;
  label: string;
  onToggle: () => void;
  /** Visual variant — `tab` is the large mobile sheet tab, `panel` is
   *  the desktop panel tab. `handle` remains for legacy callers. */
  variant: "handle" | "tab" | "panel";
  children: ReactNode;
}

export function PaneToggle({
  active,
  label,
  onToggle,
  variant,
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
      className={`${className} pointer-events-auto`}
    >
      {children}
      {variant !== "handle" && <span className="hud-tab-label">{label}</span>}
    </button>
  );
}
