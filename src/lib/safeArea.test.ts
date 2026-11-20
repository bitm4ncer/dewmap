import { describe, expect, it } from "vitest";
import { effectiveSafeBottom, reservedBottomStrip } from "./safeArea";

const base = {
  screenWidth: 402,
  screenHeight: 874,
  insetTop: 59,
  insetBottom: 34,
};

describe("reservedBottomStrip", () => {
  it("is zero when the viewport reaches the screen edge", () => {
    expect(reservedBottomStrip({ ...base, innerHeight: 874 })).toBe(0);
  });

  it("reports the iOS 26 home-screen strip on a full-bleed page", () => {
    // Measured on iOS 26: screen 874, layout viewport 812, translucent bar.
    expect(reservedBottomStrip({ ...base, innerHeight: 812 })).toBe(62);
  });

  it("does not read a status-bar inset as a bottom strip", () => {
    // Non-translucent status bar: the viewport is short at the top, the page
    // still ends on the physical bottom edge.
    expect(
      reservedBottomStrip({ ...base, insetTop: 0, innerHeight: 812 }),
    ).toBe(0);
  });

  it("ignores the portrait screen height in landscape", () => {
    expect(
      reservedBottomStrip({ ...base, innerHeight: 402, screenWidth: 402 }),
    ).toBe(0);
  });

  it("never reports a negative strip on an oversized viewport", () => {
    expect(reservedBottomStrip({ ...base, innerHeight: 900 })).toBe(0);
  });
});

describe("effectiveSafeBottom", () => {
  it("keeps the inset when nothing is reserved", () => {
    expect(effectiveSafeBottom({ ...base, innerHeight: 874 })).toBe(34);
  });

  it("drops the inset the system already reserved outside the viewport", () => {
    // The double-safe-area trap: 34 px inset on top of a 62 px system strip.
    expect(effectiveSafeBottom({ ...base, innerHeight: 812 })).toBe(0);
  });

  it("keeps the inset once the status bar is not full-bleed", () => {
    expect(
      effectiveSafeBottom({ ...base, insetTop: 0, innerHeight: 812 }),
    ).toBe(34);
  });

  it("subtracts a strip that is smaller than the inset", () => {
    expect(effectiveSafeBottom({ ...base, innerHeight: 848 })).toBe(8);
  });

  it("survives a missing or bogus inset", () => {
    const noReserve = { ...base, innerHeight: 874 };
    expect(
      effectiveSafeBottom({ ...noReserve, insetBottom: Number.NaN }),
    ).toBe(0);
    expect(effectiveSafeBottom({ ...noReserve, insetBottom: -10 })).toBe(0);
  });
});
