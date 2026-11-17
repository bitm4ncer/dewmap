"use client";

import { useEffect, useId, useRef, useState } from "react";
import { geocode, prettyCategory, type GeocodeResult } from "@/lib/geocode";

interface Props {
  onSelect: (result: GeocodeResult) => void;
  /** Returns [lng, lat] for the current viewport, used to bias results
   * toward what's on screen. Called lazily so map pans never re-render
   * the search field. */
  getNearby?: () => [number, number] | undefined;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; results: GeocodeResult[] }
  | { kind: "error"; message: string };

export function SearchBox({ onSelect, getNearby }: Props) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipSearchRef = useRef(false);
  const getNearbyRef = useRef(getNearby);
  useEffect(() => {
    getNearbyRef.current = getNearby;
  }, [getNearby]);
  const listId = useId();

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    if (query.trim().length < 2) {
      abortRef.current?.abort();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting a controlled async search
      setState({ kind: "idle" });
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = controller;
      setState({ kind: "loading" });
      try {
        const results = await geocode(query, {
          signal: controller.signal,
          limit: 8,
          nearby: getNearbyRef.current?.(),
        });
        if (!controller.signal.aborted) {
          setState({ kind: "ok", results });
          setHighlight(0);
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  function choose(r: GeocodeResult) {
    skipSearchRef.current = true;
    onSelect(r);
    setQuery(r.name || r.label);
    setFocused(false);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setFocused(false);
      (e.target as HTMLInputElement).blur();
      return;
    }
    if (state.kind !== "ok" || !state.results.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, state.results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(state.results[highlight]);
    }
  }

  const showDropdown =
    focused &&
    query.trim().length >= 2 &&
    (state.kind === "loading" || state.kind === "ok" || state.kind === "error");

  return (
    <div ref={boxRef} className="ui-search-wrap">
      <div className="ui-search-pill">
        <svg
          viewBox="0 0 16 16"
          className="h-[18px] w-[18px] shrink-0 text-[color:var(--ink-mute)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="7" cy="7" r="4.5" />
          <path d="m10.5 10.5 3 3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKey}
          placeholder="Search places, streets, stations"
          aria-label="Search places, streets, stations"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            showDropdown && state.kind === "ok" && state.results[highlight]
              ? `${listId}-${highlight}`
              : undefined
          }
          spellCheck={false}
          autoComplete="off"
          enterKeyHint="search"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setState({ kind: "idle" });
              abortRef.current?.abort();
            }}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[color:var(--ink-mute)] transition-colors hover:bg-[color:var(--surf-2)] hover:text-[color:var(--ink)]"
            aria-label="Clear search"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        ) : (
          <span className="ui-search-kbd hidden sm:inline" aria-hidden>
            /
          </span>
        )}
      </div>

      {showDropdown && (
        <div className="ui-search-dropdown">
          <div role="status" aria-live="polite" className="sr-only">
            {state.kind === "loading"
              ? "Searching"
              : state.kind === "ok"
                ? `${state.results.length} results`
                : state.kind === "error"
                  ? state.message
                  : ""}
          </div>
          {state.kind === "loading" && (
            <div className="px-3 py-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 py-2">
                  <div className="ui-skeleton h-8 w-8 rounded-[10px]" />
                  <div className="flex-1 space-y-1.5">
                    <div className="ui-skeleton h-3 w-1/2" />
                    <div className="ui-skeleton h-2.5 w-3/4" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {state.kind === "error" && (
            <div className="px-4 py-3 text-[13px] text-[color:var(--danger)]">
              {state.message}
            </div>
          )}
          {state.kind === "ok" && state.results.length === 0 && (
            <div className="px-4 py-4 text-[12.5px] text-[color:var(--ink-mute)]">
              No matches. Try a place, street, or station.
            </div>
          )}
          {state.kind === "ok" && state.results.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              aria-label="Search results"
              className="max-h-[min(60dvh,420px)] overflow-y-auto p-1"
            >
              {state.results.map((r, i) => {
                const category = prettyCategory(r.category);
                return (
                  <li
                    key={r.id}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={highlight === i}
                  >
                    <button
                      type="button"
                      onClick={() => choose(r)}
                      onMouseEnter={() => setHighlight(i)}
                      data-active={highlight === i}
                      className="ui-search-row rounded-[10px]"
                    >
                      <span className="ui-search-row-icon" aria-hidden>
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        >
                          <path d="M8 14s4.2-4.1 4.2-7A4.2 4.2 0 1 0 3.8 7c0 2.9 4.2 7 4.2 7Z" />
                          <circle cx="8" cy="7" r="1.4" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-[color:var(--ink)]">
                          {r.name || r.label}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] text-[color:var(--ink-dim)]">
                          <span className="truncate">
                            {r.label.replace(r.name ? `${r.name}, ` : "", "") ||
                              "—"}
                          </span>
                          {category && (
                            <span className="ui-badge ml-auto shrink-0">
                              {category}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
