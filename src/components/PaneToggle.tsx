import type { ReactNode } from "react";

interface PaneToggleProps {
  active: boolean;
  label: string;
  onToggle: () => void;
  /** Visual variant — `tab` is the large mobile sheet tab, `panel` is
   *  the desktop panel tab. */
  variant: "tab" | "panel";
  children: ReactNode;
}

export function PaneToggle({
  active,
  label,
  onToggle,
  variant,
  children,
}: PaneToggleProps) {
  const className = variant === "panel" ? "hud-panel-tab" : "hud-sheet-tab";
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
      <span className="hud-tab-label">{label}</span>
    </button>
  );
}
