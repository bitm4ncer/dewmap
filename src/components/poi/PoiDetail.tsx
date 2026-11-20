"use client";
/* eslint-disable @next/next/no-img-element -- remote OSM/Wikimedia photos with unknown dimensions */

import { useEffect, useRef, useState } from "react";
import { fetchPoiDetails } from "@/lib/poi";
import type { PoiDetails, PoiSelection } from "@/lib/poi";
import { parseOpeningHours } from "@/lib/poi/openingHours";
import { expandedCardHeight } from "./cardHeight";
import {
  createSpring,
  prefersReducedMotion,
  rubberband,
  SPRING,
  VelocityTracker,
  type SpringHandle,
} from "@/lib/motion";
import { haptic } from "@/lib/haptics";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CloseIcon,
  ExternalLinkIcon,
  GlobeIcon,
  ImageIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  RouteIcon,
} from "@/components/ui/icons";

interface Props {
  selection: PoiSelection | null;
  onClose: () => void;
  onCenter?: (lon: number, lat: number) => void;
  onPlanRoute?: (selection: PoiSelection) => void;
  /** Set by the shell when the bottom sheet takes the edge from the card. */
  dismissed?: boolean;
}

interface ContentProps extends Omit<Props, "selection"> {
  selection: PoiSelection;
}

function phoneHref(value: string): string {
  return `tel:${value.replace(/[^\d+]/g, "")}`;
}

function osmPath(type: "N" | "W" | "R"): string {
  return type === "W" ? "way" : type === "R" ? "relation" : "node";
}

function descriptionText(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 520 ? `${clean.slice(0, 520).trimEnd()}…` : clean;
}

function categoryLabel(value: string | undefined): string {
  const raw = (value || "Place").replace(/_/g, " ");
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resolve a CSS custom property to pixels by measuring a probe. */
function cssLength(name: string): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;left:0;top:0;width:0;height:var(${name});visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? height : 0;
}

function safeInsetBottom(): number {
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? height : 0;
}

