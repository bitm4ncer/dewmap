"use client";

import { useEffect } from "react";
import { haptic } from "@/lib/haptics";

/**
 * Global press feedback for DOM UI. Pressing a `<button>`, an element
 * with `role="button"`, or anything marked `data-tactile` fires an
 * immediate tap haptic on `pointerdown` — before the click handler runs,
 * so the acknowledgment never waits for React or network. Pair custom
 * pressables with the `.tactile` class for the matching visual
 * down-state (`:active` scale). `haptic()` coalesces, so handlers that
 * also call `haptic("tap")` on click cannot double-buzz.
 */
export function TactileRoot() {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const el = target?.closest?.("button, [role='button'], [data-tactile]");
      if (el && !el.hasAttribute("disabled")) haptic("tap");
    };
    document.addEventListener("pointerdown", onPointerDown, {
      capture: true,
      passive: true,
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
    };
  }, []);
  return null;
}
