"use client";

/**
 * On-map credit for overlays that MapLibre cannot credit itself.
 *
 * MapLibre's attribution control aggregates `attribution` from sources, but an
 * `image` source has no such property (the style validator rejects it, see
 * `apply.ts`). Radar frames — and any future image overlay such as the shadow
 * raster — would therefore lose their licence notice as soon as the panel is
 * closed.
 *
 * The credit is a MapLibre control in the bottom-right stack, so it inherits
 * the existing panel/mobile positioning rules of `.maplibregl-ctrl-bottom-right`
 * and can never end up underneath another map chrome element. It only lists
 * overlays whose source cannot carry its own credit: basemap credits stay in
 * MapLibre's attribution control, so nothing appears twice.
 */
import { useEffect } from "react";
import type { IControl, Map as MLMap } from "maplibre-gl";
import { listOverlays } from "@/lib/overlays";
import { useOverlays } from "@/lib/overlays/store";

export interface OverlayCredit {
  id: string;
  label: string;
  short: string;
  url?: string;
}

/** Credits for active overlays whose source type cannot carry attribution. */
export function overlayCredits(
  enabled: Record<string, boolean>,
  sourceKinds: Record<string, string | null>,
): OverlayCredit[] {
  const credits: OverlayCredit[] = [];
  for (const definition of listOverlays()) {
    if (enabled[definition.id] !== true) continue;
    if (sourceKinds[definition.id] !== "image") continue;
    const attribution = definition.attribution;
    if (!attribution?.label) continue;
    credits.push({
      id: definition.id,
      label: definition.label,
      short: attribution.short ?? attribution.label,
      url: attribution.url,
    });
  }
  return credits.sort((a, b) => a.label.localeCompare(b.label));
}

/** Resolve just enough of every enabled overlay to know its source type. */
function currentCredits(): OverlayCredit[] {
  const { enabled, radarFrames, radarIndex, warnings } = useOverlays.getState();
  const kinds: Record<string, string | null> = {};
  for (const definition of listOverlays()) {
    if (enabled[definition.id] !== true) continue;
    try {
      kinds[definition.id] =
        definition.resolve({
          opacity: 1,
          radar: radarFrames
            ? {
                frames: radarFrames.frames,
                index: radarIndex,
                image: radarFrames.image,
              }
            : null,
          warnings: (warnings?.areas as never) ?? null,
        })?.source.type ?? null;
    } catch {
      kinds[definition.id] = null;
    }
  }
  return overlayCredits(enabled, kinds);
}

function creditKey(credits: OverlayCredit[]): string {
  return credits.map((c) => `${c.id}|${c.label}|${c.short}`).join(";");
}

class CreditControl implements IControl {
  private container: HTMLDivElement | null = null;
  private unsubscribe: (() => void) | null = null;
  private lastKey = "";

  onAdd(): HTMLElement {
    const div = document.createElement("div");
    div.className = "map-credit";
    div.setAttribute("role", "note");
    div.setAttribute("aria-label", "Overlay data credits");
    this.container = div;
    this.render();
    // The store is the single source of truth; a playback tick only changes
    // the frame, which never changes the credit text, so `render` bails out on
    // an unchanged key.
    this.unsubscribe = useOverlays.subscribe(() => this.render());
    return div;
  }

  onRemove(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.container?.remove();
    this.container = null;
  }

  private render(): void {
    const container = this.container;
    if (!container) return;
    const credits = currentCredits();
    const key = creditKey(credits);
    if (key === this.lastKey) return;
    this.lastKey = key;

    container.replaceChildren();
    container.hidden = credits.length === 0;
    credits.forEach((credit, index) => {
      if (index > 0) {
        const sep = document.createElement("span");
        sep.className = "map-credit-sep";
        sep.textContent = " · ";
        container.append(sep);
      }
      const name = document.createElement("span");
      name.className = "map-credit-name";
      name.textContent = `${credit.label}: `;
      container.append(name);
      if (credit.url) {
        const link = document.createElement("a");
        link.href = credit.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = credit.short;
        container.append(link);
      } else {
        container.append(document.createTextNode(credit.short));
      }
    });
  }
}

/** Add the credit control to the map's bottom-right stack. */
export function useMapCreditControl(map: MLMap | null): void {
  useEffect(() => {
    if (!map) return;
    const control = new CreditControl();
    map.addControl(control, "bottom-right");
    return () => {
      try {
        map.removeControl(control);
      } catch {
        /* map torn down */
      }
    };
  }, [map]);
}
