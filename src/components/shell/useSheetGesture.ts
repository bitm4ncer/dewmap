"use client";

import { useCallback, useEffect, useRef } from "react";
import { haptic } from "../../lib/haptics";
import {
  chooseDetent,
  createSpring,
  prefersReducedMotion,
  rubberband,
  SPRING,
  VelocityTracker,
  type SpringHandle,
} from "../../lib/motion";

export { rubberband } from "../../lib/motion";

export type SheetState = "peek" | "half" | "full";

const ORDER: SheetState[] = ["peek", "half", "full"];

const GESTURE_AXIS_PX = 10;
const TAP_DISTANCE_PX = 6;
const TAP_VELOCITY = 100;

function clampVelocity(value: number): number {
  return Math.max(-1200, Math.min(1200, value));
}

function measureSafeBottom(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? height : 0;
}

/** A swipe counts only when it is clearly vertical; otherwise the tap wins. */
export function gestureDirection(dx: number, dy: number): "up" | "down" | "none" {
  if (Math.abs(dy) < GESTURE_AXIS_PX) return "none";
  if (Math.abs(dy) <= Math.abs(dx)) return "none";
  return dy < 0 ? "up" : "down";
}

/** Directions that can actually move the sheet from its current snap point. */
export function canDrag(state: SheetState, direction: "up" | "down" | "none"): boolean {
  if (direction === "up") return state !== "full";
  if (direction === "down") return state !== "peek";
  return false;
}

/** True at the edges, where a pull should stretch instead of changing state. */
export function canOverscroll(
  state: SheetState,
  direction: "up" | "down" | "none",
): boolean {
  return (
    (state === "peek" && direction === "down")
    || (state === "full" && direction === "up")
  );
}

/** Direction- and velocity-aware snap target for a released drag. */
export function pickSnap(
  state: SheetState,
  height: number,
  velocity: number,
  snap: { peek: number; half: number; full: number },
): SheetState {
  return chooseDetent(
    state,
    height,
    velocity,
    ORDER.map((s) => ({ state: s, height: snap[s] })),
  );
}

/**
 * Only the grabber/header resizes the sheet. Gestures that start inside the
 * panel body always belong to the native scroll view (over-scroll there is
 * handled by the panel's own rubber-band collapse), so a half-open panel
 * can be scrolled without the sheet jumping to full height.
 */
export function canStartDrag(
  state: SheetState,
  direction: "up" | "down" | "none",
  fromBody: boolean,
): boolean {
  if (fromBody) return false;
  return canDrag(state, direction) || canOverscroll(state, direction);
}

interface Options {
  state: SheetState;
  onChange: (state: SheetState) => void;
  /** Disable on desktop, where the sheet is a normal drawer. */
  enabled: boolean;
}

/** Viewport metrics for one gesture. Measured once, reused every frame. */
export interface SheetMetrics {
  peek: number;
  half: number;
  full: number;
  vh: number;
}

/**
 * Detents must match the CSS snap heights exactly. The panel has three
 * positions — peek (the collapsed tab row), half (48dvh) and full
 * (100dvh). In particular the full sheet is 100dvh, not
 * viewport-minus-topbar: the top bar is hidden while the sheet is full,
 * and a mismatch would cause a visible jump when the inline height is
 * removed at the end of the spring.
 */
export function sheetMetrics(vh: number, safeBottom: number): SheetMetrics {
  const peek = 88 + safeBottom;
  return {
    peek,
    half: Math.round(vh * 0.48),
    full: vh,
    vh,
  };
}

/**
 * Pointer-driven bottom sheet with native-like spring detents.
 *
 * The gesture writes the sheet's height directly while the finger is down.
 * On release a spring (with the gesture velocity) carries the sheet to the
 * projected detent. If the user touches the sheet mid-flight, the spring is
 * stopped at its current height and the drag continues without a jump.
 * Pulls past a detent hit the rubber band and stretch the sheet.
 *
 * The height is intentionally written as `style.height`, not as a custom
 * property: inherited custom properties invalidate the style of every child
 * on each frame, which makes the panel noticeably janky on mobile.
 *
 * Nothing in the gesture path touches React state: the dragging flag is a
 * `data-dragging` attribute on the sheet element and the viewport metrics
 * are measured once per gesture, so no frame interleaves a DOM read with
 * the height write or re-renders the map while the finger is down.
 */
