import { describe, expect, it } from "vitest";
import { effectiveSafeBottom, reservedBottomStrip } from "./safeArea";

describe("reservedBottomStrip", () => {
  it("is zero when the viewport reaches the screen edge", () => {
    expect(
      reservedBottomStrip({ innerHeight: 874, screenWidth: 402, screenHeight: 874 }),
    ).toBe(0);
  });

  it("reports the iOS 26 home-screen strip", () => {
    // Measured on iOS 26: screen 874, layout viewport 812.
    expect(
      reservedBottomStrip({ innerHeight: 812, screenWidth: 402, screenHeight: 874 }),
    ).toBe(62);
  });

  it("ignores the portrait screen height in landscape", () => {
    expect(
      reservedBottomStrip({ innerHeight: 402, screenWidth: 402, screenHeight: 874 }),
    ).toBe(0);
  });

  it("never reports a negative strip on an oversized viewport", () => {
    expect(
      reservedBottomStrip({ innerHeight: 900, screenWidth: 402, screenHeight: 874 }),
    ).toBe(0);
  });
});

describe("effectiveSafeBottom", () => {
  it("keeps the inset when nothing is reserved", () => {
    expect(
      effectiveSafeBottom({
        innerHeight: 874,
        screenWidth: 402,
        screenHeight: 874,
        inset: 34,
      }),
    ).toBe(34);
  });

  it("drops the inset the system already reserved outside the viewport", () => {
    // The double-safe-area trap: 34 px inset on top of a 62 px system strip.
    expect(
      effectiveSafeBottom({
        innerHeight: 812,
        screenWidth: 402,
        screenHeight: 874,
        inset: 34,
      }),
    ).toBe(0);
  });

  it("subtracts a strip that is smaller than the inset", () => {
    expect(
      effectiveSafeBottom({
        innerHeight: 848,
        screenWidth: 402,
        screenHeight: 874,
        inset: 34,
      }),
    ).toBe(8);
  });

  it("survives a missing or bogus inset", () => {
    const base = { innerHeight: 874, screenWidth: 402, screenHeight: 874 };
    expect(effectiveSafeBottom({ ...base, inset: Number.NaN })).toBe(0);
    expect(effectiveSafeBottom({ ...base, inset: -10 })).toBe(0);
  });
});
