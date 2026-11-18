"use client";
/* eslint-disable @next/next/no-img-element -- remote OSM/Wikimedia photos with unknown dimensions */

import { useEffect, useRef, useState } from "react";
import { fetchPoiDetails } from "@/lib/poi";
import type { PoiDetails, PoiSelection } from "@/lib/poi";
import { parseOpeningHours } from "@/lib/poi/openingHours";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  CloseIcon,
  DirectionsIcon,
  ExternalLinkIcon,
  GlobeIcon,
  ImageIcon,
  MailIcon,
  PhoneIcon,
} from "@/components/ui/icons";

interface Props {
  selection: PoiSelection | null;
  onClose: () => void;
  onDirections?: (selection: PoiSelection) => void;
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

function PoiDetailContent({ selection, onClose, onDirections }: ContentProps) {
  const [details, setDetails] = useState<PoiDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [activeImage, setActiveImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ y: number; moved: boolean } | null>(null);
  const heroDragRef = useRef<{ y: number; moved: boolean } | null>(null);
  const suppressTapRef = useRef(false);

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
    if (expanded) cardRef.current?.focus({ preventScroll: true });
  }, [expanded]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (expanded) setExpanded(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, onClose]);

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
  const name = details?.name || selection.name || "Loading place…";
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
  const address = details?.address || labelAddress;
  const opening = details?.opening
    ? (parseOpeningHours(details.opening.raw) ?? details.opening)
    : undefined;
  const status =
    opening?.openNow === true
      ? { label: "Open now", tone: "open" as const }
      : opening?.openNow === false
        ? { label: "Closed", tone: "closed" as const }
        : null;

  const directionsSelection: PoiSelection = {
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

  const startDrag = (
    target: React.RefObject<{ y: number; moved: boolean } | null>,
    y: number,
  ) => {
    target.current = { y, moved: false };
  };

  const moveDrag = (
    target: React.RefObject<{ y: number; moved: boolean } | null>,
    y: number,
  ) => {
    const drag = target.current;
    if (!drag) return;
    if (Math.abs(y - drag.y) > 10) {
      drag.moved = true;
    }
  };

  const finishCompactDrag = (y: number) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) return;
    const dy = y - drag.y;
    if (Math.abs(dy) <= 30) return;
    // The browser may skip the synthetic click after a touch gesture.
    // Reset the suppressor shortly after so the next real tap is not lost.
    suppressTapRef.current = true;
    window.setTimeout(() => {
      suppressTapRef.current = false;
    }, 400);
    if (dy < -30) setExpanded(true);
    else onClose();
  };

  const finishHeroDrag = (y: number) => {
    const drag = heroDragRef.current;
    heroDragRef.current = null;
    if (drag?.moved && y - drag.y > 40) setExpanded(false);
  };

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      className="poi-detail"
      role="region"
      aria-label="Place details"
      data-loading={loading ? "true" : "false"}
      data-expanded={expanded ? "true" : "false"}
    >
      {!expanded ? (
        <div
          className="poi-mini"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest(".poi-mini-actions")) return;
            startDrag(dragRef, e.clientY);
          }}
          onPointerMove={(e) => moveDrag(dragRef, e.clientY)}
          onPointerUp={(e) => finishCompactDrag(e.clientY)}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        >
          <span className="poi-grip" aria-hidden />
          <button
            type="button"
            className="poi-mini-main"
            onClick={() => {
              if (suppressTapRef.current) {
                suppressTapRef.current = false;
                return;
              }
              setExpanded(true);
            }}
            aria-label={`Open details for ${name}`}
          >
            <span className="poi-mini-thumb">
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
            </span>
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
          <div className="poi-mini-actions">
            {onDirections && (
              <button
                type="button"
                className="poi-mini-btn"
                onClick={() => onDirections(directionsSelection)}
                aria-label="Directions"
                title="Directions"
              >
                <DirectionsIcon size={18} />
              </button>
            )}
            <button
              type="button"
              className="poi-mini-btn"
              onClick={() => setExpanded(true)}
              aria-label="Expand place details"
            >
              <ChevronUpIcon size={18} />
            </button>
            <button
              type="button"
              className="poi-mini-btn"
              onClick={onClose}
              aria-label="Close place details"
            >
              <CloseIcon size={18} />
            </button>
          </div>
        </div>
      ) : (
        <div className="poi-scroll">
          <div
            className={`poi-hero${hasImage ? "" : " poi-hero--empty"}`}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button, a")) return;
              startDrag(heroDragRef, e.clientY);
            }}
            onPointerMove={(e) => {
              if (!heroDragRef.current) return;
              const drag = heroDragRef.current;
              if (Math.abs(e.clientY - drag.y) > 10) drag.moved = true;
            }}
            onPointerUp={(e) => finishHeroDrag(e.clientY)}
            onPointerCancel={() => {
              heroDragRef.current = null;
            }}
          >
            {hasImage && current && (
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
            )}
            {!hasImage || !imageReady ? (
              <div className="poi-hero-fallback">
                <ImageIcon size={26} />
                <span>{category}</span>
              </div>
            ) : null}
            <div className="poi-hero-shade" />
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="poi-close poi-collapse"
              aria-label="Minimize place details"
            >
              <ChevronDownIcon size={19} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="poi-close"
              aria-label="Close place details"
            >
              <CloseIcon size={19} />
            </button>
            {hasImage && current && (
              <a
                className="poi-credit"
                href={current.href ?? current.url}
                target="_blank"
                rel="noreferrer noopener"
                title={current.license ? `Licence: ${current.license}` : undefined}
              >
                {current.credit}
              </a>
            )}
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

          <div className="poi-body">
            <p className="ui-kicker">
              {category}
              {city ? ` · ${city}` : ""}
            </p>
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
                  {onDirections && (
                    <button
                      type="button"
                      className="poi-action poi-action--primary"
                      onClick={() => onDirections(directionsSelection)}
                    >
                      <DirectionsIcon size={16} />
                      Directions
                    </button>
                  )}
                  {details.website && (
                    <a
                      className={`poi-action${onDirections ? "" : " poi-action--primary"}`}
                      href={details.website}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <GlobeIcon size={16} />
                      Website
                    </a>
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
