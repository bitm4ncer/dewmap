"use client";
/* eslint-disable react-hooks/set-state-in-effect -- manifest status is external async state */

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MLMap } from "maplibre-gl";
import {
  createHistoryProtocol,
  historyFileUrl,
  loadHistoryManifest,
  probeHistoryArchive,
  type ArchiveMode,
} from "@/lib/history/global";
import {
  applyGlobalFilters,
  countGlobalSites,
  ensureGlobalLayers,
  globalLayerIds,
  removeGlobalLayers,
} from "@/lib/history/global-layers";
import type {
  HistoricCategory,
  HistoricManifest,
  HistoricSourceStatus,
  HistoricSiteTile,
} from "@/lib/history/types";

export interface UseHistoryLayersOptions {
  enabled: boolean;
  year: number;
  categories: readonly HistoricCategory[];
  heritageOnly: boolean;
  unescoOnly: boolean;
  onSiteClick?: (
    site: HistoricSiteTile,
    coordinates: [number, number],
  ) => void;
}

export interface UseHistoryLayersResult {
  status: HistoricSourceStatus;
  count: number;
  total: number;
  dataAsOf: string | null;
}

function historyFont(map: MLMap): string {
  const glyphs = map.getStyle()?.glyphs ?? "";
  return glyphs.includes("openhistoricalmap")
    ? "OpenHistorical"
    : "Noto Sans Regular";
}

function firstSymbolBefore(map: MLMap): string | undefined {
  const ids = globalLayerIds();
  const ours = new Set([
    ...ids.clusterCounts,
    ...ids.clusterDots,
    ids.siteLayer,
    ids.siteLabel,
  ]);
  const layers = map.getStyle()?.layers ?? [];
  return layers.find((layer) => layer.type === "symbol" && !ours.has(layer.id))
    ?.id;
}

