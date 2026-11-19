"use client";

import { useEffect, useRef } from "react";
import type { Map as MLMap } from "maplibre-gl";
import { haptic } from "@/lib/haptics";

interface Options {
  /** Hold duration in ms before the long-press fires. */
  holdMs?: number;
  /** Cancel if the pointer moves more than this many CSS pixels. */
  moveTolerancePx?: number;
  /** Brief haptic feedback on Android (no-op on iOS Safari). */
  vibrate?: boolean;
  /**
   * Show a faint preview at the pressed point after `previewDelayMs`,
   * tracking the finger while it stays within tolerance. Called with
   * null whenever the press ends or is cancelled.
   */
  previewDelayMs?: number;
  onPreview?: (lngLat: { lng: number; lat: number } | null) => void;
}

/**
 * Robust map long-press handler.
 *
 * Uses Pointer Events on the map container so touch + mouse + pen are all
 * handled uniformly. The handler:
 *
 *   - starts a timer on `pointerdown`
 *   - shows a preview after `previewDelayMs` (tick haptic) that follows
 *     the finger within the move tolerance, so the target can be aimed
 *   - cancels on `pointermove` beyond tolerance (so a pan never fires)
 *   - cancels on `pointerup`, `pointercancel`, `wheel`, or `contextmenu`
 *   - on fire: strong haptic, fires `onLongPress` at the last aimed
 *     position, and suppresses the subsequent `click` event so MapLibre
 *     does not treat it as a tap
 *
 * On desktop, right-click also fires the same handler (no preview).
 */
export function useLongPress(
  map: MLMap | null,
  enabled: boolean,
  onLongPress: (lng: number, lat: number) => void,
  options: Options = {},
) {
  const holdMs = options.holdMs ?? 550;
  const moveTolerancePx = options.moveTolerancePx ?? 12;
  const vibrate = options.vibrate ?? true;
  const previewDelayMs = options.previewDelayMs ?? 140;
  const onPreview = options.onPreview;
  // Callbacks live in refs so the listener setup below does not need to
  // re-attach whenever a caller's callback identity changes.
  const onPreviewRef = useRef(onPreview);
  const onLongPressRef = useRef(onLongPress);
  useEffect(() => {
    onPreviewRef.current = onPreview;
    onLongPressRef.current = onLongPress;
  });

  useEffect(() => {
    if (!map || !enabled) return;
    const canvas = map.getCanvasContainer();

    let timer: number | null = null;
    let previewTimer: number | null = null;
    let previewFrame: number | null = null;
    let previewVisible = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let activePointerId: number | null = null;
    /** Set to true when long-press fires; consumed by the next click. */
    let suppressNextClick = false;
    /** Safety net: touch long-press often emits no click at all. */
    let suppressReset: number | null = null;

    const unproject = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return map.unproject([clientX - rect.left, clientY - rect.top]);
    };

    const clearTimers = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (previewTimer != null) {
        window.clearTimeout(previewTimer);
        previewTimer = null;
      }
      if (previewFrame != null) {
        cancelAnimationFrame(previewFrame);
        previewFrame = null;
      }
    };

    const hidePreview = () => {
      if (previewFrame != null) {
        cancelAnimationFrame(previewFrame);
        previewFrame = null;
      }
      if (!previewVisible) return;
      previewVisible = false;
      onPreviewRef.current?.(null);
    };

    const cancel = () => {
      clearTimers();
      hidePreview();
      activePointerId = null;
    };

    /** rAF-throttled preview position update while the press is held. */
    const schedulePreviewUpdate = () => {
      if (!previewVisible || previewFrame != null) return;
      previewFrame = requestAnimationFrame(() => {
        previewFrame = null;
        if (!previewVisible || activePointerId == null) return;
        const lngLat = unproject(lastX, lastY);
        onPreviewRef.current?.({ lng: lngLat.lng, lat: lngLat.lat });
      });
    };

    const onPointerDown = (e: PointerEvent) => {
      // Only primary button / single touch
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (activePointerId != null) return;
      activePointerId = e.pointerId;
      startX = lastX = e.clientX;
      startY = lastY = e.clientY;
      clearTimers();
      timer = window.setTimeout(() => {
        if (activePointerId == null) return;
        if (suppressReset != null) window.clearTimeout(suppressReset);
        suppressNextClick = true;
        suppressReset = window.setTimeout(() => {
          suppressNextClick = false;
          suppressReset = null;
        }, 900);
        hidePreview();
        if (vibrate) haptic("longpress");
        const lngLat = unproject(lastX, lastY);
        onLongPressRef.current(lngLat.lng, lngLat.lat);
        cancel();
      }, holdMs);
      if (previewDelayMs > 0 && onPreviewRef.current) {
        previewTimer = window.setTimeout(() => {
          if (activePointerId == null) return;
          previewVisible = true;
          haptic("tick");
          const lngLat = unproject(lastX, lastY);
          onPreviewRef.current?.({ lng: lngLat.lng, lat: lngLat.lat });
        }, previewDelayMs);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (activePointerId !== e.pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > moveTolerancePx) {
        cancel();
        return;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      schedulePreviewUpdate();
    };

    const onPointerEnd = (e: PointerEvent) => {
      if (activePointerId !== e.pointerId) return;
      cancel();
    };

    const onWheel = () => cancel();

    const onContextMenu = (e: MouseEvent) => {
      // Desktop right-click → treat as long-press, suppress browser menu
      e.preventDefault();
      const lngLat = unproject(e.clientX, e.clientY);
      onLongPressRef.current(lngLat.lng, lngLat.lat);
    };

    const onClickCapture = (e: MouseEvent) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        e.stopPropagation();
        e.preventDefault();
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);
    canvas.addEventListener("pointerleave", onPointerEnd);
    canvas.addEventListener("wheel", onWheel, { passive: true });
    canvas.addEventListener("contextmenu", onContextMenu);
    // Capture phase so we get the chance to suppress before MapLibre's click.
    canvas.addEventListener("click", onClickCapture, true);

    return () => {
      cancel();
      if (suppressReset != null) window.clearTimeout(suppressReset);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      canvas.removeEventListener("pointerleave", onPointerEnd);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("click", onClickCapture, true);
    };
  }, [map, enabled, holdMs, moveTolerancePx, vibrate, previewDelayMs]);
}
