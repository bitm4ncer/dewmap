"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MLMap, MapMouseEvent } from "maplibre-gl";
import { HudPanel } from "@/components/hud/HudPanel";
import {
  nowLocalInput,
  useTransit,
  type TransitPlace,
} from "@/lib/planner/transitStore";
import { PlacePicker, type PickedPlace } from "./PlacePicker";
import { JourneyCard } from "./JourneyCard";
import { JourneyDetail } from "./JourneyDetail";
import { useNavigation } from "@/lib/navigation/store";
import { SwapIcon } from "@/components/ui/icons";
import { planRoutes, isAbortError } from "@/lib/routing";
import {
  bestJourneyId,
  buildIcs,
  buildShareUrl,
  describeTransitError,
  filterJourneys,
  parseShareParams,
  sortJourneys,
  type JourneySort,
} from "@/lib/planner/transitFormat";

interface Props {
  mapRef: React.MutableRefObject<MLMap | null>;
  /** Collapse an expanded mobile sheet when a search succeeds. */
  onSearchComplete?: () => void;
}

const MODE_FILTERS = [
  { key: "RAIL", label: "Train" },
  { key: "BUS", label: "Bus" },
  { key: "TRAM", label: "Tram" },
  { key: "SUBWAY", label: "Metro" },
  { key: "FERRY", label: "Ferry" },
];

function placeKey(place: { name: string; lat: number; lon: number }): string {
  return `${place.name.trim().toLowerCase()}|${place.lat.toFixed(5)}|${place.lon.toFixed(5)}`;
}

function shiftLocal(value: string, days: number, minutes: number): string {
  const date = value ? new Date(value) : new Date();
  const base = Number.isNaN(date.getTime()) ? new Date() : date;
  base.setDate(base.getDate() + days);
  base.setMinutes(base.getMinutes() + minutes);
  return nowLocalInput(base);
}

function toTransitPlace(p: PickedPlace): TransitPlace {
  return {
    name: p.name,
    lat: p.lat,
    lon: p.lon,
    id: p.id,
    city: p.city,
    kind: p.kind,
  };
}

function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return nowLocalInput();
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? nowLocalInput() : nowLocalInput(date);
}

