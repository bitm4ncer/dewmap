import { describe, expect, it } from "vitest";
import {
  msUntilNextNowBucket,
  NOW_FOCUS_GUARD_MS,
  NOW_REFRESH_MINUTES,
  shouldRefreshNow,
} from "./now";

describe("now refresh cadence", () => {
  it("aligns to the next 5-minute wall-clock boundary", () => {
    expect(msUntilNextNowBucket(new Date(Date.UTC(2026, 0, 1, 12, 2, 30)))).toBe(150_000);
    expect(msUntilNextNowBucket(new Date(Date.UTC(2026, 0, 1, 12, 4, 59)))).toBe(1_000);
    // Exactly on a boundary: wait a full bucket, never zero.
    expect(msUntilNextNowBucket(new Date(Date.UTC(2026, 0, 1, 12, 5, 0)))).toBe(
      NOW_REFRESH_MINUTES * 60_000,
    );
  });

  it("survives an invalid clock", () => {
    expect(msUntilNextNowBucket(new Date(Number.NaN))).toBe(NOW_REFRESH_MINUTES * 60_000);
  });

  it("refreshes only in now-mode, visible, and not too recently", () => {
    const base = { enabled: true, offsetMinutes: 0, visible: true, msSinceRender: 600_000 };
    expect(shouldRefreshNow(base)).toBe(true);
    expect(shouldRefreshNow({ ...base, enabled: false })).toBe(false);
    expect(shouldRefreshNow({ ...base, offsetMinutes: 30 })).toBe(false);
    expect(shouldRefreshNow({ ...base, offsetMinutes: -30 })).toBe(false);
    expect(shouldRefreshNow({ ...base, visible: false })).toBe(false);
    expect(shouldRefreshNow({ ...base, msSinceRender: NOW_FOCUS_GUARD_MS - 1 })).toBe(false);
    expect(shouldRefreshNow({ ...base, msSinceRender: Number.NaN })).toBe(false);
  });
});
