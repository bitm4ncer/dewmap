"use client";

import { useEffect, useRef, useState } from "react";
import { geocode, prettyCategory } from "@/lib/geocode";
import { geocodeStops, type MotisStop } from "@/lib/routing";
import { findNearestStation } from "@/lib/planner/nearestStation";

export interface PickedPlace {
  name: string;
  lat: number;
  lon: number;
  id?: string;
  sub?: string;
  city?: string;
  kind?: "address" | "stop";
  station?: {
    name: string;
    lat: number;
    lon: number;
    city?: string;
    distanceM?: number;
  };
}

interface Props {
  placeholder: string;
  kind: "address" | "stop" | "transit";
  onPick: (place: PickedPlace) => void;
  getNearby?: () => [number, number] | undefined;
  autoFocus?: boolean;
  /** Controlled display label for an already-picked place. */
  selectedLabel?: string;
  /** Optional free-text city filter applied to every result. */
  cityFilter?: string;
}

type Result = PickedPlace;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function PlacePicker({
  placeholder,
  kind,
  onPick,
  getNearby,
  autoFocus,
  selectedLabel,
  cityFilter,
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
  const mountedRef = useRef(true);
  const getNearbyRef = useRef(getNearby);
  useEffect(() => {
    getNearbyRef.current = getNearby;
  }, [getNearby]);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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
    const cityQuery = cityFilter?.trim() ?? "";
    const query = cityQuery ? `${text} ${cityQuery}` : text;
    const timer = window.setTimeout(async () => {
      try {
        const [stopRes, placeRes] = await Promise.allSettled([
          kind === "address"
            ? Promise.resolve<MotisStop[]>([])
            : geocodeStops(query, ctrl.signal, 8),
          kind === "stop"
            ? Promise.resolve([])
            : geocode(query, {
                limit: 8,
                signal: ctrl.signal,
                nearby: getNearbyRef.current?.(),
              }),
        ]);
        if (ctrl.signal.aborted) return;

        const stops: Result[] =
          stopRes.status === "fulfilled"
            ? stopRes.value.map((s) => ({
                name: s.name,
                lat: s.lat,
                lon: s.lon,
                id: s.id,
                city: s.city,
                kind: "stop" as const,
                sub: s.modes?.slice(0, 3).join(" · "),
              }))
            : [];

        const addresses: Result[] =
          placeRes.status === "fulfilled"
            ? placeRes.value.map((p) => ({
                name: p.name || p.label,
                lat: p.coordinates[1],
                lon: p.coordinates[0],
                id: p.id,
                city: p.city,
                kind: "address" as const,
                sub: prettyCategory(p.category) ?? p.label,
              }))
            : [];

        const merged =
          kind === "transit"
            ? [...stops.slice(0, 4), ...addresses.slice(0, 5)]
            : kind === "stop"
              ? stops.slice(0, 8)
              : addresses.slice(0, 8);

        const seen = new Set<string>();
        const deduped = merged.filter((r) => {
          const key = `${normalize(r.name)}|${normalize(r.city ?? "")}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        const filter = normalize(cityFilter?.trim() ?? "");
        setResults(
          filter
            ? deduped.filter((r) =>
                normalize(`${r.city ?? ""} ${r.sub ?? ""}`).includes(filter),
              )
            : deduped,
        );
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
  }, [q, kind, cityFilter]);

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
    setOpen(false);
    setResults([]);
  }, [selectedLabel]);

  async function choose(r: Result) {
    skipSearchRef.current = true;
    setQ(r.name);
    setOpen(false);
    setResults([]);

    if (kind === "transit" && r.kind === "address") {
      setBusy(true);
      const station = await findNearestStation(r.lat, r.lon, r.name, r.city);
      if (!mountedRef.current) return;
      setBusy(false);
      onPick({
        ...r,
        city: r.city ?? station?.city,
        station: station
          ? {
              name: station.name,
              lat: station.lat,
              lon: station.lon,
              city: station.city,
              distanceM: Math.round(station.distanceM),
            }
          : undefined,
      });
      return;
    }

    onPick(r);
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
            void choose(results[highlight]);
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
          className="ui-search-dropdown max-h-72 overflow-y-auto p-1"
        >
          {results.map((r, i) => (
            <li
              key={`${r.id ?? r.name}-${i}`}
              role="option"
              aria-selected={i === highlight}
            >
              <button
                type="button"
                onClick={() => void choose(r)}
                onMouseEnter={() => setHighlight(i)}
                data-active={i === highlight}
                className="ui-search-row rounded-[10px]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-[color:var(--ink)]">
                    {r.name}
                  </span>
                  <span className="block truncate text-[11.5px] text-[color:var(--ink-dim)]">
                    {r.kind === "stop" ? "Station" : "Address"}
                    {r.sub ? ` · ${r.sub}` : ""}
                  </span>
                </span>
                {r.city && (
                  <span className="ui-badge shrink-0">{r.city}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
