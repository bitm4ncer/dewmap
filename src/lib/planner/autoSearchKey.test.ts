import { describe, expect, it } from "vitest";
import { transitSearchKey, type TransitSearchKeyInput } from "./autoSearchKey";

const base: TransitSearchKeyInput = {
  from: { lat: 51.2277, lon: 6.775 },
  to: { lat: 51.2361, lon: 6.775 },
  via: [],
  when: "2026-11-20T18:00",
  arriveBy: false,
  maxTransfers: 3,
  maxWalkMin: 30,
  modes: [],
  accessible: false,
  bike: false,
};

describe("transitSearchKey", () => {
  it("is null until both ends are set", () => {
    expect(transitSearchKey({ ...base, from: null })).toBeNull();
    expect(transitSearchKey({ ...base, to: null })).toBeNull();
  });

  it("is stable for the same question", () => {
    expect(transitSearchKey(base)).toBe(transitSearchKey({ ...base }));
  });

  it("changes when the question changes", () => {
    const key = transitSearchKey(base);
    expect(transitSearchKey({ ...base, when: "2026-11-20T19:00" })).not.toBe(key);
    expect(transitSearchKey({ ...base, arriveBy: true })).not.toBe(key);
    expect(transitSearchKey({ ...base, maxTransfers: 1 })).not.toBe(key);
    expect(transitSearchKey({ ...base, accessible: true })).not.toBe(key);
    expect(
      transitSearchKey({ ...base, to: { lat: 51.4, lon: 6.9 } }),
    ).not.toBe(key);
  });

  it("ignores mode order", () => {
    expect(transitSearchKey({ ...base, modes: ["BUS", "TRAM"] })).toBe(
      transitSearchKey({ ...base, modes: ["TRAM", "BUS"] }),
    );
  });

  it("rounds sub-metre jitter away", () => {
    expect(
      transitSearchKey({ ...base, from: { lat: 51.2277001, lon: 6.7750001 } }),
    ).toBe(transitSearchKey(base));
  });
});
