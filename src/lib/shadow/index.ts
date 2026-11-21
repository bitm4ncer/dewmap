/**
 * Shadow map — public facade.
 *
 * `computeShadowLayer({ bbox, time, mode })` is the one call a UI needs.
 * It is pure: same input, same output, no clock and no network. Feed it
 * footprints from OSM/LoD2 and terrain from DGM1/Copernicus.
 *
 * Dock point for the generic overlay registry (built in a parallel branch):
 * see `overlay.ts`. Nothing in `src/lib/overlays/**` is imported or edited.
 */
import type {
  Bbox,
  BuildingFootprint,
  HeightField,
  LngLat,
  ShadowFeatureProperties,
  ShadowMask,
  ShadowRequest,
  ShadowResult,
  SolarPosition,
} from "./types";
import { solarPosition, shadowLengthMeters } from "./sun";
import {
  bboxSpanM,
  isBuildingUsable,
  localFrame,
  projectFootprint,
  type LocalFrame,
} from "./geometry";
import {
  castShadowMask,
  combineHeights,
  rasterizeBuildings,
  shadowFraction,
  toShadowMask,
} from "./raster";

export * from "./types";
export {
  solarPosition,
  sunVector,
  shadowLengthMeters,
  isDaylight,
  twilightPhase,
  julianDay,
  refractionDegrees,
  type SolarOptions,
} from "./sun";
export {
  localFrame,
  bboxSpanM,
  normalizeLon,
  lonDelta,
  shadowOffset,
  convexHull,
  projectFootprint,
  sweptFootprint,
  polygonAreaM2,
  ringBbox,
  expandBboxM,
  bboxAround,
  buildingHeightFromTags,
  DEFAULT_BUILDING_HEIGHT_M,
  METRES_PER_LEVEL,
  ROOF_ALLOWANCE_M,
  type LocalFrame,
} from "./geometry";
export {
  rasterizeBuildings,
  combineHeights,
  castShadowMask,
  toShadowMask,
  shadowFraction,
  sampleHeightField,
  sampleHeightFieldBilinear,
  type CastShadowOptions,
  type RasterizeOptions,
} from "./raster";
export {
  buildHorizonMap,
  horizonAt,
  shadowFromHorizon,
  horizonBuildOperations,
  type HorizonOptions,
} from "./horizon";
export { maskToRgba, flipRows, type ShadowRgbaOptions } from "./palette";
export {
  lonLatToTile,
  tileBounds,
  tileResolutionM,
  tilesForBbox,
  resolutionForZoom,
  shadowTileUrl,
  WEB_MERCATOR_MAX_LAT,
  type TileCoord,
} from "./tiles";
export { SHADOW_SOURCES, type ShadowSource } from "./attribution";

/** Hard cap so a bad request cannot allocate gigabytes in a browser. */
export const MAX_RASTER_CELLS = 16_000_000;

export interface ComputeShadowOptions {
  /** Override for the automatic grid size guard. */
  maxCells?: number;
}

/**
 * Compute a shadow layer for a bbox and instant.
 *
 * Vector mode returns GeoJSON polygons (fast, crisp, no terrain).
 * Raster mode returns a 1/0 mask on a regular grid (terrain + buildings).
 */
