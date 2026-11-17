"use client";

import { useMemo } from "react";
import { haversineM } from "@/lib/routing/geo";

interface Props {
  /** [lon, lat, ele?] */
  coordinates: [number, number, number?][];
  distanceKm: number;
  width?: number;
  height?: number;
}

export function ElevationChart({
  coordinates,
  distanceKm,
  width = 220,
  height = 48,
}: Props) {
  const path = useMemo(() => {
    const points: { d: number; ele: number }[] = [];
    let distance = 0;
    for (let i = 0; i < coordinates.length; i += 1) {
      const c = coordinates[i];
      if (i > 0) distance += haversineM(coordinates[i - 1], c);
      const ele = c[2];
      if (typeof ele === "number" && Number.isFinite(ele)) {
        points.push({ d: distance, ele });
      }
    }
    if (points.length < 2) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.ele < min) min = p.ele;
      if (p.ele > max) max = p.ele;
    }
    const span = Math.max(1, max - min);
    const totalM = Math.max(
      points[points.length - 1].d,
      distanceKm > 0 ? distanceKm * 1000 : 0,
    );
    // Downsample long tracks so the SVG stays cheap and readable.
    const stride = Math.max(1, Math.ceil(points.length / 400));
    const sampled = points.filter(
      (_, i) => i % stride === 0 || i === points.length - 1,
    );
    const parts: string[] = [];
    sampled.forEach((p, i) => {
      const x = totalM > 0 ? (p.d / totalM) * width : (i / (sampled.length - 1)) * width;
      const y = height - ((p.ele - min) / span) * height;
      parts.push(`${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return { d: parts.join(" "), min, max };
  }, [coordinates, width, height, distanceKm]);

  if (!path) return null;

  return (
    <div className="flex flex-col gap-1">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block w-full"
        aria-label="Elevation profile"
      >
        {/* Stroke + fill both use currentColor so the chart stays
            readable regardless of the surrounding card's background.
            Inside an active route card (.hud-card-flat[data-active])
            the cascaded color becomes --accent-ink, giving high
            contrast against the olive accent fill; on idle/dark
            cards it inherits the pane's --accent. */}
        <path
          d={`${path.d} L${width},${height} L0,${height} Z`}
          fill="currentColor"
          opacity="0.22"
        />
        <path
          d={path.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="flex justify-between text-[11px] opacity-70">
        <span>0 km</span>
        <span>
          {Math.round(path.min)}–{Math.round(path.max)} m
        </span>
        <span>{distanceKm.toFixed(1)} km</span>
      </div>
    </div>
  );
}