export function TransitPanel({ mapRef, onSearchComplete }: Props) {
  const from = useTransit((s) => s.from);
  const to = useTransit((s) => s.to);
  const via = useTransit((s) => s.via);
  const when = useTransit((s) => s.when);
  const arriveBy = useTransit((s) => s.arriveBy);
  const maxTransfers = useTransit((s) => s.maxTransfers);
  const cityFilter = useTransit((s) => s.cityFilter);
  const sort = useTransit((s) => s.sort);
  const maxWalkMin = useTransit((s) => s.maxWalkMin);
  const modes = useTransit((s) => s.modes);
  const accessible = useTransit((s) => s.accessible);
  const bike = useTransit((s) => s.bike);
  const autoRefresh = useTransit((s) => s.autoRefresh);
  const liveVehicles = useTransit((s) => s.liveVehicles);
  const liveVehicleCount = useTransit((s) => s.liveVehicleCount);
  const liveVehiclesUpdatedAt = useTransit((s) => s.liveVehiclesUpdatedAt);
  const liveVehiclesError = useTransit((s) => s.liveVehiclesError);
  const journeys = useTransit((s) => s.journeys);
  const selectedId = useTransit((s) => s.selectedId);
  const phase = useTransit((s) => s.phase);
  const notice = useTransit((s) => s.notice);
  const stale = useTransit((s) => s.stale);
  const lastSearchedAt = useTransit((s) => s.lastSearchedAt);
  const nextCursor = useTransit((s) => s.nextCursor);
  const previousCursor = useTransit((s) => s.previousCursor);
  const favorites = useTransit((s) => s.favorites);
  const recents = useTransit((s) => s.recents);

  const setFrom = useTransit((s) => s.setFrom);
  const setTo = useTransit((s) => s.setTo);
  const addVia = useTransit((s) => s.addVia);
  const setVia = useTransit((s) => s.setVia);
  const setViaAt = useTransit((s) => s.setViaAt);
  const removeVia = useTransit((s) => s.removeVia);
  const swap = useTransit((s) => s.swap);
  const setWhen = useTransit((s) => s.setWhen);
  const setArriveBy = useTransit((s) => s.setArriveBy);
  const setMaxTransfers = useTransit((s) => s.setMaxTransfers);
  const setCityFilter = useTransit((s) => s.setCityFilter);
  const setSort = useTransit((s) => s.setSort);
  const setMaxWalkMin = useTransit((s) => s.setMaxWalkMin);
  const setModes = useTransit((s) => s.setModes);
  const setAccessible = useTransit((s) => s.setAccessible);
  const setBike = useTransit((s) => s.setBike);
  const setAutoRefresh = useTransit((s) => s.setAutoRefresh);
  const setLiveVehicles = useTransit((s) => s.setLiveVehicles);
  const setJourneys = useTransit((s) => s.setJourneys);
  const selectJourney = useTransit((s) => s.selectJourney);
  const setPhase = useTransit((s) => s.setPhase);
  const setNotice = useTransit((s) => s.setNotice);
  const markStale = useTransit((s) => s.markStale);
  const toggleFavorite = useTransit((s) => s.toggleFavorite);
  const rememberPlace = useTransit((s) => s.rememberPlace);

  const startNavigation = useNavigation((s) => s.start);
  const abortRef = useRef<AbortController | null>(null);
  const lastFitRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const shareTimerRef = useRef<number | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [viaOpen, setViaOpen] = useState(false);
  const [mapPick, setMapPick] = useState<"from" | "to" | null>(null);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [swapTick, setSwapTick] = useState(0);

  const visibleJourneys = useMemo(
    () =>
      sortJourneys(
        filterJourneys(journeys, {
          city: cityFilter,
          maxWalkMin,
          modes,
          accessible,
          bike,
        }),
        sort,
      ),
    [journeys, cityFilter, maxWalkMin, modes, accessible, bike, sort],
  );
  const bestId = useMemo(() => bestJourneyId(visibleJourneys), [visibleJourneys]);
  const journey =
    visibleJourneys.find((j) => j.id === selectedId)
    ?? visibleJourneys[0]
    ?? null;
  const selectedVia = useMemo(
    () => via.filter((place): place is TransitPlace => place !== null),
    [via],
  );
  const viaSlots: (TransitPlace | null)[] =
    via.length > 0 ? via : viaOpen ? [null] : [];
  const quickPlaces = useMemo(() => {
    const seen = new Set<string>();
    const result: PickedPlace[] = [];
    for (const place of [...favorites, ...recents]) {
      const key = placeKey(place);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(place);
      if (result.length >= 5) break;
    }
    return result;
  }, [favorites, recents]);

  const fromFavorite = from ? favorites.some((p) => placeKey(p) === placeKey(from)) : false;
  const toFavorite = to ? favorites.some((p) => placeKey(p) === placeKey(to)) : false;

  const pick = useCallback(
    (target: "from" | "to", p: PickedPlace) => {
      const place = toTransitPlace(p);
      if (target === "from") setFrom(place);
      else setTo(place);
      rememberPlace(place);
    },
    [rememberPlace, setFrom, setTo],
  );

  const search = useCallback(
    async (options: {
      cursor?: string;
      silent?: boolean;
      when?: string;
    } = {}) => {
      if (!from || !to) {
        setNotice("Choose a start and destination first.");
        return;
      }
      if (
        Math.abs(from.lat - to.lat) < 1e-6
        && Math.abs(from.lon - to.lon) < 1e-6
      ) {
        setNotice("Start and destination are identical.");
        return;
      }
      const viaIds = selectedVia
        .map((place) => place.id)
        .filter((id): id is string => Boolean(id));
      if (selectedVia.length > 0 && viaIds.length !== selectedVia.length) {
        setNotice("Choose a station for each via stop.");
        return;
      }
      const effectiveWhen = options.when ?? when;
      const departAt = effectiveWhen ? new Date(effectiveWhen) : new Date();
      if (Number.isNaN(departAt.getTime())) {
        setNotice("Choose a valid date and time.");
        return;
      }

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setPhase({ kind: "routing" });
      if (!options.silent) setNotice(null);

      try {
        const plans = await planRoutes({
          mode: "transit",
          waypoints: [
            { lat: from.lat, lon: from.lon },
            { lat: to.lat, lon: to.lon },
          ],
          fromPlace: from.kind === "stop" ? from.id : undefined,
          toPlace: to.kind === "stop" ? to.id : undefined,
          via: viaIds.length > 0 ? viaIds : undefined,
          departAt: departAt.toISOString(),
          arriveBy,
          maxTransfers,
          wheelchair: accessible || undefined,
          alternatives: 5,
          signal: ctrl.signal,
          options: {
            detailedTransfers: true,
            searchWindowS: 1800,
            pageCursor: options.cursor,
            transitModes: modes.length > 0 ? modes : undefined,
            maxPreTransitTimeS: maxWalkMin * 60,
            maxPostTransitTimeS: maxWalkMin * 60,
            requireWheelchairAccessible: accessible,
            requireBikesAllowed: bike,
            viaMinimumStay: viaIds.length > 0 ? viaIds.map(() => 1) : undefined,
          },
        });
        if (ctrl.signal.aborted || !mountedRef.current) return;
        setJourneys(plans, plans[0]?.meta);
        if (plans.length === 0) {
          setNotice("No connections found for this time.");
        }
        onSearchComplete?.();
      } catch (err) {
        if (isAbortError(err) || ctrl.signal.aborted || !mountedRef.current) return;
        if (options.cursor) {
          setPhase({ kind: "routed" });
          setNotice("No more connections in that direction.");
          return;
        }
        const message = describeTransitError(err) || "Transit search failed.";
        setPhase({ kind: "error", message });
        if (journeys.length > 0) {
          markStale();
          setNotice("Refresh failed. Showing the previous results.");
        }
      }
    },
    [
      accessible,
      arriveBy,
      bike,
      from,
      journeys.length,
      markStale,
      maxTransfers,
      maxWalkMin,
      modes,
      onSearchComplete,
      setJourneys,
      setNotice,
      setPhase,
      selectedVia,
      to,
      when,
    ],
  );

  // A fresh mount starts at the current minute, never a rounded future time.
  useEffect(() => {
    if (!when) setWhen(nowLocalInput());
  }, [setWhen, when]);

  // Any place change aborts an in-flight request, not just the next button press.
  useEffect(() => {
    abortRef.current?.abort();
  }, [from?.lat, from?.lon, to?.lat, to?.lon, selectedVia]);

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
    };
  }, []);

  // Deep link: ?trFrom=...&trTo=...&trWhen=...
  useEffect(() => {
    if (typeof window === "undefined") return;
    const parsed = parseShareParams(window.location.search);
    if (!parsed) return;
    if (parsed.from) setFrom(parsed.from);
    if (parsed.to) setTo(parsed.to);
    setVia(parsed.via.slice(0, 2));
    if (parsed.when) setWhen(parsed.when);
    if (parsed.arriveBy) setArriveBy(true);
    if (parsed.maxTransfers !== null) setMaxTransfers(parsed.maxTransfers);
    if (parsed.wheelchair) setAccessible(true);
    const url = new URL(window.location.href);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("tr")) url.searchParams.delete(key);
    }
    window.history.replaceState({}, "", url);
  }, [setAccessible, setArriveBy, setFrom, setMaxTransfers, setTo, setVia, setWhen]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !journey || lastFitRef.current === journey.id) return;
    if (journey.coordinates.length < 2) return;
    let south = Infinity;
    let west = Infinity;
    let north = -Infinity;
    let east = -Infinity;
    for (const [lon, lat] of journey.coordinates) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    if (!Number.isFinite(south)) return;
    const fit = () => {
      const sheet =
        typeof document === "undefined"
          ? null
          : document.querySelector<HTMLElement>("[data-sheet-state]");
      const mobile = typeof window !== "undefined" && window.innerWidth < 768;
      const sheetHeight = sheet?.getBoundingClientRect().height ?? 280;
      const bottom = mobile
        ? Math.min(Math.max(sheetHeight, 160), window.innerHeight * 0.55)
        : 80;
      lastFitRef.current = journey.id;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: { top: 90, bottom, left: 48, right: 48 },
          duration: 650,
          maxZoom: 14,
        },
      );
    };
    if (map.isMoving()) {
      map.once("moveend", fit);
      return () => {
        map.off("moveend", fit);
      };
    }
    fit();
    return undefined;
  }, [journey, mapRef]);

  // Auto-refresh is opt-in: Transitous documents a 720 requests/day/IP budget.
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
  useEffect(() => {
    if (swapTick === 0) return;
    void searchRef.current();
  }, [swapTick]);

  useEffect(() => {
    if (!autoRefresh || journeys.length === 0) return;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      if (useTransit.getState().phase.kind === "routing") return;
      void searchRef.current({ silent: true });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [autoRefresh, journeys.length]);

  // Listen for one map click when "Map" is active.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapPick) return;
    const canvas = map.getCanvas();
    const previous = canvas.style.cursor;
    canvas.style.cursor = "crosshair";
    const handler = (event: MapMouseEvent) => {
      const place: TransitPlace = {
        name: "Map point",
        lat: event.lngLat.lat,
        lon: event.lngLat.lng,
        kind: "address",
      };
      if (mapPick === "from") setFrom(place);
      else setTo(place);
      rememberPlace(place);
      setMapPick(null);
    };
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMapPick(null);
    };
    map.once("click", handler);
    window.addEventListener("keydown", cancel);
    return () => {
      map.off("click", handler);
      window.removeEventListener("keydown", cancel);
      canvas.style.cursor = previous;
    };
  }, [mapPick, mapRef, rememberPlace, setFrom, setTo]);

  function share() {
    if (typeof window === "undefined") return;
    const url = buildShareUrl(window.location.href, {
      from,
      to,
      via: selectedVia,
      when,
      arriveBy,
      maxTransfers,
      wheelchair: accessible,
    });
    const done = (message: string) => {
      setShareNotice(message);
      if (shareTimerRef.current) window.clearTimeout(shareTimerRef.current);
      shareTimerRef.current = window.setTimeout(() => setShareNotice(null), 4000);
    };
    if (navigator.share) {
      navigator
        .share({ title: "Transit journey", url })
        .then(() => done("Shared."))
        .catch(() => {
          if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(
              () => done("Link copied."),
              () => done("Could not share the link."),
            );
          } else {
            done("Could not share the link.");
          }
        });
      return;
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => done("Link copied."),
        () => done("Could not copy the link."),
      );
      return;
    }
    window.prompt("Copy this link", url);
  }

  function calendar() {
    if (!journey) return;
    const ics = buildIcs(journey);
    if (!ics) {
      setNotice("Calendar export is not available for this journey.");
      return;
    }
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "biosphere-transit.ics";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const cancelled = journey?.transit?.legs.some((leg) => leg.cancelled) ?? false;
  const arrival = journey?.transit ? Date.parse(journey.transit.arrival) : NaN;
  const ended = nowMs > 0 && Number.isFinite(arrival) && arrival < nowMs;
  const startDisabled = !journey || cancelled || ended;
  const startHint = cancelled
    ? "This connection is cancelled."
    : ended
      ? "This connection has already ended."
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <HudPanel>
        <div className="ui-section">
          <span className="ui-kicker">Train &amp; local transit</span>
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <PlacePicker
                placeholder="From station or address"
                kind="transit"
                cityFilter={cityFilter}
                selectedLabel={
                  from ? `${from.name}${from.city ? ` · ${from.city}` : ""}` : undefined
                }
                selectedPlace={from}
                quickPlaces={quickPlaces}
                favorite={fromFavorite}
                onToggleFavorite={from ? () => toggleFavorite(from) : undefined}
                onPickOnMap={() => setMapPick("from")}
                onPick={(p) => pick("from", p)}
                onClear={() => setFrom(null)}
                getNearby={() => {
                  const m = mapRef.current;
                  if (!m) return undefined;
                  const c = m.getCenter();
                  return [c.lng, c.lat];
                }}
              />
              <PlacePicker
                placeholder="To station or address"
                kind="transit"
                cityFilter={cityFilter}
                selectedLabel={
                  to ? `${to.name}${to.city ? ` · ${to.city}` : ""}` : undefined
                }
                selectedPlace={to}
                quickPlaces={quickPlaces}
                favorite={toFavorite}
                onToggleFavorite={to ? () => toggleFavorite(to) : undefined}
                onPickOnMap={() => setMapPick("to")}
                onPick={(p) => pick("to", p)}
                onClear={() => setTo(null)}
                getNearby={() => {
                  const m = mapRef.current;
                  if (!m) return undefined;
                  const c = m.getCenter();
                  return [c.lng, c.lat];
                }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                const hadBoth = Boolean(from && to);
                swap();
                if (hadBoth) setSwapTick((tick) => tick + 1);
              }}
              aria-label="Swap origin and destination"
              className="hud-icon-btn w-11 shrink-0 self-center"
            >
              <SwapIcon size={18} />
            </button>
          </div>

          {mapPick && (
            <div className="flex items-center justify-between gap-2 rounded-[10px] bg-[color:var(--accent-soft)] px-2 py-1.5 text-[11.5px]">
              <span>
                Click the map to set {mapPick === "from" ? "A" : "B"}.
              </span>
              <button
                type="button"
                onClick={() => setMapPick(null)}
                className="ui-badge"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="hud-label w-12 shrink-0">City</span>
            <input
              type="text"
              value={cityFilter}
              onChange={(e) => setCityFilter(e.target.value)}
              placeholder="Filter stops and results by city"
              aria-label="Filter stops and results by city"
              className="ui-input !min-h-10"
              spellCheck={false}
            />
          </div>

          {(from || to) && (
            <div className="flex flex-col gap-1.5 text-[11.5px]">
              {from && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="ui-badge" data-tone="accent">A · {from.name}</span>
                  {from.city && <span className="ui-badge">{from.city}</span>}
                  <span className="text-[color:var(--ink-dim)]">
                    {from.kind === "address" ? "Address (walk access)" : "Station"}
                  </span>
                </div>
              )}
              {to && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="ui-badge">B · {to.name}</span>
                  {to.city && <span className="ui-badge">{to.city}</span>}
                  <span className="text-[color:var(--ink-dim)]">
                    {to.kind === "address" ? "Address (walk egress)" : "Station"}
                  </span>
                </div>
              )}
              {selectedVia.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="ui-badge">Via</span>
                  {selectedVia.map((place, index) => (
                    <span key={`${placeKey(place)}-${index}`} className="ui-badge">
                      {index + 1}. {place.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="rounded-[10px] bg-[color:var(--surf-2)] p-2">
            <div className="flex items-center justify-between gap-2">
              <span>
                <span className="ui-row-title">Via stations</span>
                <span className="ui-row-sub block">
                  Route through up to two stations. A one-minute minimum stay
                  makes the via stop mandatory.
                </span>
              </span>
              {selectedVia.length === 0 && (
                <button
                  type="button"
                  className="ui-badge !min-h-10 shrink-0"
                  onClick={() => {
                    if (viaOpen || via.length > 0) {
                      setViaOpen(false);
                      if (via.length > 0) removeVia(0);
                      return;
                    }
                    setViaOpen(true);
                  }}
                  aria-expanded={viaOpen || via.length > 0}
                >
                  {viaOpen || via.length > 0 ? "Hide" : "Add via"}
                </button>
              )}
            </div>
            {viaSlots.length > 0 && (
              <div className="mt-2 flex flex-col gap-2">
                {viaSlots.map((place, index) => (
                  <PlacePicker
                    key={`via-${index}`}
                    placeholder={`Via station ${index + 1}`}
                    kind="stop"
                    cityFilter={cityFilter}
                    selectedLabel={
                      place
                        ? `${place.name}${place.city ? ` · ${place.city}` : ""}`
                        : undefined
                    }
                    selectedPlace={place}
                    onPick={(picked) => setViaAt(index, toTransitPlace(picked))}
                    onClear={() => setViaAt(index, null)}
                  />
                ))}
                {viaSlots.length < 2 && viaSlots[viaSlots.length - 1] !== null && (
                  <PlacePicker
                    key="via-extra"
                    placeholder="Add a second via station"
                    kind="stop"
                    cityFilter={cityFilter}
                    onPick={(picked) => addVia(toTransitPlace(picked))}
                  />
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={liveVehicles}
            onClick={() => setLiveVehicles(!liveVehicles)}
            className="flex min-h-10 items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="ui-row-title">Live vehicles on map</span>
              <span className="ui-row-sub block">
                Show real-time vehicles in the current map view. Positions are
                interpolated between stops.
              </span>
            </span>
            <span className="hud-switch" data-on={liveVehicles} aria-hidden>
              <span className="hud-switch-thumb" />
            </span>
          </button>
          {liveVehicles && (
            <p className="text-[10.5px] text-[color:var(--ink-mute)]" aria-live="polite">
              {liveVehiclesError
                ? liveVehiclesError
                : liveVehicleCount > 0
                  ? `${liveVehicleCount} vehicle${liveVehicleCount === 1 ? "" : "s"} in view`
                  : "No vehicles in view; pan or zoom in."}
              {liveVehiclesUpdatedAt && !liveVehiclesError
                ? ` · updated ${new Date(liveVehiclesUpdatedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : ""}
            </p>
          )}
        </div>
      </HudPanel>

      <HudPanel>
        <div className="ui-section">
          <span className="ui-kicker">When</span>
          <div className="ui-segmented" role="group" aria-label="Depart or arrive">
            <button
              type="button"
              className="ui-seg"
              data-active={!arriveBy}
              aria-pressed={!arriveBy}
              onClick={() => setArriveBy(false)}
            >
              Depart at
            </button>
            <button
              type="button"
              className="ui-seg"
              data-active={arriveBy}
              aria-pressed={arriveBy}
              onClick={() => setArriveBy(true)}
            >
              Arrive by
            </button>
          </div>
          <input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="ui-input"
            aria-label="Travel date and time"
          />
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="ui-badge hover:bg-[color:var(--surf-3)]"
              onClick={() => setWhen(nowLocalInput())}
            >
              Now
            </button>
            <button
              type="button"
              className="ui-badge hover:bg-[color:var(--surf-3)]"
              onClick={() => setWhen(shiftLocal(when, 0, 60))}
            >
              +1 h
            </button>
            <button
              type="button"
              className="ui-badge hover:bg-[color:var(--surf-3)]"
              onClick={() => setWhen(shiftLocal(when, 1, 0))}
            >
              Tomorrow
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="ui-row-title">Max transfers</span>
            <div className="ui-segmented flex-wrap">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="ui-seg"
                  data-active={maxTransfers === n}
                  aria-pressed={maxTransfers === n}
                  onClick={() => setMaxTransfers(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={accessible}
            onClick={() => setAccessible(!accessible)}
            className="flex min-h-10 items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="ui-row-title">Step-free / wheelchair</span>
              <span className="ui-row-sub block">
                Require accessible vehicles where data is available.
              </span>
            </span>
            <span className="hud-switch" data-on={accessible} aria-hidden>
              <span className="hud-switch-thumb" />
            </span>
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={bike}
            onClick={() => setBike(!bike)}
            className="flex min-h-10 items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="ui-row-title">Bicycle</span>
              <span className="ui-row-sub block">
                Require bike carriage where operators publish it.
              </span>
            </span>
            <span className="hud-switch" data-on={bike} aria-hidden>
              <span className="hud-switch-thumb" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => void search()}
            disabled={phase.kind === "routing" || !from || !to}
            className="hud-btn-primary mt-1 w-full"
          >
            {phase.kind === "routing" ? "Searching…" : "Find connections"}
          </button>
        </div>
      </HudPanel>

      <HudPanel>
        <div className="ui-section">
          <button
            type="button"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            className="flex min-h-10 w-full items-center justify-between gap-2 text-left"
          >
            <span className="ui-kicker">Filters &amp; sorting</span>
            <span className="text-[11px] text-[color:var(--ink-mute)]">
              {advancedOpen ? "Hide" : "Show"}
            </span>
          </button>
          {advancedOpen && (
            <>
              <label className="flex items-center justify-between gap-2">
                <span className="ui-row-title">Sort</span>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as JourneySort)}
                  className="ui-input !min-h-10 !w-[170px]"
                  aria-label="Sort connections"
                >
                  <option value="best">Best</option>
                  <option value="departure">Earliest departure</option>
                  <option value="arrival">Earliest arrival</option>
                  <option value="duration">Shortest</option>
                  <option value="transfers">Fewest changes</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between">
                  <span className="ui-row-title">Max walk</span>
                  <span className="text-[11px] text-[color:var(--ink-dim)]">
                    {maxWalkMin} min
                  </span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={5}
                  value={Math.min(maxWalkMin, 30)}
                  onChange={(e) => setMaxWalkMin(Number(e.target.value))}
                  aria-label="Maximum walking time in minutes"
                  className="w-full accent-[color:var(--accent)]"
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="ui-row-title">Modes</span>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className="ui-badge"
                    data-tone={modes.length === 0 ? "accent" : undefined}
                    aria-pressed={modes.length === 0}
                    onClick={() => setModes([])}
                  >
                    All
                  </button>
                  {MODE_FILTERS.map((mode) => (
                    <button
                      key={mode.key}
                      type="button"
                      className="ui-badge"
                      data-tone={modes.includes(mode.key) ? "accent" : undefined}
                      aria-pressed={modes.includes(mode.key)}
                      onClick={() =>
                        setModes(
                          modes.includes(mode.key)
                            ? modes.filter((m) => m !== mode.key)
                            : [...modes, mode.key],
                        )
                      }
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoRefresh}
                onClick={() => setAutoRefresh(!autoRefresh)}
                className="flex min-h-10 items-center justify-between gap-3 text-left"
              >
                <span>
                  <span className="ui-row-title">Auto-refresh</span>
                  <span className="ui-row-sub block">
                    Update live results every 60 seconds while visible.
                  </span>
                </span>
                <span className="hud-switch" data-on={autoRefresh} aria-hidden>
                  <span className="hud-switch-thumb" />
                </span>
              </button>
            </>
          )}
        </div>
      </HudPanel>

      {journeys.length > 0 && (
        <HudPanel>
          <div className="ui-section" aria-busy={phase.kind === "routing"}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="ui-kicker">
                Connections · {visibleJourneys.length}
                {visibleJourneys.length !== journeys.length
                  ? ` / ${journeys.length}`
                  : ""}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={share}
                  className="ui-badge !min-h-11 !px-3"
                  aria-label="Share this transit search"
                >
                  Share
                </button>
                <button
                  type="button"
                  onClick={() => void search()}
                  disabled={phase.kind === "routing"}
                  className="ui-badge !min-h-11 !px-3"
                  aria-label="Refresh connections"
                >
                  {phase.kind === "routing" ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-[color:var(--ink-mute)]">
              {lastSearchedAt && (
                <span>
                  Updated{" "}
                  {new Date(lastSearchedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )}
              {stale && <span className="ui-badge" data-tone="warn">Outdated</span>}
              {nextCursor || previousCursor ? (
                <span>Earlier / later available</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className="ui-badge !min-h-11 !px-3"
                disabled={phase.kind === "routing"}
                onClick={() => {
                  if (previousCursor) {
                    void search({ cursor: previousCursor });
                    return;
                  }
                  const first = visibleJourneys[0]?.transit?.departure;
                  if (!first) return;
                  const nextWhen = shiftLocal(isoToLocalInput(first), 0, -30);
                  setWhen(nextWhen);
                  void search({ when: nextWhen });
                }}
              >
                Earlier
              </button>
              <button
                type="button"
                className="ui-badge !min-h-11 !px-3"
                disabled={phase.kind === "routing"}
                onClick={() => {
                  if (nextCursor) {
                    void search({ cursor: nextCursor });
                    return;
                  }
                  const last = visibleJourneys[visibleJourneys.length - 1]?.transit?.arrival;
                  if (!last) return;
                  const nextWhen = shiftLocal(isoToLocalInput(last), 0, 30);
                  setWhen(nextWhen);
                  void search({ when: nextWhen });
                }}
              >
                Later
              </button>
            </div>
            {visibleJourneys.length === 0 ? (
              <p className="text-[12px] text-[color:var(--warn)]">
                No connections match these filters.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => {
                    setCityFilter("");
                    setModes([]);
                    setMaxWalkMin(30);
                    setAccessible(false);
                    setBike(false);
                  }}
                >
                  Clear filters
                </button>
              </p>
            ) : (
              visibleJourneys.map((entry) => (
                <JourneyCard
                  key={entry.id}
                  journey={entry}
                  best={entry.id === bestId}
                  active={entry.id === journey?.id}
                  onSelect={() => selectJourney(entry.id)}
                />
              ))
            )}
          </div>
        </HudPanel>
      )}

      {journey && (
        <HudPanel>
          <JourneyDetail
            journey={journey}
            onStart={() => startNavigation(journey)}
            onPreview={() => startNavigation(journey, { simulate: true })}
            onShare={share}
            onCalendar={calendar}
            startDisabled={startDisabled}
            startHint={startHint}
          />
        </HudPanel>
      )}

      {phase.kind === "error" && (
        <p className="px-1 text-[12px] text-[color:var(--danger)]">
          {phase.message}
        </p>
      )}
      {notice && phase.kind !== "error" && (
        <p className="px-1 text-[12px] text-[color:var(--warn)]">{notice}</p>
      )}
      {shareNotice && (
        <p className="px-1 text-[12px] text-[color:var(--ink-dim)]">{shareNotice}</p>
      )}
      <p className="sr-only" aria-live="polite">
        {phase.kind === "routing"
          ? "Searching connections"
          : notice ??
            (journeys.length > 0
              ? `${visibleJourneys.length} connections shown`
              : "")}
      </p>

      <p className="px-1 text-[10.5px] leading-relaxed text-[color:var(--ink-mute)]">
        Routing by Transitous (MOTIS) · schedules and real-time data from
        DELFI/GTFS.de, OpenStreetMap and local operators. Each stop is shown in
        its own local time zone.
      </p>
    </div>
  );
}