function PoiDetailContent({
  selection,
  onClose,
  onCenter,
  onPlanRoute,
  dismissed,
}: ContentProps) {
  const [details, setDetails] = useState<PoiDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [activeImage, setActiveImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{
    mode: "compact" | "expanded";
    startY: number;
    startHeight: number;
    moved: boolean;
  } | null>(null);
  const compactHeightRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const springRef = useRef<SpringHandle | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const trackerRef = useRef(new VelocityTracker());
  const suppressTapRef = useRef(false);
  /** Armed on a button target: the gesture stays a tap unless it passes
      the axis lock, then it is promoted to a real drag. */
  const pendingRef = useRef<{ pointerId: number; startY: number } | null>(null);
  /** Deferred drag for the expanded body. It only promotes once the
      scroll container is at its top and the finger moves downward, so
      scrolling the details keeps working. */
  const bodyPendingRef = useRef<{
    pointerId: number;
    startY: number;
    startX: number;
  } | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchPoiDetails(selection, ctrl.signal)
      .then((value) => {
        if (ctrl.signal.aborted) return;
        if (!value) {
          setError(true);
          return;
        }
        setDetails(value);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        if (!ctrl.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [selection, reload]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    if (expanded) el.focus({ preventScroll: true });
    else {
      const desktop = window.matchMedia("(min-width: 768px)").matches;
      compactHeightRef.current = desktop ? 148 : 152 + safeInsetBottom();
    }
  }, [expanded]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
      springRef.current?.stop();
      springRef.current = null;
    },
    [],
  );

  // On touch devices the browser starts a native scroll before the
  // pointermove threshold is reached, which cancels our pointer gesture.
  // At the top of the expanded sheet a downward touch has nothing to
  // scroll, so suppress that native gesture; upward swipes and a scrolled
  // body still scroll normally.
  useEffect(() => {
    if (!expanded) return;
    const scroller = cardRef.current?.querySelector<HTMLElement>(".poi-scroll");
    if (!scroller) return;
    let startY: number | null = null;
    const onTouchStart = (event: TouchEvent) => {
      startY = event.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (startY === null || event.touches.length !== 1) return;
      if (scroller.scrollTop > 0) return;
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      if (y - startY > 2) event.preventDefault();
    };
    scroller.addEventListener("touchstart", onTouchStart, { passive: true });
    scroller.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      scroller.removeEventListener("touchstart", onTouchStart);
      scroller.removeEventListener("touchmove", onTouchMove);
    };
  }, [expanded]);

  const retry = () => {
    setLoading(true);
    setError(false);
    setDetails(null);
    setReload((r) => r + 1);
  };

  const images = details?.images ?? [];
  const hasImage = images.length > 0 && !imageFailed;
  const current = images[Math.min(activeImage, Math.max(0, images.length - 1))];
  const imageReady = Boolean(current && loadedUrl === current.url);
  const name =
    details?.name
    || selection.name
    || (error ? "Place details" : "Loading place…");
  const category = categoryLabel(details?.category || selection.category);
  const city = details?.city || selection.city;
  const label = selection.label?.trim();
  const labelAddress = label
    ? (() => {
        const prefix = selection.name?.trim();
        if (prefix && label.toLowerCase().startsWith(prefix.toLowerCase())) {
          const rest = label.slice(prefix.length).replace(/^[,\s·-]+/, "");
          if (rest) return rest;
        }
        return label;
      })()
    : undefined;
  const address =
    details?.address
    || labelAddress
    || (error ? "Details unavailable" : undefined);
  const opening = details?.opening
    ? (parseOpeningHours(details.opening.raw) ?? details.opening)
    : undefined;
  const status =
    opening?.openNow === true
      ? { label: "Open now", tone: "open" as const }
      : opening?.openNow === false
        ? { label: "Closed", tone: "closed" as const }
        : null;

  const routeSelection: PoiSelection = {
    ...selection,
    name: details?.name ?? selection.name,
    city: details?.city ?? selection.city,
    label: details?.address ?? selection.label,
  };

  const onImageError = (url: string) => {
    if (current && current.url !== url) return;
    if (activeImage < images.length - 1) {
      setActiveImage((i) => i + 1);
      setLoadedUrl(null);
    } else {
      setImageFailed(true);
    }
  };

  const consumeSuppressedTap = () => {
    if (!suppressTapRef.current) return false;
    suppressTapRef.current = false;
    return true;
  };

  const suppressNextTap = () => {
    suppressTapRef.current = true;
    window.setTimeout(() => {
      suppressTapRef.current = false;
    }, 400);
  };

  const expandedHeight = () => {
    const vh = window.visualViewport?.height ?? window.innerHeight;
    return expandedCardHeight(vh, {
      desktop: window.matchMedia("(min-width: 768px)").matches,
      peek: cssLength("--hud-peek-h"),
      topbar: cssLength("--topbar-h"),
    });
  };

  const compactHeight = () => {
    if (window.matchMedia("(min-width: 768px)").matches) return 148;
    return 152 + safeInsetBottom();
  };

  const stopCardSpring = () => {
    springRef.current?.stop();
    springRef.current = null;
    cardRef.current?.removeAttribute("data-springing");
  };

  const animateHeight = (target: number, velocity: number) => {
    const el = cardRef.current;
    if (!el) return;
    const from = el.getBoundingClientRect().height;
    stopCardSpring();
    if (prefersReducedMotion() || Math.abs(target - from) < 0.5) {
      el.style.removeProperty("height");
      return;
    }
    el.setAttribute("data-springing", "true");
    el.style.height = `${from}px`;
    const handle: SpringHandle = createSpring({
      from,
      to: target,
      velocity: Math.max(-1200, Math.min(1200, velocity)),
      config: SPRING.card,
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
  };

  const beginResize = (
    mode: "compact" | "expanded",
    event: React.PointerEvent<HTMLElement>,
    startYOverride?: number,
    promoted = false,
  ) => {
    const el = cardRef.current;
    if (!el || closing) return;
    stopCardSpring();
    const height = el.getBoundingClientRect().height;
    if (mode === "compact") compactHeightRef.current = height;
    trackerRef.current.reset();
    const startY = startYOverride ?? event.clientY;
    trackerRef.current.add(startY, event.timeStamp);
    dragRef.current = {
      mode,
      startY,
      startHeight: height,
      moved: promoted,
    };
    el.setAttribute("data-resizing", "true");
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers may not be capturable.
    }
  };

  /**
   * Deferred-drag gesture state: a press on interactive content arms the
   * gesture — until the finger passes the axis lock it stays a tap (the
   * button's click fires), past it the press is promoted to a real resize
   * and the trailing click is suppressed via onClickCapture.
   */
  const armPending = (e: React.PointerEvent<HTMLElement>) => {
    pendingRef.current = { pointerId: e.pointerId, startY: e.clientY };
  };

  const moveResize = (y: number, timeStamp: number) => {
    const drag = dragRef.current;
    const el = cardRef.current;
    if (!drag || !el) return;
    trackerRef.current.add(y, timeStamp);
    if (Math.abs(y - drag.startY) > 10) drag.moved = true;
    if (!drag.moved) return;

    const vh = window.visualViewport?.height ?? window.innerHeight;
    const compact = compactHeightRef.current ?? drag.startHeight;
    const max = expandedHeight();
    const raw = drag.startHeight + (drag.startY - y);
    const next = rubberband(raw, compact, max, vh);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      el.style.height = `${next}px`;
    });
  };

  const clearResize = () => {
    pendingRef.current = null;
    bodyPendingRef.current = null;
    dragRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    cardRef.current?.removeAttribute("data-resizing");
    animateHeight(expanded ? expandedHeight() : compactHeight(), 0);
  };

  const finishResize = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const el = cardRef.current;
    if (!drag || !el) return;
    const moved = drag.moved;
    const heightVelocity = -trackerRef.current.velocity(event.timeStamp);
    const compact = compactHeightRef.current ?? drag.startHeight;
    const max = expandedHeight();
    dragRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    el.removeAttribute("data-resizing");
    if (!moved) {
      el.style.removeProperty("height");
      return;
    }

    // Recompute from the release position — never from a buffered value,
    // so the card cannot jump after the finger lifts.
    const raw = drag.startHeight + (drag.startY - event.clientY);
    const height = rubberband(
      raw,
      compact,
      max,
      window.visualViewport?.height ?? window.innerHeight,
    );
    el.style.height = `${height}px`;
    suppressNextTap();
    if (drag.mode === "compact") {
      if (height < compact - 32 || heightVelocity < -600) {
        haptic("snap");
        closeCard();
        return;
      }
      const nextExpanded = height > compact + 48 || heightVelocity > 350;
      if (nextExpanded !== expanded) {
        haptic("snap");
        setExpanded(true);
      }
      animateHeight(nextExpanded ? max : compact, heightVelocity);
      return;
    }

    const nextExpanded = height > max - 90 && heightVelocity > -350;
    if (nextExpanded !== expanded) {
      haptic("snap");
      setExpanded(false);
    }
    animateHeight(nextExpanded ? max : compact, heightVelocity);
  };

  const bodyScrollTop = () => {
    const scroller = cardRef.current?.querySelector<HTMLElement>(".poi-scroll");
    return scroller?.scrollTop ?? 0;
  };

  /**
   * Drag-down on the expanded body. We deliberately wait for a downward
   * movement past the axis lock and only arm it while the scroller is at
   * the top; an upward swipe or a scrolled body stays a native scroll.
   * This is what made the gesture work on the header/hero but not on the
   * body before.
   */
  const onBodyPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (closing || !expanded) return;
    if ((e.target as HTMLElement).closest(".poi-head, .poi-hero")) return;
    if (bodyScrollTop() > 0) return;
    bodyPendingRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startX: e.clientX,
    };
  };

  const onBodyPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest(".poi-head, .poi-hero")) return;
    const pending = bodyPendingRef.current;
    if (pending && pending.pointerId === e.pointerId) {
      const dy = e.clientY - pending.startY;
      const dx = e.clientX - pending.startX;
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
      // Horizontal or upward movement belongs to native scrolling.
      if (Math.abs(dx) > Math.abs(dy) || dy < 0) {
        bodyPendingRef.current = null;
        return;
      }
      bodyPendingRef.current = null;
      beginResize("expanded", e, pending.startY, true);
      return;
    }
    if (dragRef.current?.mode === "expanded") {
      moveResize(e.clientY, e.timeStamp);
    }
  };

  const onBodyPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (bodyPendingRef.current?.pointerId === e.pointerId) {
      bodyPendingRef.current = null; // never promoted — a plain tap
      return;
    }
    if (dragRef.current?.mode === "expanded") finishResize(e);
  };

  const onBodyPointerCancel = () => {
    bodyPendingRef.current = null;
    clearResize();
  };

  const onBodyClickCapture = (e: React.MouseEvent<HTMLElement>) => {
    if (!suppressTapRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    suppressTapRef.current = false;
  };

  const expand = () => {
    if (consumeSuppressedTap() || closing || expanded) return;
    haptic("snap");
    setExpanded(true);
    animateHeight(expandedHeight(), 0);
  };

  const collapse = () => {
    if (closing || !expanded) return;
    haptic("snap");
    setExpanded(false);
    animateHeight(compactHeight(), 0);
  };

  const closeCard = () => {
    if (closing) return;
    const el = cardRef.current;
    pendingRef.current = null;
    bodyPendingRef.current = null;
    dragRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    stopCardSpring();
    cardRef.current?.removeAttribute("data-resizing");
    if (!el || prefersReducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
    el.setAttribute("data-closing", "true");
    el.getBoundingClientRect();
    requestAnimationFrame(() => {
      el.style.transform = "translateY(100%)";
      el.style.opacity = "0";
    });
    closeTimerRef.current = window.setTimeout(() => {
      onClose();
    }, 260);
  };

  const close = () => {
    if (closing) return;
    haptic("tap");
    closeCard();
  };

  const planRoute = () => {
    haptic("tap");
    onPlanRoute?.(routeSelection);
  };

  // The sheet expanded: hand the bottom edge over. Closing through the
  // animation keeps the card's own exit timing instead of unmounting it.
  useEffect(() => {
    if (dismissed) closeCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot signal from the shell
  }, [dismissed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (expanded) {
        setExpanded(false);
        animateHeight(compactHeight(), 0);
      } else {
        closeCard();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <section
        ref={cardRef}
        tabIndex={-1}
        className="poi-detail"
      role="region"
      aria-label="Place details"
      data-loading={loading ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
      data-closing={closing ? "true" : "false"}
    >
      {!expanded ? (
        <div
          className="poi-mini"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button, a")) {
              armPending(e);
              return;
            }
            beginResize("compact", e);
          }}
          onPointerMove={(e) => {
            const pending = pendingRef.current;
            if (pending && pending.pointerId === e.pointerId) {
              if (Math.abs(e.clientY - pending.startY) < 10) return;
              pendingRef.current = null;
              beginResize("compact", e, pending.startY, true);
              return;
            }
            if (dragRef.current?.mode === "compact") {
              moveResize(e.clientY, e.timeStamp);
            }
          }}
          onPointerUp={(e) => {
            if (pendingRef.current?.pointerId === e.pointerId) {
              pendingRef.current = null; // never promoted — a plain tap
              return;
            }
            if (dragRef.current?.mode === "compact") finishResize(e);
          }}
          onPointerCancel={clearResize}
          onClickCapture={(e) => {
            if (suppressTapRef.current) {
              e.preventDefault();
              e.stopPropagation();
              suppressTapRef.current = false;
            }
          }}
        >
          <span className="poi-grip" aria-hidden />
          <button
            type="button"
            className="poi-mini-thumb"
            onClick={expand}
            aria-label={`Open details for ${name}`}
          >
            {hasImage && current ? (
              <img
                src={current.url}
                alt=""
                loading="eager"
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={() => setLoadedUrl(current.url)}
                onError={() => onImageError(current.url)}
              />
            ) : (
              <ImageIcon size={20} />
            )}
          </button>
          <div className="poi-mini-content">
            <button
              type="button"
              className="poi-mini-main"
              onClick={expand}
              aria-label={`Open details for ${name}`}
            >
              <span className="poi-mini-copy">
                <span className="poi-mini-kicker">
                  {category}
                  {city ? ` · ${city}` : ""}
                </span>
                <span className="poi-mini-title">{name}</span>
                {(address || loading) && (
                  <span className="poi-mini-line">
                    {address || "Loading details…"}
                  </span>
                )}
                {status && (
                  <span className="poi-status" data-tone={status.tone}>
                    {status.label}
                  </span>
                )}
              </span>
            </button>
            {onPlanRoute && (
              <div className="poi-mini-secondary">
                <button
                  type="button"
                  className="poi-mini-subbtn"
                  onClick={planRoute}
                  aria-label="Plan route"
                  title="Plan route"
                >
                  <RouteIcon size={15} />
                </button>
              </div>
            )}
          </div>
          <div className="poi-mini-actions">
            <button
              type="button"
              className="poi-mini-btn"
              onClick={expand}
              aria-label="Expand place details"
              aria-expanded={false}
            >
              <ChevronUpIcon size={18} />
            </button>
            <button
              type="button"
              className="poi-mini-btn"
              onClick={close}
              aria-label="Close place details"
            >
              <CloseIcon size={18} />
            </button>
          </div>
        </div>
      ) : (
        <div className="poi-scroll">
          {hasImage && current && (
            <div
              className="poi-hero"
              onPointerDown={(e) => {
                if ((e.target as HTMLElement).closest("button, a")) {
                  armPending(e);
                  return;
                }
                beginResize("expanded", e);
              }}
              onPointerMove={(e) => {
                const pending = pendingRef.current;
                if (pending && pending.pointerId === e.pointerId) {
                  if (Math.abs(e.clientY - pending.startY) < 10) return;
                  pendingRef.current = null;
                  beginResize("expanded", e, pending.startY, true);
                  return;
                }
                if (dragRef.current?.mode === "expanded") {
                  moveResize(e.clientY, e.timeStamp);
                }
              }}
              onPointerUp={(e) => {
                if (pendingRef.current?.pointerId === e.pointerId) {
                  pendingRef.current = null; // never promoted — a plain tap
                  return;
                }
                if (dragRef.current?.mode === "expanded") finishResize(e);
              }}
              onPointerCancel={clearResize}
              onClickCapture={(e) => {
                if (suppressTapRef.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  suppressTapRef.current = false;
                }
              }}
            >
              <img
                key={current.url}
                src={current.url}
                alt={name}
                className="poi-hero-image"
                data-loaded={imageReady ? "true" : "false"}
                loading="eager"
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={() => setLoadedUrl(current.url)}
                onError={() => onImageError(current.url)}
              />
              <div className="poi-hero-shade" />
              <button
                type="button"
                onClick={collapse}
                className="poi-close poi-collapse"
                aria-label="Minimize place details"
                aria-expanded
              >
                <ChevronDownIcon size={19} />
              </button>
              <button
                type="button"
                onClick={close}
                className="poi-close"
                aria-label="Close place details"
              >
                <CloseIcon size={19} />
              </button>
              <a
                className="poi-credit"
                href={current.href ?? current.url}
                target="_blank"
                rel="noreferrer noopener"
                title={current.license ? `Licence: ${current.license}` : undefined}
              >
                {current.credit}
              </a>
              {images.length > 1 && (
                <div className="poi-thumbs" role="group" aria-label="Photos">
                  {images.slice(0, 4).map((image, i) => (
                    <button
                      key={image.url}
                      type="button"
                      onClick={() => {
                        setActiveImage(i);
                        setImageFailed(false);
                        setLoadedUrl(null);
                      }}
                      className="poi-thumb"
                      data-active={i === activeImage}
                      aria-label={`Show photo ${i + 1}`}
                    >
                      <img
                        src={image.url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          e.currentTarget.style.visibility = "hidden";
                        }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div
            className="poi-body"
            onPointerDown={onBodyPointerDown}
            onPointerMove={onBodyPointerMove}
            onPointerUp={onBodyPointerUp}
            onPointerCancel={onBodyPointerCancel}
            onClickCapture={onBodyClickCapture}
          >
            {!hasImage && (
              <div
                className="poi-head poi-head--actions"
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest("button, a")) {
                    armPending(e);
                    return;
                  }
                  beginResize("expanded", e);
                }}
                onPointerMove={(e) => {
                  const pending = pendingRef.current;
                  if (pending && pending.pointerId === e.pointerId) {
                    if (Math.abs(e.clientY - pending.startY) < 10) return;
                    pendingRef.current = null;
                    beginResize("expanded", e, pending.startY, true);
                    return;
                  }
                  if (dragRef.current?.mode === "expanded") {
                    moveResize(e.clientY, e.timeStamp);
                  }
                }}
                onPointerUp={(e) => {
                  if (pendingRef.current?.pointerId === e.pointerId) {
                    pendingRef.current = null; // never promoted — a plain tap
                    return;
                  }
                  if (dragRef.current?.mode === "expanded") finishResize(e);
                }}
                onPointerCancel={clearResize}
                onClickCapture={(e) => {
                  if (suppressTapRef.current) {
                    e.preventDefault();
                    e.stopPropagation();
                    suppressTapRef.current = false;
                  }
                }}
              >
                <p className="ui-kicker">
                  {category}
                  {city ? ` · ${city}` : ""}
                </p>
                <div className="poi-head-controls">
                  <button
                    type="button"
                    onClick={collapse}
                    className="poi-close poi-close--inline"
                    aria-label="Minimize place details"
                    aria-expanded
                  >
                    <ChevronDownIcon size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="poi-close poi-close--inline"
                    aria-label="Close place details"
                  >
                    <CloseIcon size={18} />
                  </button>
                </div>
              </div>
            )}
            {hasImage && (
              <p className="ui-kicker">
                {category}
                {city ? ` · ${city}` : ""}
              </p>
            )}
            <h2 className="poi-title">{name}</h2>
            {details?.address && <p className="poi-address">{details.address}</p>}

            {loading && (
              <div className="poi-skeleton" role="status" aria-label="Loading place details">
                <span className="ui-skeleton" />
                <span className="ui-skeleton" />
                <span className="ui-skeleton" style={{ width: "68%" }} />
              </div>
            )}

            {error && !loading && (
              <div className="poi-empty">
                <p>Details could not be loaded.</p>
                <div className="flex gap-2">
                  <button type="button" className="poi-action" onClick={retry}>
                    Try again
                  </button>
                  {selection.osmType && selection.osmId && (
                    <a
                      className="poi-action"
                      href={`https://www.openstreetmap.org/${osmPath(selection.osmType)}/${selection.osmId}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Open in OSM
                    </a>
                  )}
                </div>
              </div>
            )}

            {details && !loading && !error && (
              <>
                <div className="poi-actions">
                  {onPlanRoute && (
                    <button
                      type="button"
                      className="poi-action poi-action--primary"
                      onClick={planRoute}
                    >
                      <RouteIcon size={16} />
                      Plan Route
                    </button>
                  )}
                  {details.website && (
                    <a
                      className={`poi-action${onPlanRoute ? "" : " poi-action--primary"}`}
                      href={details.website}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <GlobeIcon size={16} />
                      Website
                    </a>
                  )}
                  {onCenter && (
                    <button
                      type="button"
                      className="poi-action"
                      onClick={() => onCenter(details.lon, details.lat)}
                    >
                      <MapPinIcon size={16} />
                      Show on map
                    </button>
                  )}
                  <a
                    className="poi-action"
                    href={details.osmUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <ExternalLinkIcon size={15} />
                    OSM
                  </a>
                </div>

                {opening && (
                  <div className="poi-section">
                    <div className="poi-section-head">
                      <ClockIcon size={17} />
                      <h3>Opening hours</h3>
                      {status && (
                        <span className="poi-status" data-tone={status.tone}>
                          {status.label}
                        </span>
                      )}
                    </div>
                    {opening.rows.some((row) => row.ranges.length || row.closed) ? (
                      <div className="poi-hours">
                        {opening.rows.map((row, i) => (
                          <div
                            key={row.day}
                            className="poi-hour-row"
                            data-today={i === opening.todayIndex}
                          >
                            <span>{row.day}</span>
                            <span>
                              {row.closed
                                ? "Closed"
                                : row.ranges.join(", ") || "—"}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="poi-raw">{opening.raw}</p>
                    )}
                    <p className="poi-note">
                      Hours may differ on public holidays.
                    </p>
                  </div>
                )}

                {(details.phone ||
                  details.email ||
                  details.website ||
                  details.socials.length > 0) && (
                  <div className="poi-section">
                    <div className="poi-section-head">
                      <h3>Contact</h3>
                    </div>
                    <div className="poi-links">
                      {details.phone && (
                        <a href={phoneHref(details.phone)} className="poi-link">
                          <PhoneIcon size={17} />
                          <span>{details.phone}</span>
                        </a>
                      )}
                      {details.email && (
                        <a href={`mailto:${details.email}`} className="poi-link">
                          <MailIcon size={17} />
                          <span>{details.email}</span>
                        </a>
                      )}
                      {details.website && (
                        <a
                          href={details.website}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="poi-link"
                        >
                          <GlobeIcon size={17} />
                          <span>{details.website.replace(/^https?:\/\//, "")}</span>
                        </a>
                      )}
                    </div>
                    {details.socials.length > 0 && (
                      <div className="poi-socials">
                        {details.socials.map((social) => (
                          <a
                            key={`${social.label}-${social.url}`}
                            href={social.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="poi-social"
                          >
                            {social.label}
                            <ExternalLinkIcon size={12} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {details.facts.length > 0 && (
                  <div className="poi-section">
                    <div className="poi-section-head">
                      <h3>Details</h3>
                    </div>
                    <dl className="poi-facts">
                      {details.facts.map((fact) => (
                        <div key={fact.label}>
                          <dt>{fact.label}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                {details.description && (
                  <div className="poi-section">
                    <div className="poi-section-head">
                      <h3>About</h3>
                    </div>
                    <p className="poi-description">
                      {descriptionText(details.description)}
                    </p>
                    {(details.wikipediaUrl || details.wikidataUrl) && (
                      <div className="poi-refs">
                        {details.wikipediaUrl && (
                          <a
                            href={details.wikipediaUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Wikipedia
                            <ExternalLinkIcon size={12} />
                          </a>
                        )}
                        {details.wikidataUrl && (
                          <a
                            href={details.wikidataUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Wikidata
                            <ExternalLinkIcon size={12} />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {!details.website &&
                  !details.phone &&
                  !details.email &&
                  !opening &&
                  !details.description &&
                  details.facts.length === 0 &&
                  details.socials.length === 0 && (
                    <div className="poi-empty">
                      <p>No further details are mapped for this place.</p>
                      <a
                        className="poi-action"
                        href={details.osmUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Open in OSM
                      </a>
                    </div>
                  )}

                <footer className="poi-footer">
                  <a
                    href={details.osmUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Data © OpenStreetMap contributors
                  </a>
                  {details.checked && <span>Last checked {details.checked}</span>}
                </footer>
              </>
            )}
          </div>
        </div>
      )}
      </section>
    </>
  );
}

export function PoiDetail(props: Props) {
  if (!props.selection) return null;
  const key =
    props.selection.osmType && props.selection.osmId
      ? `${props.selection.osmType}${props.selection.osmId}`
      : `${props.selection.lon.toFixed(4)},${props.selection.lat.toFixed(4)}`;
  return <PoiDetailContent key={key} {...props} selection={props.selection} />;
}
