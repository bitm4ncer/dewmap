import type { IControl } from "maplibre-gl";

export type OrientationMode = "north" | "heading";

export function nextOrientation(mode: OrientationMode): OrientationMode {
  return mode === "north" ? "heading" : "north";
}

interface OrientationControlOptions {
  initial: OrientationMode;
  onChange: (mode: OrientationMode) => void;
}

const TITLE: Record<OrientationMode, string> = {
  north: "Compass: north up — tap to follow your heading",
  heading: "Compass: heading up — tap to lock north",
};

/**
 * Two-state compass control: north-up ↔ heading-up. The map rotation is
 * owned by the bearing effect in Map.tsx; this button only dispatches the
 * mode and visualises the current state.
 */
export class OrientationControl implements IControl {
  private container: HTMLDivElement | null = null;
  private button: HTMLButtonElement | null = null;
  private mode: OrientationMode;
  private readonly onChange: (mode: OrientationMode) => void;

  constructor(options: OrientationControlOptions) {
    this.mode = options.initial;
    this.onChange = options.onChange;
  }

  onAdd(): HTMLElement {
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = `maplibregl-ctrl-orientation orientation-${this.mode}`;
    this.button.title = TITLE[this.mode];
    this.button.setAttribute("aria-label", TITLE[this.mode]);
    this.button.setAttribute("aria-pressed", String(this.mode === "heading"));
    this.button.innerHTML = iconFor(this.mode);
    this.button.addEventListener("click", this.handleClick);

    this.container.appendChild(this.button);
    return this.container;
  }

  onRemove(): void {
    this.button?.removeEventListener("click", this.handleClick);
    this.container?.parentNode?.removeChild(this.container);
    this.container = null;
    this.button = null;
  }

  setMode(mode: OrientationMode): void {
    if (mode === this.mode || !this.button) return;
    this.mode = mode;
    this.button.className = `maplibregl-ctrl-orientation orientation-${mode}`;
    this.button.title = TITLE[mode];
    this.button.setAttribute("aria-label", TITLE[mode]);
    this.button.setAttribute("aria-pressed", String(mode === "heading"));
    this.button.innerHTML = iconFor(mode);
  }

  private handleClick = () => {
    const next = nextOrientation(this.mode);
    this.setMode(next);
    this.onChange(next);
  };
}

function iconFor(mode: OrientationMode): string {
  if (mode === "north") {
    return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.3"/>
      <path d="M10 3 L12 10 L10 9 L8 10 Z" fill="currentColor"/>
      <path d="M10 17 L12 10 L10 11 L8 10 Z" fill="currentColor" opacity="0.35"/>
      <text x="10" y="6.4" text-anchor="middle" font-size="3.4" font-family="ui-sans-serif,system-ui,sans-serif" fill="currentColor" font-weight="700">N</text>
    </svg>`;
  }
  return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 3 L15 13 L10 11 L5 13 Z" fill="currentColor"/>
    <circle cx="10" cy="13.5" r="2.2" fill="currentColor"/>
    <circle cx="10" cy="13.5" r="3.6" stroke="currentColor" stroke-width="1" opacity="0.45"/>
  </svg>`;
}
