"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SheetState = "peek" | "half" | "full";

const ORDER: SheetState[] = ["peek", "half", "full"];

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
    const peek = 110;
    return {
      peek,
      half: Math.round(vh * 0.48),
      full: Math.max(peek + 80, Math.round(vh - topbar)),
      min: 64,
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
    (height: number, velocity: number) => {
      const h = heights();
      // A decisive flick wins over proximity.
      if (velocity > 0.65) {
        if (height < h.half * 0.75 || state === "full") return "peek" as const;
        return "half" as const;
      }
      if (velocity < -0.65) {
        if (height > h.half * 1.15 || state === "peek") return "full" as const;
        return "half" as const;
      }
      const options: Array<[SheetState, number]> = [
        ["peek", Math.abs(height - h.peek)],
        ["half", Math.abs(height - h.half)],
        ["full", Math.abs(height - h.full)],
      ];
      options.sort((a, b) => a[1] - b[1]);
      return options[0][0];
    },
    [heights, state],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!enabled) return;
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