export function useSheetGesture({ state, onChange, enabled }: Options) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const metricsRef = useRef<SheetMetrics | null>(null);
  const safeBottomRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const springRef = useRef<SpringHandle | null>(null);
  const trackerRef = useRef(new VelocityTracker());

  const stopSpring = useCallback(() => {
    springRef.current?.stop();
    springRef.current = null;
    const el = sheetRef.current;
    el?.removeAttribute("data-springing");
    return el?.getBoundingClientRect().height ?? 0;
  }, []);

  const heights = useCallback((): SheetMetrics => {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    return sheetMetrics(vh, safeBottomRef.current);
  }, []);

  const heightFor = useCallback(
    (s: SheetState, m: SheetMetrics = heights()) => {
      return s === "peek"
        ? m.peek
        : s === "half"
          ? m.half
          : m.full;
    },
    [heights],
  );

  const animateTo = useCallback(
    (target: SheetState, velocity = 0) => {
      const el = sheetRef.current;
      if (!el) {
        onChange(target);
        return;
      }
      const from = el.getBoundingClientRect().height;
      const to = heightFor(target);
      springRef.current?.stop();
      springRef.current = null;
      onChange(target);

      if (!enabled || prefersReducedMotion() || Math.abs(to - from) < 0.5) {
        el.style.removeProperty("height");
        el.removeAttribute("data-springing");
        return;
      }

      el.setAttribute("data-springing", "true");
      el.style.height = `${from}px`;
      const handle: SpringHandle = createSpring({
        from,
        to,
        velocity: clampVelocity(velocity),
        config:
          target === "peek" || target === "half"
            ? SPRING.sheetPeek
            : SPRING.sheetSnap,
        onUpdate: (value) => {
          el.style.height = `${value}px`;
        },
        onComplete: () => {
          el.style.removeProperty("height");
          el.removeAttribute("data-springing");
          if (springRef.current === handle) springRef.current = null;
        },
      });
      springRef.current = handle;
    },
    [enabled, heightFor, onChange],
  );

  const snapTo = useCallback(
    (target: SheetState) => {
      animateTo(target, 0);
    },
    [animateTo],
  );

  const nearest = useCallback(
    (m: SheetMetrics, height: number, velocity: number) =>
      pickSnap(state, height, velocity, {
        peek: m.peek,
        half: m.half,
        full: m.full,
      }),
    [state],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
      if (e.pointerType === "touch") return; // native touch path owns gestures
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const el = sheetRef.current;
      if (!el) return;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointers (tests, some browsers) may not be capturable.
      }
      stopSpring();
      const height = el.getBoundingClientRect().height;
      metricsRef.current = heights();
      trackerRef.current.reset();
      trackerRef.current.add(e.clientY, e.timeStamp);
      dragRef.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startHeight: height,
      };
      el.setAttribute("data-dragging", "true");
    },
    [enabled, heights, stopSpring],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const el = sheetRef.current;
      const m = metricsRef.current;
      if (!drag || !el || !m || drag.pointerId !== e.pointerId) return;
      trackerRef.current.add(e.clientY, e.timeStamp);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const raw = drag.startHeight + (drag.startY - e.clientY);
        const next = rubberband(raw, m.half, m.full, m.vh);
        el.style.height = `${next}px`;
      });
    },
    [],
  );

  const finishDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const el = sheetRef.current;
      const m = metricsRef.current;
      if (!drag || !el || !m || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      metricsRef.current = null;
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      const raw = drag.startHeight + (drag.startY - e.clientY);
      const height = rubberband(raw, m.peek, m.full, m.vh);
      const velocityY = trackerRef.current.velocity(e.timeStamp);
      const heightVelocity = -velocityY;
      const moved = Math.abs(e.clientY - drag.startY);
      el.removeAttribute("data-dragging");

      if (moved < TAP_DISTANCE_PX && Math.abs(velocityY) < TAP_VELOCITY) {
        haptic("tap");
        animateTo(state === "peek" ? "half" : "peek", 0);
        return;
      }

      const target = nearest(m, height, heightVelocity);
      el.style.height = `${height}px`;
      if (target !== state) haptic("snap");
      animateTo(target, heightVelocity);
    },
    [animateTo, nearest, state],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      metricsRef.current = null;
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      sheetRef.current?.removeAttribute("data-dragging");
      animateTo(state, 0);
    },
    [animateTo, state],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (!enabled) return;
      const idx = ORDER.indexOf(state);
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = e.key === "ArrowUp" ? idx + 1 : idx - 1;
        snapTo(ORDER[Math.max(0, Math.min(ORDER.length - 1, next))]);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        snapTo(state === "peek" ? "half" : "peek");
      }
    },
    [enabled, snapTo, state],
  );

  useEffect(() => {
    if (!enabled) return;
    const el = sheetRef.current;
    if (!el) return;

    let suppressClickUntil = 0;
    let touch: {
      startX: number;
      startY: number;
      startHeight: number;
      metrics: SheetMetrics;
      started: boolean;
      inBody: boolean;
      onGrabber: boolean;
      tracker: VelocityTracker;
    } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        touch = null;
        return;
      }
      const target = e.target as HTMLElement;
      const t = e.touches[0];
      const startHeight = el.getBoundingClientRect().height;
      touch = {
        startX: t.clientX,
        startY: t.clientY,
        startHeight,
        metrics: heights(),
        started: false,
        inBody: Boolean(target.closest(".ui-panel-body")),
        onGrabber: Boolean(target.closest(".hud-bottom-sheet-grabber")),
        tracker: new VelocityTracker(),
      };
    };

    const onMove = (e: TouchEvent) => {
      if (!touch) return;
      const t = e.touches[0];
      if (!t) return;
      if (!touch.started) {
        const direction = gestureDirection(
          t.clientX - touch.startX,
          t.clientY - touch.startY,
        );
        if (direction === "none") return;
        if (!canStartDrag(state, direction, touch.inBody)) {
          touch = null;
          return;
        }
        stopSpring();
        const current = el.getBoundingClientRect().height;
        touch.started = true;
        touch.startY = t.clientY;
        touch.startHeight = current;
        touch.tracker.reset();
        touch.tracker.add(t.clientY, e.timeStamp);
        el.setAttribute("data-dragging", "true");
      }
      if (e.cancelable) e.preventDefault();
      touch.tracker.add(t.clientY, e.timeStamp);
      const activeTouch = touch;
      const m = activeTouch.metrics;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const raw = activeTouch.startHeight + (activeTouch.startY - t.clientY);
        const next = rubberband(raw, m.peek, m.full, m.vh);
        el.style.height = `${next}px`;
      });
    };

    const onEnd = (e: TouchEvent) => {
      if (!touch) return;
      if (!touch.started) {
        if (touch.onGrabber) {
          haptic("tap");
          animateTo(state === "peek" ? "half" : "peek", 0);
        }
        touch = null;
        return;
      }
      // A drag must not fall through as a click on the tab underneath.
      if (e.cancelable) e.preventDefault();
      suppressClickUntil = performance.now() + 500;
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      const m = touch.metrics;
      const endY = e.changedTouches[0]?.clientY ?? touch.startY;
      const raw = touch.startHeight + (touch.startY - endY);
      const height = rubberband(raw, m.half, m.full, m.vh);
      const heightVelocity = -touch.tracker.velocity(e.timeStamp);
      const target = nearest(m, height, heightVelocity);
      el.style.height = `${height}px`;
      el.removeAttribute("data-dragging");
      if (target !== state) haptic("snap");
      animateTo(target, heightVelocity);
      touch = null;
    };

    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    el.addEventListener("click", onClickCapture, true);
    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("click", onClickCapture, true);
    };
  }, [animateTo, enabled, heights, nearest, state, stopSpring]);

  useEffect(() => {
    if (!enabled) return;
    const onResize = () => {
      safeBottomRef.current = measureSafeBottom();
      springRef.current?.stop();
      springRef.current = null;
      const el = sheetRef.current;
      el?.removeAttribute("data-springing");
      el?.style.removeProperty("height");
    };
    onResize();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [enabled]);

  useEffect(
    () => () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      springRef.current?.stop();
      springRef.current = null;
    },
    [],
  );

  return {
    sheetRef,
    heightFor,
    snapTo,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel,
      onKeyDown,
    },
  };
}