export function useHistoryLayers(
  map: MLMap | null,
  options: UseHistoryLayersOptions,
): UseHistoryLayersResult {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);
  const manifestRef = useRef<HistoricManifest | null>(null);
  const sourceUrlsRef = useRef<{
    sites: string;
    clusters: Map<string, string>;
  }>({ sites: "", clusters: new Map() });
  const [status, setStatus] = useState<HistoricSourceStatus>("idle");
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [dataAsOf, setDataAsOf] = useState<string | null>(null);

  useEffect(() => {
    if (!map || !options.enabled) {
      if (map) {
        try {
          removeGlobalLayers(map);
        } catch {
          // The style may still be loading; the next enable re-adds.
        }
      }
      manifestRef.current = null;
      sourceUrlsRef.current = { sites: "", clusters: new Map() };
      setStatus("idle");
      setCount(0);
      return;
    }

    let cancelled = false;
    manifestRef.current = null;
    sourceUrlsRef.current = { sites: "", clusters: new Map() };
    setStatus("loading");
    setCount(0);

    const applyCurrentFilters = () => {
      try {
        applyGlobalFilters(map, {
          year: optionsRef.current.year,
          categories: optionsRef.current.categories,
          heritageOnly: optionsRef.current.heritageOnly,
          unescoOnly: optionsRef.current.unescoOnly,
        });
      } catch (error) {
        console.warn("[history-global] setFilter failed", error);
      }
    };

    const updateCount = () => {
      if (cancelled) return;
      try {
        setCount(countGlobalSites(map));
      } catch {
        // Style swap in progress; idle will fire again.
      }
    };

    const applyLayers = () => {
      const manifest = manifestRef.current;
      const sources = sourceUrlsRef.current;
      if (!manifest || cancelled || !sources.sites) return;
      try {
        ensureGlobalLayers(map, {
          clusters: manifest.files.clusters
            .map((file) => ({
              url: sources.clusters.get(file.path) ?? "",
              minzoom: file.minzoom ?? 0,
              maxzoom: file.maxzoom ?? 7,
            }))
            .filter((cluster) => cluster.url.length > 0),
          sitesUrl: sources.sites,
          font: historyFont(map),
          beforeId: firstSymbolBefore(map),
        });
        applyCurrentFilters();
      } catch (error) {
        console.warn("[history-global] addLayer failed", error);
      }
    };

    const onClick = (event: maplibregl.MapMouseEvent) => {
      const ids = globalLayerIds();
      const features = map.queryRenderedFeatures(event.point, {
        layers: [...ids.clusterDots, ids.siteLayer],
      });
      if (features.length === 0) return;
      const feature = features[0];
      const properties = feature.properties ?? {};
      const coordinates = (feature.geometry as GeoJSON.Point)?.coordinates as
        | [number, number]
        | undefined;
      if (!coordinates) return;
      event.preventDefault();
      event.originalEvent?.stopPropagation();

      if (!ids.clusterDots.includes(feature.layer?.id ?? "")) {
        optionsRef.current.onSiteClick?.(
          properties as unknown as HistoricSiteTile,
          coordinates,
        );
        return;
      }

      map.easeTo({
        center: coordinates,
        zoom: Math.min(map.getZoom() + 2, 9),
      });
    };

    const onEnter = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = "";
    };
    const onStyleLoad = () => {
      applyLayers();
      window.setTimeout(updateCount, 0);
    };

    map.on("idle", updateCount);
    map.on("click", onClick);
    map.on("mouseenter", globalLayerIds().siteLayer, onEnter);
    map.on("mouseleave", globalLayerIds().siteLayer, onLeave);
    map.on("style.load", onStyleLoad);

    (async () => {
      const manifest = await loadHistoryManifest();
      if (cancelled) return;
      if (!manifest) {
        setStatus("error");
        return;
      }
      manifestRef.current = manifest;
      setTotal(manifest.counts.sites);
      setDataAsOf(manifest.builtAt);

      const protocol = createHistoryProtocol(maplibregl);
      const siteFile = manifest.files.sites;
      const siteProbe = await probeHistoryArchive(historyFileUrl(siteFile.path));
      if (cancelled) return;
      if (siteProbe.mode === "missing") {
        setStatus("error");
        return;
      }

      const mode: Exclude<ArchiveMode, "missing"> =
        siteProbe.mode === "range" ? "range" : "full";
      sourceUrlsRef.current.sites = await protocol.open(
        siteFile,
        mode,
        siteProbe.blob,
      );

      for (const file of manifest.files.clusters) {
        if (cancelled) return;
        if (mode === "range") {
          const probe = await probeHistoryArchive(historyFileUrl(file.path));
          if (probe.mode === "missing") {
            setStatus("error");
            return;
          }
          sourceUrlsRef.current.clusters.set(
            file.path,
            await protocol.open(file, mode),
          );
        } else {
          sourceUrlsRef.current.clusters.set(
            file.path,
            await protocol.open(file, "full"),
          );
        }
      }

      if (cancelled) return;
      applyLayers();
      setStatus("ready");
      window.setTimeout(updateCount, 0);
    })().catch((error) => {
      if (cancelled) return;
      console.warn("[history-global]", error);
      setStatus("error");
    });

    return () => {
      cancelled = true;
      map.off("idle", updateCount);
      map.off("click", onClick);
      map.off("mouseenter", globalLayerIds().siteLayer, onEnter);
      map.off("mouseleave", globalLayerIds().siteLayer, onLeave);
      map.off("style.load", onStyleLoad);
      try {
        removeGlobalLayers(map);
      } catch {
        // Style already swapped.
      }
      manifestRef.current = null;
    };
  }, [map, options.enabled]);

  useEffect(() => {
    if (!map || !options.enabled || status !== "ready") return;
    applyGlobalFilters(map, {
      year: options.year,
      categories: options.categories,
      heritageOnly: options.heritageOnly,
      unescoOnly: options.unescoOnly,
    });
    const timer = window.setTimeout(() => {
      try {
        setCount(countGlobalSites(map));
      } catch {
        // ignore
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    map,
    options.enabled,
    options.year,
    options.categories,
    options.heritageOnly,
    options.unescoOnly,
    status,
  ]);

  return { status, count, total, dataAsOf };
}
