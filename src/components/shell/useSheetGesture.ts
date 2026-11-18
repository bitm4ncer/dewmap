"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SheetState = "peek" | "half" | "full";

const ORDER: SheetState[] = ["peek", "half", "full"];

const GESTURE_AXIS_PX = 10;

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

/** Direction- and velocity-aware snap target for a released drag. */
export function pickSnap(
  state: SheetState,
  height: number,
  velocity: number,
  snap: { peek: number; half: number; full: number },
): SheetState {
  const idx = ORDER.indexOf(state);
  const current = snap[state];
  const flick = velocity > 0.65 ? -1 : velocity < -0.65 ? 1 : 0;
  const direction = flick !== 0 ? flick : height > current ? 1 : -1;
  const next = Math.max(0, Math.min(ORDER.length - 1, idx + direction));
  if (next === idx) return state;
  const nextHeight = snap[ORDER[next]];
  const travelled = Math.abs(height - current);
  const passed = travelled >= Math.max(24, Math.abs(nextHeight - current) * 0.25);
  return flick !== 0 || passed ? ORDER[next] : state;
}

/** Header swipes resize; body swipes stay native scrolling except down at top. */
export function canStartDrag(
  state: SheetState,
  direction: "up" | "down" | "none",
  fromBody: boolean,
  scrollTop: number,
): boolean {
  if (!canDrag(state, direction)) return false;
  if (!fromBody) return true;
  if (direction === "up") return false;
  return scrollTop <= 0;
}

interface Options {
  state: SheetState;
  onChange: (state: SheetState) => void;
  /** Disable on desktop, where the sheet is a normal drawer. */
  enabled: boolean;
}

/**
 * Pointer-driven bottom-sheet gesture with velocity-aware snapping.
 *
 * The sheet keeps its CSS snap height (`peek` / `half` / `full`). During a
 * drag we write a pixel height into `--sheet-h` on the element; on release
 * we remove it again and let the CSS transition animate to the chosen snap
 * point. `data-dragging` disables the transition while the finger is down.
 *
 * The handle is also a real button: Enter/Space toggles peek, ArrowUp/Down
 * moves one snap point, so the sheet stays keyboard-accessible.
 */
export function useSheetGesture({ state, onChange, enabled }: Options) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);
  const rafRef = useRef<number | null>(null);

  const clearInlineHeight = useCallback(() => {
    sheetRef.current?.style.removeProperty("--sheet-h");
  }, []);

  const heights = useCallback(() => {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const topbar =
      document.querySelector<HTMLElement>(".ui-topbar")?.offsetHeight ?? 56;
    const peek = 56;
    return {
      peek,
      half: Math.round(vh * 0.48),
      full: Math.max(peek + 80, Math.round(vh - topbar)),
      min: 48,
      vh,
    };
  }, []);

  const heightFor = useCallback(
    (s: SheetState) => {
      const h = heights();
      return s === "peek" ? h.peek : s === "half" ? h.half : h.full;
    },
    [heights],
  );

  const snapTo = useCallback(
    (target: SheetState) => {
      clearInlineHeight();
      onChange(target);
    },
    [clearInlineHeight, onChange],
  );

  const nearest = useCallback(
    (height: number, velocity: number) => pickSnap(state, height, velocity, heights()),
    [heights, state],
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
      dragRef.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        startHeight: el.getBoundingClientRect().height,
        lastY: e.clientY,
        lastT: e.timeStamp,
        velocity: 0,
      };
      setDragging(true);
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      const el = sheetRef.current;
      if (!drag || !el || drag.pointerId !== e.pointerId) return;
      const now = e.timeStamp;
      const dt = Math.max(1, now - drag.lastT);
      drag.velocity = (e.clientY - drag.lastY) / dt;
      drag.lastY = e.clientY;
      drag.lastT = now;

      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const h = heights();
        const next = Math.max(
          h.min,
          Math.min(h.full, drag.startHeight + (drag.startY - e.clientY)),
        );
        el.style.setProperty("--sheet-h", `${next}px`);
      });
    },
    [heights],
  );

  const finishDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const el = sheetRef.current;
      const height = el?.getBoundingClientRect().height ?? drag.startHeight;
      const moved = Math.abs(drag.lastY - drag.startY);
      setDragging(false);
      // A plain tap on the handle toggles peek ↔ half, like the old
      // button behaviour, without fighting the drag threshold.
      if (moved < 6 && Math.abs(drag.velocity) < 0.1) {
        snapTo(state === "peek" ? "half" : "peek");
        return;
      }
      snapTo(nearest(height, drag.velocity));
    },
    [nearest, snapTo, state],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      dragRef.current = null;
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setDragging(false);
      clearInlineHeight();
    },
    [clearInlineHeight],
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
      lastY: number;
      lastT: number;
      velocity: number;
      started: boolean;
      inBody: boolean;
      onGrabber: boolean;
    } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        touch = null;
        return;
      }
      const target = e.target as HTMLElement;
      const t = e.touches[0];
      touch = {
        startX: t.clientX,
        startY: t.clientY,
        startHeight: el.getBoundingClientRect().height,
        lastY: t.clientY,
        lastT: e.timeStamp,
        velocity: 0,
        started: false,
        inBody: Boolean(target.closest(".ui-panel-body")),
        onGrabber: Boolean(target.closest(".hud-bottom-sheet-grabber")),
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
        const scroller = el.querySelector<HTMLElement>(".ui-panel-body");
        if (
          !canStartDrag(
            state,
            direction,
            touch.inBody,
            scroller?.scrollTop ?? 0,
          )
        ) {
          touch = null;
          return;
        }
        touch.started = true;
        setDragging(true);
        touch.lastY = touch.startY;
        touch.lastT = e.timeStamp;
      }
      if (e.cancelable) e.preventDefault();
      const h = heights();
      const next = Math.max(
        h.min,
        Math.min(h.full, touch.startHeight + (touch.startY - t.clientY)),
      );
      el.style.setProperty("--sheet-h", `${next}px`);
      const dt = Math.max(1, e.timeStamp - touch.lastT);
      touch.velocity = (t.clientY - touch.lastY) / dt;
      touch.lastY = t.clientY;
      touch.lastT = e.timeStamp;
    };

    const onEnd = (e: TouchEvent) => {
      if (!touch) return;
      if (!touch.started) {
        if (touch.onGrabber) snapTo(state === "peek" ? "half" : "peek");
        touch = null;
        return;
      }
      // A drag must not fall through as a click on the tab underneath.
      if (e.cancelable) e.preventDefault();
      suppressClickUntil = performance.now() + 500;
      const height = el.getBoundingClientRect().height;
      setDragging(false);
      snapTo(nearest(height, touch.velocity));
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
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
      el.removeEventListener("click", onClickCapture, true);
    };
  }, [enabled, heights, nearest, snapTo, state]);

  useEffect(() => {
    if (!enabled) return;
    const onResize = () => {
      clearInlineHeight();
    };
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, [clearInlineHeight, enabled]);

  return {
    sheetRef,
    dragging,
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
