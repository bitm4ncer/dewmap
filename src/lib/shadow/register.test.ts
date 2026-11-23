import { beforeEach, describe, expect, it } from "vitest";
import { getOverlay, listOverlays, resetOverlayRegistry } from "@/lib/overlays";
import { registerShadowOverlay, resetShadowRegistration } from "./register";
import { SHADOW_OVERLAY_ID } from "./overlay";

beforeEach(() => {
  resetOverlayRegistry();
  resetShadowRegistration();
});

describe("shadow overlay registration", () => {
  it("registers exactly one nature overlay", () => {
    registerShadowOverlay();
    registerShadowOverlay(); // idempotent, like the weather bootstrap
    expect(getOverlay(SHADOW_OVERLAY_ID)).toBeDefined();
    expect(listOverlays("nature").map((overlay) => overlay.id)).toEqual([SHADOW_OVERLAY_ID]);
  });

  it("exposes the metadata the panel needs", () => {
    registerShadowOverlay();
    const definition = getOverlay(SHADOW_OVERLAY_ID)!;
    expect(definition.label).toBe("Shadows");
    expect(definition.minzoom).toBe(14);
    expect(definition.timeAware).toBe(true);
    expect(definition.attribution.label).toContain("Geobasis NRW");
    expect(definition.resolve({ opacity: 0.5, radar: null, warnings: null })).toBeNull();
  });
});
