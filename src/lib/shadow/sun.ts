/**
 * Solar position.
 *
 * This is the NOAA/Meeus algorithm (NOAA Solar Calculator, "Solar Calculation
 * Details"), which is accurate enough for cast shadows: checked against the
 * NREL SPA reference case of 2003-10-17 19:30:30 UTC in Golden, CO it agrees
 * to 0.00007 deg in elevation and 0.0023 deg in azimuth (8 arc seconds). At a
 * 500 m shadow distance that is a 2 cm lateral error.
 *
 * SPA itself states +/-0.0003 deg. The extra 0.002 deg here comes from the
 * NOAA series truncation and is irrelevant for a 1 m raster: one pixel of
 * shadow boundary error corresponds to ~0.1 deg at 500 m.
 */
import type { SolarPosition } from "./types";

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_PER_DAY = 86_400_000;
const UNIX_EPOCH_JD = 2_440_587.5;
const J2000 = 2_451_545.0;

/** Julian day for a Unix timestamp in milliseconds. */
export function julianDay(utcMs: number): number {
  return utcMs / MS_PER_DAY + UNIX_EPOCH_JD;
}

export interface SolarOptions {
  /** Annual mean pressure in hPa, default 1013.25. */
  pressureHpa?: number;
  /** Annual mean temperature in degrees Celsius, default 15. */
  temperatureC?: number;
}

/**
 * Sun position for one instant and place.
 *
 * `azimuthDeg` is clockwise from true north, `elevationDeg` includes the
 * atmospheric refraction correction used by NOAA. For shadow casting the
 * geometric elevation is usually the honest input: refraction bends light
 * around the horizon by ~0.5 deg, which at sunset is a real effect but is
 * dominated by data error everywhere else.
 */
export function solarPosition(
  time: Date | number,
  latitudeDeg: number,
  longitudeDeg: number,
  options: SolarOptions = {},
): SolarPosition {
  const utcMs = typeof time === "number" ? time : time.getTime();
  const pressure = options.pressureHpa ?? 1013.25;
  const temperature = options.temperatureC ?? 15;

  const jd = julianDay(utcMs);
  const t = (jd - J2000) / 36525;

  const meanLongitude = mod360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const center =
    Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnomaly * RAD) * 0.000289;

  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + center - 0.00569 - 0.00478 * Math.sin(omega * RAD);

  const meanObliquity =
    23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);

  const declination =
    Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD)) * DEG;

  const y = Math.tan((obliquity / 2) * RAD) ** 2;
  const equationOfTime =
    4 *
    DEG *
    (y * Math.sin(2 * meanLongitude * RAD) -
      2 * eccentricity * Math.sin(meanAnomaly * RAD) +
      4 * eccentricity * y * Math.sin(meanAnomaly * RAD) * Math.cos(2 * meanLongitude * RAD) -
      0.5 * y * y * Math.sin(4 * meanLongitude * RAD) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RAD));

  const minutesUtc = (((utcMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 60_000;
  const trueSolarMinutes = mod(minutesUtc + equationOfTime + 4 * longitudeDeg, 1440);
  const hourAngle = trueSolarMinutes / 4 - 180;

  const latR = latitudeDeg * RAD;
  const decR = declination * RAD;
  const haR = hourAngle * RAD;

  const cosZenith = clamp(
    Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(haR),
    -1,
    1,
  );
  const zenith = Math.acos(cosZenith) * DEG;
  const elevationGeometric = 90 - zenith;

  const refraction = refractionDegrees(elevationGeometric, pressure, temperature);

  // Azimuth: atan2 form of Meeus ch. 13 / SPA eq. 45-46, measured from north.
  const azimuth = mod360(
    (Math.atan2(
      Math.sin(haR),
      Math.cos(haR) * Math.sin(latR) - Math.tan(decR) * Math.cos(latR),
    ) *
      DEG) +
      180,
  );

  return {
    azimuthDeg: azimuth,
    elevationDeg: elevationGeometric + refraction,
    elevationGeometricDeg: elevationGeometric,
    declinationDeg: declination,
    hourAngleDeg: hourAngle,
    equationOfTimeMin: equationOfTime,
  };
}

/** NOAA atmospheric refraction correction in degrees. */
export function refractionDegrees(
  elevationGeometricDeg: number,
  pressureHpa = 1013.25,
  temperatureC = 15,
): number {
  if (elevationGeometricDeg > 85) return 0;
  if (elevationGeometricDeg < -0.575) return 0;
  const te = Math.tan(elevationGeometricDeg * RAD);
  let arcSeconds: number;
  if (elevationGeometricDeg > 5) {
    arcSeconds = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  } else {
    const e = elevationGeometricDeg;
    arcSeconds =
      1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711)));
  }
  return (arcSeconds / 3600) * (pressureHpa / 1010) * (283 / (273 + temperatureC));
}

/**
 * Unit vector from the ground towards the sun.
 * `x` east, `y` north, `z` up.
 */
export function sunVector(azimuthDeg: number, elevationDeg: number): {
  x: number;
  y: number;
  z: number;
} {
  const az = azimuthDeg * RAD;
  const el = elevationDeg * RAD;
  return {
    x: Math.sin(az) * Math.cos(el),
    y: Math.cos(az) * Math.cos(el),
    z: Math.sin(el),
  };
}

/** Horizontal shadow length of an object of `heightM` on flat ground. */
export function shadowLengthMeters(heightM: number, elevationDeg: number): number {
  if (heightM <= 0) return 0;
  const el = elevationDeg * RAD;
  if (el <= 0) return Number.POSITIVE_INFINITY;
  return heightM / Math.tan(el);
}

/** True when the sun is above the (refracted) horizon. */
export function isDaylight(position: SolarPosition): boolean {
  return position.elevationDeg > 0;
}

/**
 * Twilight class for rendering decisions.
 * Civil twilight ends at -6 deg, nautical at -12, astronomical at -18.
 */
export function twilightPhase(
  elevationDeg: number,
): "day" | "civil" | "nautical" | "astronomical" | "night" {
  if (elevationDeg > 0) return "day";
  if (elevationDeg > -6) return "civil";
  if (elevationDeg > -12) return "nautical";
  if (elevationDeg > -18) return "astronomical";
  return "night";
}

function mod(value: number, span: number): number {
  return ((value % span) + span) % span;
}

function mod360(value: number): number {
  return mod(value, 360);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
