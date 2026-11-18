import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const CATEGORIES = new Set([
  "castle",
  "religious",
  "archaeological",
  "memorial",
  "battlefield",
  "industrial",
  "museum",
  "other",
]);

export function validateSites(sites) {
  const errors = [];
  const seen = new Set();
  for (const [index, site] of sites.entries()) {
    const where = `site ${index} (${site?.id ?? "no id"})`;
    if (!site || typeof site.id !== "string" || site.id.length === 0) {
      errors.push(`${where}: missing id`);
      continue;
    }
    if (seen.has(site.id)) errors.push(`${where}: duplicate id`);
    seen.add(site.id);
    if (typeof site.name !== "string" || site.name.trim() === "") {
      errors.push(`${where}: missing name`);
    }
    if (!CATEGORIES.has(site.category)) {
      errors.push(`${where}: unknown category ${String(site.category)}`);
    }
    if (!Number.isFinite(site.lon) || site.lon < -180 || site.lon > 180) {
      errors.push(`${where}: longitude out of range`);
    }
    if (!Number.isFinite(site.lat) || site.lat < -90 || site.lat > 90) {
      errors.push(`${where}: latitude out of range`);
    }
    for (const key of ["inception", "dissolved"]) {
      if (site[key] !== undefined && !Number.isFinite(site[key])) {
        errors.push(`${where}: ${key} is not finite`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateManifest(manifest, { maxBytes, allowEmpty = false }) {
  const errors = [];
  if (manifest?.schema !== 1) errors.push("schema must be 1");
  if (typeof manifest?.buildId !== "string" || !manifest.buildId) {
    errors.push("missing buildId");
  }
  if (
    typeof manifest?.builtAt !== "string" ||
    Number.isNaN(Date.parse(manifest.builtAt))
  ) {
    errors.push("invalid builtAt");
  }
  if (!manifest?.counts || manifest.counts.sites <= 0) {
    errors.push("counts.sites must be positive");
  }
  let total = 0;
  const clusters = Array.isArray(manifest?.files?.clusters)
    ? manifest.files.clusters
    : [];
  if (clusters.length === 0) errors.push("missing files.clusters");
  for (const [index, file] of clusters.entries()) {
    if (!file || typeof file.path !== "string" || !file.path) {
      errors.push(`missing files.clusters[${index}].path`);
      continue;
    }
    if (!Number.isFinite(file.bytes) || (!allowEmpty && file.bytes <= 0)) {
      errors.push(`invalid files.clusters[${index}].bytes`);
    }
    if (
      !allowEmpty &&
      (typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(file.sha256))
    ) {
      errors.push(`invalid files.clusters[${index}].sha256`);
    }
    total += Number(file.bytes) || 0;
  }
  const siteFile = manifest?.files?.sites;
  if (!siteFile || typeof siteFile.path !== "string" || !siteFile.path) {
    errors.push("missing files.sites.path");
  } else {
    if (
      !Number.isFinite(siteFile.bytes) ||
      (!allowEmpty && siteFile.bytes <= 0)
    ) {
      errors.push("invalid files.sites.bytes");
    }
    if (
      !allowEmpty &&
      (typeof siteFile.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/i.test(siteFile.sha256))
    ) {
      errors.push("invalid files.sites.sha256");
    }
    total += Number(siteFile.bytes) || 0;
  }
  if (total > maxBytes) {
    errors.push(
      `archive size ${(total / 1024 / 1024).toFixed(1)} MB exceeds ${(maxBytes / 1024 / 1024).toFixed(0)} MB`,
    );
  }
  return { ok: errors.length === 0, errors };
}

export function tileFor(lon, lat, zoom) {
  const size = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * size);
  const rad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * size,
  );
  return {
    x: Math.min(size - 1, Math.max(0, x)),
    y: Math.min(size - 1, Math.max(0, y)),
  };
}

export function validateArchive({
  expectedLayer,
  siteCount,
  decode,
  zoom = 2,
  tiles: tileOverride,
  checkAntimeridian = true,
}) {
  const errors = [];
  const size = 2 ** zoom;
  const tiles =
    tileOverride ??
    Array.from({ length: size * size }, (_, index) => [
      zoom,
      index % size,
      Math.floor(index / size),
    ]);
  const layerFeatures = [];
  for (const [z, x, y] of tiles) {
    const layers = decode(z, x, y);
    if (layers && Array.isArray(layers[expectedLayer])) {
      layerFeatures.push(...layers[expectedLayer]);
    }
  }
  const seen = new Set();
  const uniqueFeatures = layerFeatures.filter((feature) => {
    const id = feature.properties?.id;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  if (uniqueFeatures.length === 0) {
    errors.push(`missing layer ${expectedLayer}`);
  } else if (siteCount !== undefined) {
    const sum = uniqueFeatures.reduce(
      (total, feature) => total + (Number(feature.properties?.count) || 0),
      0,
    );
    if (Math.abs(sum - siteCount) > siteCount * 0.05) {
      errors.push(
        `z${zoom} cluster sum ${sum} differs from site count ${siteCount} by more than 5%`,
      );
    }
  }

  if (checkAntimeridian) {
    const east = tileFor(179.9, 0, 2);
    const west = tileFor(-179.9, 0, 2);
    const eastLayers = decode(2, east.x, east.y);
    const westLayers = decode(2, west.x, west.y);
    if (
      (!eastLayers || Object.keys(eastLayers).length === 0) &&
      (!westLayers || Object.keys(westLayers).length === 0)
    ) {
      errors.push("no clusters at the antimeridian");
    }
  }

  return { ok: errors.length === 0, errors };
}

export function makeDecoder(archive, bin = process.env.TIPPECANOE_DECODE ?? "tippecanoe-decode") {
  return (zoom, x, y) => {
    const result = spawnSync(bin, [archive, String(zoom), String(x), String(y)], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0 || !result.stdout) return {};
    try {
      const parsed = JSON.parse(result.stdout);
      const layers = {};
      for (const group of parsed.features ?? []) {
        const layer = group.properties?.layer;
        if (layer) layers[layer] = group.features ?? [];
      }
      return layers;
    } catch {
      return {};
    }
  };
}

export function validateBuiltArchives({
  manifest,
  outDir,
  bin,
  sampleSite,
  checkAntimeridian = manifest?.counts?.sites >= 10_000,
}) {
  const errors = [];
  const manifestResult = validateManifest(manifest, {
    maxBytes: 40 * 1024 * 1024,
  });
  errors.push(...manifestResult.errors);
  if (errors.length > 0) return { ok: false, errors };

  const clusterFiles = Array.isArray(manifest.files.clusters)
    ? manifest.files.clusters
    : [];
  for (const file of clusterFiles) {
    const archivePath = resolve(outDir, file.path);
    const decode = makeDecoder(archivePath, bin);
    const zoom = Number.isFinite(file.minzoom) ? file.minzoom : 2;
    const result = validateArchive({
      expectedLayer: "history_clusters",
      siteCount: zoom === 2 ? manifest.counts.sites : undefined,
      decode,
      zoom,
      checkAntimeridian: checkAntimeridian && zoom === 2,
    });
    errors.push(...result.errors);
  }

  const sitePath = resolve(outDir, manifest.files.sites.path);
  const siteDecode = makeDecoder(sitePath, bin);
  if (sampleSite) {
    const sampleTile = tileFor(sampleSite.lon, sampleSite.lat, 8);
    const siteLayers = siteDecode(8, sampleTile.x, sampleTile.y);
    if (!siteLayers || !Array.isArray(siteLayers.history_sites)) {
      errors.push("missing layer history_sites at the z8 sample tile");
    }
  }
  return { ok: errors.length === 0, errors };
}