export function computeShadowLayer(
  request: ShadowRequest,
  options: ComputeShadowOptions = {},
): ShadowResult {
  const started = performance.now();
  const { bbox, mode } = request;
  const frame = localFrame(bbox);
  const centerLon = frame.lon0;
  const centerLat = frame.lat0;
  const sun = request.sun ?? solarPosition(request.time, centerLat, centerLon);
  const buildings = (request.buildings ?? []).filter(isBuildingUsable);

  if (mode === "vector") {
    const features: GeoJSON.Feature<GeoJSON.Polygon, ShadowFeatureProperties>[] = [];
    for (const building of buildings) {
      const projected = projectFootprint(building.ring, building.heightM, sun, frame);
      if (projected.ring.length < 4) continue;
      features.push({
        type: "Feature",
        properties: {
          heightM: building.heightM,
          lengthM: projected.lengthM,
        },
        geometry: { type: "Polygon", coordinates: [projected.ring] },
      });
    }
    const geojson: GeoJSON.FeatureCollection<GeoJSON.Polygon, ShadowFeatureProperties> = {
      type: "FeatureCollection",
      features,
    };
    return {
      mode,
      sun,
      bbox,
      geojson,
      stats: {
        buildingCount: buildings.length,
        polygonCount: features.length,
        computeMs: performance.now() - started,
      },
    };
  }

  const resolutionM = request.resolutionM ?? 2;
  const span = bboxSpanM(bbox, frame);
  const width = Math.max(1, Math.ceil(span.x / resolutionM));
  const height = Math.max(1, Math.ceil(span.y / resolutionM));
  const cells = width * height;
  const maxCells = options.maxCells ?? MAX_RASTER_CELLS;
  if (cells > maxCells) {
    throw new RangeError(
      `shadow raster would be ${width}x${height} = ${cells} cells (limit ${maxCells}); increase resolutionM`,
    );
  }

  const terrain = request.terrain
    ? resampleTerrain(request.terrain, bbox, width, height, resolutionM, frame)
    : new Float32Array(cells);
  const buildingHeights = rasterizeBuildings(buildings, {
    bbox,
    width,
    height,
    resolutionM,
    frame,
  });
  const dsm = combineHeights(terrain, buildingHeights);
  const mask = castShadowMask(dsm, {
    width,
    height,
    resolutionM,
    sun,
    maxDistanceM: request.maxDistanceM,
  });
  const shadowMask: ShadowMask = toShadowMask(mask, bbox, width, height, resolutionM);

  return {
    mode,
    sun,
    bbox,
    mask: shadowMask,
    stats: {
      buildingCount: buildings.length,
      shadowFraction: shadowFraction(mask),
      computeMs: performance.now() - started,
    },
  };
}

/** Shadow polygons as a plain GeoJSON feature collection. */
export function shadowFeatureCollection(
  buildings: BuildingFootprint[],
  bbox: Bbox,
  sun: Pick<SolarPosition, "azimuthDeg" | "elevationDeg">,
  frame?: LocalFrame,
): GeoJSON.FeatureCollection<GeoJSON.Polygon, ShadowFeatureProperties> {
  const f = frame ?? localFrame(bbox);
  const features = buildings.filter(isBuildingUsable).map((building) => {
    const projected = projectFootprint(building.ring, building.heightM, sun, f);
    return {
      type: "Feature" as const,
      properties: {
        heightM: building.heightM,
        lengthM: projected.lengthM,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [projected.ring],
      },
    };
  });
  return { type: "FeatureCollection", features };
}

/** Maximum shadow length in a set of buildings; useful for padding tiles. */
export function maxShadowLengthM(
  buildings: BuildingFootprint[],
  elevationDeg: number,
): number {
  let maxHeight = 0;
  for (const building of buildings) {
    if (Number.isFinite(building.heightM) && building.heightM > maxHeight) {
      maxHeight = building.heightM;
    }
  }
  return shadowLengthMeters(maxHeight, elevationDeg);
}

function resampleTerrain(
  field: HeightField,
  bbox: Bbox,
  width: number,
  height: number,
  resolutionM: number,
  frame: LocalFrame,
): Float32Array {
  const out = new Float32Array(width * height);
  const [west, south] = bbox;
  const origin = frame.project([west, south]);
  const [fieldWest, fieldSouth, fieldEast, fieldNorth] = field.bbox;
  for (let row = 0; row < height; row++) {
    const y = origin[1] + (row + 0.5) * resolutionM;
    for (let col = 0; col < width; col++) {
      const x = origin[0] + (col + 0.5) * resolutionM;
      const [lon, lat]: LngLat = frame.unproject([x, y]);
      if (lon < fieldWest || lon > fieldEast || lat < fieldSouth || lat > fieldNorth) {
        out[row * width + col] = Number.NaN;
        continue;
      }
      const fx = ((lon - fieldWest) / (fieldEast - fieldWest)) * (field.width - 1);
      const fy = ((lat - fieldSouth) / (fieldNorth - fieldSouth)) * (field.height - 1);
      out[row * width + col] = sampleBilinear(field.data, field.width, field.height, fx, fy);
    }
  }
  return out;
}

function sampleBilinear(
  data: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx;
  const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}
