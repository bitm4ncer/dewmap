/**
 * ETRS89 / UTM zone 32N (EPSG:25832) forward and inverse projection.
 *
 * Written out instead of pulling in `proj4`: the pipeline needs exactly one
 * projection pair, and a dependency here would have to be justified in the
 * repository for a script that runs once per data release. Formulas follow
 * Snyder, *Map Projections — A Working Manual*, USGS PP 1395, §8.
 *
 * The ellipsoid is GRS80 (ETRS89). The difference to WGS84 is < 1 m and
 * irrelevant for building footprints at 4 m shadow resolution.
 */

const A = 6378137.0;
const F = 1 / 298.257222101;
const K0 = 0.9996;
const LON0 = (9 * Math.PI) / 180; // central meridian of zone 32
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);

/** `[lon, lat]` degrees → `[easting, northing]` metres. */
export function lonLatToUtm32(lon, lat) {
  const phi = (lat * Math.PI) / 180;
  const lam = (lon * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const n = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const t = tanPhi * tanPhi;
  const c = EP2 * cosPhi * cosPhi;
  const a = (lam - LON0) * cosPhi;
  const m =
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * phi));

  const easting =
    500000 +
    K0 *
      n *
      (a +
        ((1 - t + c) * a ** 3) / 6 +
        ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120);
  const northing =
    K0 *
    (m +
      n *
        tanPhi *
        (a * a / 2 +
          ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
          ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720));
  return [easting, northing];
}

/** `[easting, northing]` metres → `[lon, lat]` degrees. */
export function utm32ToLonLat(easting, northing) {
  const x = easting - 500000;
  const y = northing;
  const m = y / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const c1 = EP2 * cosPhi1 * cosPhi1;
  const t1 = tanPhi1 * tanPhi1;
  const n1 = A / Math.sqrt(1 - E2 * sinPhi1 * sinPhi1);
  const r1 = (A * (1 - E2)) / Math.pow(1 - E2 * sinPhi1 * sinPhi1, 1.5);
  const d = x / (n1 * K0);

  const lat =
    phi1 -
    ((n1 * tanPhi1) / r1) *
      (d * d / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) /
          720);
  const lon =
    LON0 +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) /
      cosPhi1;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/**
 * 1 km tile indices covering a lon/lat bbox.
 *
 * The lon/lat rectangle is a rotated quad in UTM, so the boundary is sampled
 * densely before taking min/max — sampling only the four corners loses up to
 * ~1 km on the long edges at this latitude.
 */
export function tileRangeForBbox(bbox, stepDeg = 0.005) {
  const [west, south, east, north] = bbox;
  let minE = Infinity;
  let maxE = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  const sample = (lon, lat) => {
    const [e, n] = lonLatToUtm32(lon, lat);
    if (e < minE) minE = e;
    if (e > maxE) maxE = e;
    if (n < minN) minN = n;
    if (n > maxN) maxN = n;
  };
  for (let lon = west; lon <= east + 1e-12; lon += stepDeg) {
    sample(Math.min(lon, east), south);
    sample(Math.min(lon, east), north);
  }
  for (let lat = south; lat <= north + 1e-12; lat += stepDeg) {
    sample(west, Math.min(lat, north));
    sample(east, Math.min(lat, north));
  }
  return {
    eastMin: Math.floor(minE / 1000),
    eastMax: Math.floor(maxE / 1000),
    northMin: Math.floor(minN / 1000),
    northMax: Math.floor(maxN / 1000),
  };
}
