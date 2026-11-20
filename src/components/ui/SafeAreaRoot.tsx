"use client";

import { useEffect } from "react";
import { syncSafeAreaVar } from "@/lib/safeArea";

/**
 * Publishes the effective bottom inset into `--safe-bottom`.
 *
 * The stylesheet default is plain `env(safe-area-inset-bottom)`. On iOS 26
 * home-screen apps the system already keeps the home-indicator strip outside
 * the layout viewport, so the raw inset would reserve it twice (see
 * `src/lib/safeArea.ts`). Running on mount is enough for the first paint to
 * settle; the listeners keep it honest across rotation and app switches,
 * where iOS re-reports the insets.
 */
export function SafeAreaRoot() {
  useEffect(() => {
    const sync = () => syncSafeAreaVar();
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
    };
  }, []);
  return null;
}
