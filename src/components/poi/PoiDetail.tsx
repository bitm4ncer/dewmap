"use client";
/* eslint-disable @next/next/no-img-element -- remote OSM/Wikimedia photos with unknown dimensions */

import { useEffect, useRef, useState } from "react";
import { fetchPoiDetails } from "@/lib/poi";
import type { PoiDetails, PoiSelection } from "@/lib/poi";
import { parseOpeningHours } from "@/lib/poi/openingHours";
import {
  ClockIcon,
  CloseIcon,
  ExternalLinkIcon,
  GlobeIcon,
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

function PoiDetailContent({
  selection,
  onClose,
  onCenter,
  onPlanRoute,
}: ContentProps) {
  const [details, setDetails] = useState<PoiDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [activeImage, setActiveImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    cardRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const retry = () => {
    setLoading(true);
    setError(false);
    setDetails(null);
    setReload((r) => r + 1);
  };

  const images = details?.images ?? [];
  const hasImage = images.length > 0 && !imageFailed;
  const current = images[Math.min(activeImage, Math.max(0, images.length - 1))];
  const name = details?.name || selection.name || "Place details";
  const category = details?.category || selection.category || "Place";
  const city = details?.city || selection.city;
  const opening = details?.opening
    ? (parseOpeningHours(details.opening.raw) ?? details.opening)
    : undefined;
  const status =
    opening?.openNow === true
      ? { label: "Open now", tone: "open" as const }
      : opening?.openNow === false
        ? { label: "Closed", tone: "closed" as const }
        : null;

  const closeButton = (
    <button
      type="button"
      onClick={onClose}
      className={hasImage ? "poi-close" : "poi-close poi-close--inline"}
      aria-label="Close place details"
    >
      <CloseIcon size={19} />
    </button>
  );

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      className="poi-detail"
      role="region"
      aria-label="Place details"
      data-loading={loading ? "true" : "false"}
    >
      <div className="poi-scroll">
        {hasImage && current && (
          <div className="poi-hero">
            <img
              key={current.url}
              src={current.url}
              alt={name}
              className="poi-hero-image"
              loading="eager"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => {
                if (activeImage < images.length - 1) {
                  setActiveImage((i) => i + 1);
                } else {
                  setImageFailed(true);
                }
              }}
            />
            <div className="poi-hero-shade" />
            {closeButton}
            <a
              className="poi-credit"
              href={current.href ?? current.url}
              target="_blank"
              rel="noreferrer noopener"
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
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="poi-body">
          {!hasImage && (
            <div className="poi-head">
              <p className="ui-kicker">
                {category}
                {city ? ` · ${city}` : ""}
              </p>
              {closeButton}
            </div>
          )}
          {onPlanRoute && (
            <button
              type="button"
              className="poi-plan-route"
              onClick={() =>
                onPlanRoute({
                  ...selection,
                  name: details?.name ?? selection.name,
                  lon: details?.lon ?? selection.lon,
                  lat: details?.lat ?? selection.lat,
                  city: details?.city ?? selection.city,
                  category: details?.category ?? selection.category,
                })
              }
            >
              <RouteIcon size={17} />
              Plan Route
            </button>
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
                <button
                  type="button"
                  className="poi-action"
                  onClick={retry}
                >
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
                {details.website && (
                  <a
                    className="poi-action poi-action--primary"
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
