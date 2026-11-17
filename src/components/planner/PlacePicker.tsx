"use client";

import { useEffect, useRef, useState } from "react";
import { geocode, prettyCategory } from "@/lib/geocode";
import { geocodeStops, type MotisStop } from "@/lib/routing";

export interface PickedPlace {
  name: string;
  lat: number;
  lon: number;
  id?: string;
  sub?: string;
}

interface Props {
  placeholder: string;
  kind: "address" | "stop";
  onPick: (place: PickedPlace) => void;
  getNearby?: () => [number, number] | undefined;
  autoFocus?: boolean;
  /** Controlled display label for an already-picked place. */
  selectedLabel?: string;
}

type Result = PickedPlace;

export function PlacePicker({
  placeholder,
  kind,
  onPick,
  getNearby,
  autoFocus,
  selectedLabel,
}: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipSearchRef = useRef(false);
  const lastSelectedRef = useRef<string | undefined>(undefined);
  const getNearbyRef = useRef(getNearby);
  useEffect(() => {
    getNearbyRef.current = getNearby;
  }, [getNearby]);

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      setBusy(false);
      return;
    }
    const text = q.trim();
    if (text.length < 2) {
      abortRef.current?.abort();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing a controlled async search
      setResults([]);
      setOpen(false);
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        if (kind === "stop") {
          const stops = await geocodeStops(text, ctrl.signal, 8);
          if (ctrl.signal.aborted) return;
          setResults(
            stops.map((s: MotisStop) => ({
              name: s.name,
              lat: s.lat,
              lon: s.lon,
              id: s.id,
              sub: s.modes?.slice(0, 3).join(" · "),
            })),
          );
        } else {
          const places = await geocode(text, {
            limit: 8,
            signal: ctrl.signal,
            nearby: getNearbyRef.current?.(),
          });
          if (ctrl.signal.aborted) return;
          setResults(
            places.map((p) => ({
              name: p.name || p.label,
              lat: p.coordinates[1],
              lon: p.coordinates[0],
              id: p.id,
              sub: prettyCategory(p.category) ?? p.label,
            })),
          );
        }
        setOpen(true);
        setHighlight(0);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setResults([]);
      } finally {
        if (!ctrl.signal.aborted) setBusy(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, kind]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (selectedLabel === lastSelectedRef.current) return;
    lastSelectedRef.current = selectedLabel;
    if (selectedLabel == null) return;
    skipSearchRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect parent selection in the field
    setQ(selectedLabel);
  }, [selectedLabel]);

  function choose(r: Result) {
    onPick(r);
    skipSearchRef.current = true;
    setQ(r.name);
    setOpen(false);
    setResults([]);
  }

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, results.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          }
          if (e.key === "Enter" && results[highlight]) {
            e.preventDefault();
            choose(results[highlight]);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className="ui-input"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[color:var(--ink-mute)]">
        {busy ? "…" : ""}
      </span>
      {open && results.length > 0 && (
        <ul
          role="listbox"
          aria-label={placeholder}
          className="ui-search-dropdown max-h-64 overflow-y-auto p-1"
        >
          {results.map((r, i) => (
            <li key={`${r.id ?? r.name}-${i}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                onClick={() => choose(r)}
                onMouseEnter={() => setHighlight(i)}
                data-active={i === highlight}
                className="ui-search-row rounded-[10px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[color:var(--ink)]">
                    {r.name}
                  </span>
                  {r.sub && (
                    <span className="block truncate text-[11.5px] text-[color:var(--ink-dim)]">
                      {r.sub}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
