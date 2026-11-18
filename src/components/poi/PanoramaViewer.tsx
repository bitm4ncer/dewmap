"use client";

import { useEffect, useRef } from "react";
import type { PanoramaxStreetView } from "@/lib/poi";
import { CloseIcon, ExternalLinkIcon } from "@/components/ui/icons";

interface Props {
  streetView: PanoramaxStreetView;
  title: string;
  onClose: () => void;
}

export function PanoramaViewer({ streetView, title, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="panorama-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Street View: ${title}`}
    >
      <div className="panorama-bar">
        <div className="panorama-copy">
          <strong>{title}</strong>
          <span>
            {streetView.attribution}
            {" · "}
            <a href={streetView.licenseUrl} target="_blank" rel="noreferrer noopener">
              {streetView.license}
            </a>
          </span>
        </div>
        <a
          className="panorama-source"
          href={streetView.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Panoramax
          <ExternalLinkIcon size={13} />
        </a>
        <button
          ref={closeRef}
          type="button"
          className="panorama-close"
          onClick={onClose}
          aria-label="Close Street View"
        >
          <CloseIcon size={20} />
        </button>
      </div>
      <iframe
        className="panorama-frame"
        src={streetView.viewerUrl}
        title={`Street View: ${title}`}
        allow="fullscreen; accelerometer; gyroscope; magnetometer"
        allowFullScreen
        loading="eager"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
