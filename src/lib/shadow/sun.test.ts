import { describe, expect, it } from "vitest";
import {
  julianDay,
  refractionDegrees,
  shadowLengthMeters,
  solarPosition,
  sunVector,
  twilightPhase,
} from "./sun";

describe("solarPosition", () => {
  // Reda & Andreas (2004), NREL/TP-560-34302, Appendix A.5.
  // 2003-10-17 12:30:30 MST = 19:30:30 UTC, Golden CO.
  const reference = {
    lon: -105.1786,
    lat: 39.742476,
    pressureHpa: 820,
    temperatureC: 11,
  };
  const sun = solarPosition(Date.UTC(2003, 9, 17, 19, 30, 30), reference.lat, reference.lon, {
    pressureHpa: reference.pressureHpa,
    temperatureC: reference.temperatureC,
  });

  it("matches the NREL SPA reference azimuth", () => {
    expect(sun.azimuthDeg).toBeCloseTo(194.340241, 1);
    expect(Math.abs(sun.azimuthDeg - 194.340241)).toBeLessThan(0.01);
  });

  it("matches the NREL SPA geometric elevation", () => {
    expect(Math.abs(sun.elevationGeometricDeg - 39.872)).toBeLessThan(0.005);
  });

  it("reports the SPA refracted zenith", () => {
    expect(Math.abs(90 - sun.elevationDeg - 50.111622)).toBeLessThan(0.01);
  });

  it("puts the summer noon sun high over Düsseldorf", () => {
    const dusseldorf = solarPosition(Date.UTC(2026, 5, 21, 11, 0, 0), 51.2277, 6.7735);
    expect(dusseldorf.elevationDeg).toBeGreaterThan(61);
    expect(dusseldorf.elevationDeg).toBeLessThan(62.5);
    expect(dusseldorf.azimuthDeg).toBeGreaterThan(160);
    expect(dusseldorf.azimuthDeg).toBeLessThan(167);
  });

  it("puts the winter noon sun low over Düsseldorf", () => {
    const dusseldorf = solarPosition(Date.UTC(2026, 11, 21, 11, 0, 0), 51.2277, 6.7735);
    expect(dusseldorf.elevationDeg).toBeGreaterThan(14);
    expect(dusseldorf.elevationDeg).toBeLessThan(16.5);
  });

  it("is below the horizon at local midnight", () => {
    const night = solarPosition(Date.UTC(2026, 5, 21, 23, 0, 0), 51.2277, 6.7735);
    expect(night.elevationDeg).toBeLessThan(0);
  });

  it("is deterministic and independent of the local timezone", () => {
    const a = solarPosition(new Date("2026-06-21T11:00:00Z"), 51.2277, 6.7735);
    const b = solarPosition(Date.UTC(2026, 5, 21, 11, 0, 0), 51.2277, 6.7735);
    expect(a.azimuthDeg).toBe(b.azimuthDeg);
    expect(a.elevationDeg).toBe(b.elevationDeg);
  });
});

describe("julianDay", () => {
  it("maps the Unix epoch to JD 2440587.5", () => {
    expect(julianDay(0)).toBe(2440587.5);
  });
});

describe("refractionDegrees", () => {
  it("is zero at the zenith", () => {
    expect(refractionDegrees(90)).toBe(0);
  });

  it("is about half a degree at the horizon", () => {
    const value = refractionDegrees(0);
    expect(value).toBeGreaterThan(0.4);
    expect(value).toBeLessThan(0.6);
  });

  it("is zero well below the horizon", () => {
    expect(refractionDegrees(-2)).toBe(0);
  });
});

describe("shadowLengthMeters", () => {
  it("equals the height at 45 degrees", () => {
    expect(shadowLengthMeters(10, 45)).toBeCloseTo(10, 9);
  });

  it("grows as the sun gets lower", () => {
    expect(shadowLengthMeters(10, 30)).toBeCloseTo(17.3205, 3);
    expect(shadowLengthMeters(10, 10)).toBeGreaterThan(shadowLengthMeters(10, 30));
  });

  it("is infinite below the horizon", () => {
    expect(shadowLengthMeters(10, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(shadowLengthMeters(10, -5)).toBe(Number.POSITIVE_INFINITY);
  });

  it("is zero for zero height", () => {
    expect(shadowLengthMeters(0, 30)).toBe(0);
  });
});

describe("sunVector", () => {
  it("points north at azimuth 0", () => {
    const v = sunVector(0, 0);
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.y).toBeCloseTo(1, 9);
    expect(v.z).toBeCloseTo(0, 9);
  });

  it("points up at 90 degrees elevation", () => {
    const v = sunVector(123, 90);
    expect(v.z).toBeCloseTo(1, 9);
  });
});

describe("twilightPhase", () => {
  it("classifies the usual bands", () => {
    expect(twilightPhase(10)).toBe("day");
    expect(twilightPhase(-3)).toBe("civil");
    expect(twilightPhase(-8)).toBe("nautical");
    expect(twilightPhase(-15)).toBe("astronomical");
    expect(twilightPhase(-25)).toBe("night");
  });
});
