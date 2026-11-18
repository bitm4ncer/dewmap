"use client";

import { useEffect, useId, useRef, useState } from "react";
import { visibleQuickPlaces } from "@/lib/places/quickPlaces";
import { geocode, prettyCategory, reverseGeocode } from "@/lib/geocode";
import { geocodeStops, type MotisStop } from "@/lib/routing";
import {
  ChevronDownIcon,
  ClockIcon,
  CloseIcon,
  MapPinIcon,
  RecenterIcon,
  StarIcon,
} from "@/components/ui/icons";

export interface PickedPlace {
  name: string;
  lat: number;
  lon: number;
  id?: string;
  sub?: string;
  city?: string;
  kind?: "address" | "stop";
}

interface Props {
  placeholder: string;
  kind: "address" | "stop" | "transit";
  onPick: (place: PickedPlace) => void;
  /** Called when the user edits/clears a previously selected place. */
  onClear?: () => void;
  getNearby?: () => [number, number] | undefined;
  autoFocus?: boolean;
  /** Controlled display label for an already-picked place. */
  selectedLabel?: string;
  /** The actual selected place, when the parent has one. */
  selectedPlace?: PickedPlace | null;
  /** Optional free-text city filter applied to every result. */
  cityFilter?: string;
  /** Saved / recent places shown as one-tap chips. */
  quickPlaces?: PickedPlace[];
  favorite?: boolean;
  onToggleFavorite?: () => void;
  /** Ask the parent to listen for the next map click. */
  onPickOnMap?: () => void;
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
  onClear,
  getNearby,
  autoFocus,
  selectedLabel,
  selectedPlace,
  cityFilter,
  quickPlaces = [],
  favorite = false,
  onToggleFavorite,
  onPickOnMap,
}: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipSearchRef = useRef(false);
  const lastSelectedRef = useRef<string | undefined>(undefined);
  const editingRef = useRef(false);
  const mountedRef = useRef(true);
  const getNearbyRef = useRef(getNearby);
  useEffect(() => {
    getNearbyRef.current = getNearby;
  }, [getNearby]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

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
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setBusy(true);
    setError(null);
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

        if (
          stopRes.status === "rejected"
          && placeRes.status === "rejected"
          && !ctrl.signal.aborted
        ) {
          throw new Error("Both place searches failed.");
        }

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
        const filtered = filter
          ? deduped.filter((r) =>
              normalize(`${r.city ?? ""} ${r.sub ?? ""}`).includes(filter),
            )
          : deduped;
        setResults(filtered);
        setOpen(true);
        setHighlight(0);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setResults([]);
        setOpen(true);
        setError("Search failed. Check your connection and try again.");
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
    const previous = lastSelectedRef.current;
    lastSelectedRef.current = selectedLabel;
    if (selectedLabel === previous) return;
    if (selectedLabel != null) {
      editingRef.current = false;
      skipSearchRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reflect parent selection in the field
      setQ(selectedLabel);
      setOpen(false);
      setResults([]);
      setError(null);
      return;
    }
    // Parent cleared the place. If the user is typing, leave their text alone.
    if (editingRef.current) return;
    skipSearchRef.current = true;
    setQ("");
    setOpen(false);
    setResults([]);
    setError(null);
  }, [selectedLabel]);

  function choose(r: Result) {
    editingRef.current = false;
    skipSearchRef.current = true;
    setQ(r.name);
    setOpen(false);
    setResults([]);
    setError(null);
    onPick(r);
  }

  function clear() {
    abortRef.current?.abort();
    editingRef.current = false;
    skipSearchRef.current = true;
    setQ("");
    setOpen(false);
    setResults([]);
    setError(null);
    onClear?.();
    inputRef.current?.focus();
  }

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Location is not available in this browser.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mountedRef.current) return;
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const ctrl = new AbortController();
        const timer = window.setTimeout(() => ctrl.abort(), 6000);
        void (async () => {
          let place: PickedPlace = {
            name: "My location",
            lat,
            lon,
            kind: "address",
            sub: "GPS",
          };
          try {
            const resolved = await reverseGeocode(lon, lat, {
              signal: ctrl.signal,
            });
            if (resolved) {
              place = {
                name: resolved.name,
                lat,
                lon,
                city: resolved.city,
                id: resolved.id,
                kind: "address",
                sub: "GPS",
              };
            }
          } finally {
            window.clearTimeout(timer);
          }
          if (!mountedRef.current) return;
          setLocating(false);
          choose(place);
        })();
      },
      (err) => {
        if (!mountedRef.current) return;
        setLocating(false);
        setError(err.message || "Could not read your location.");
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 12_000 },
    );
  }

  const showDropdown =
    open && (results.length > 0 || Boolean(error) || (q.trim().length >= 2 && !busy));
  const activeOption = results[highlight];
  const recents = visibleQuickPlaces(quickPlaces);
  const actionCount =
    (!selectedPlace ? 1 : 0) +
    (!selectedPlace && onPickOnMap ? 1 : 0) +
    (q ? 1 : 0);

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1">
      <div className="relative">
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={(e) => {
          const value = e.target.value;
          if (selectedPlace && !editingRef.current) {
            editingRef.current = true;
            onClear?.();
          }
          skipSearchRef.current = false;
          setQ(value);
          setError(null);
        }}
        onFocus={() => {
          if (results.length > 0 || error) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          }
          if (e.key === "Enter" && activeOption) {
            e.preventDefault();
            choose(activeOption);
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-controls={listId}
        aria-activedescendant={
          showDropdown && activeOption ? `${listId}-opt-${highlight}` : undefined
        }
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="search"
        className="ui-input"
        style={{ paddingRight: `${actionCount * 34 + 6}px` }}
      />
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {busy && (
          <span className="px-1 text-[11px] text-[color:var(--ink-mute)]" aria-hidden>
            …
          </span>
        )}
        {!selectedPlace && (
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            aria-label="Use my location"
            title="Use my location"
            className="ui-input-action text-[color:var(--ink)]"
          >
            {locating ? "…" : <RecenterIcon size={15} />}
          </button>
        )}
        {!selectedPlace && onPickOnMap && (
          <button
            type="button"
            onClick={onPickOnMap}
            aria-label="Pick on map"
            title="Pick on map"
            className="ui-input-action"
          >
            <MapPinIcon size={15} />
          </button>
        )}
        {q && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear place"
            title="Clear place"
            className="ui-input-action"
          >
            <CloseIcon size={15} />
          </button>
        )}
      </div>
      </div>

      {(recents.length > 0 || (selectedPlace && onToggleFavorite)) && (
        <div className="mt-1">
          <div className="flex items-center justify-between gap-2">
            {recents.length > 0 ? (
              <button
                type="button"
                onClick={() => setHistoryOpen((open) => !open)}
                aria-expanded={historyOpen}
                className="ui-history-toggle"
              >
                <ClockIcon size={13} />
                <span>History</span>
                <span className="ui-history-count">{recents.length}</span>
                <ChevronDownIcon
                  size={13}
                  className={historyOpen ? "rotate-180 transition-transform" : "transition-transform"}
                />
              </button>
            ) : (
              <span />
            )}
            {selectedPlace && onToggleFavorite && (
              <button
                type="button"
                onClick={onToggleFavorite}
                aria-pressed={favorite}
                aria-label={favorite ? "Remove saved place" : "Save place"}
                title={favorite ? "Remove saved place" : "Save place"}
                className="ui-input-action"
                data-active={favorite}
              >
                <StarIcon size={15} filled={favorite} />
              </button>
            )}
          </div>
          {historyOpen && (
            <div className="mt-2 flex flex-wrap gap-2">
              {recents.map((place) => (
                <button
                  key={`${place.id ?? place.name}-${place.lat}-${place.lon}`}
                  type="button"
                  onClick={() => choose(place)}
                  title={`${place.name}${place.city ? `, ${place.city}` : ""}`}
                  className="ui-chip max-w-[150px] truncate"
                >
                  {place.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <span className="sr-only" aria-live="polite">
        {busy
          ? "Searching places"
          : error
            ? error
            : showDropdown && results.length === 0 && q.trim().length >= 2
              ? "No places found"
              : ""}
      </span>

      {showDropdown && (
        <ul
          id={listId}
          role="listbox"
          aria-label={placeholder}
          className="ui-search-dropdown max-h-72 overflow-y-auto p-1"
        >
          {results.map((r, i) => (
            <li
              key={`${r.id ?? r.name}-${i}`}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === highlight}
            >
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
          {results.length === 0 && !busy && (
            <li className="px-3 py-2 text-[12px] text-[color:var(--ink-dim)]">
              {error ?? "No places found. Try a station name or a nearby address."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
