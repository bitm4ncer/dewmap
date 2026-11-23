import { describe, expect, it } from "vitest";
import {
  liveDataSaverNotice,
  liveVehiclesDefault,
  readLiveDataEnvironment,
} from "./liveDataPolicy";

describe("readLiveDataEnvironment", () => {
  it("detects the browser Save-Data flag", () => {
    expect(
      readLiveDataEnvironment({ connection: { saveData: true } }).saveData,
    ).toBe(true);
    expect(
      readLiveDataEnvironment({ connection: { saveData: false } }).saveData,
    ).toBe(false);
  });

  it("treats a missing or malformed connection as not saving data", () => {
    expect(readLiveDataEnvironment({}).saveData).toBe(false);
    expect(
      readLiveDataEnvironment({ connection: {} as { saveData?: boolean } })
        .saveData,
    ).toBe(false);
    expect(
      readLiveDataEnvironment({
        connection: { saveData: "yes" } as unknown as { saveData?: boolean },
      }).saveData,
    ).toBe(false);
  });
});

describe("liveVehiclesDefault", () => {
  it("keeps live on for normal connections", () => {
    expect(liveVehiclesDefault(false, false)).toBe(true);
  });

  it("defaults to off under Save-Data", () => {
    expect(liveVehiclesDefault(false, true)).toBe(false);
  });

  it("always respects an explicit opt-out", () => {
    expect(liveVehiclesDefault(true, false)).toBe(false);
    expect(liveVehiclesDefault(true, true)).toBe(false);
  });
});

describe("liveDataSaverNotice", () => {
  it("stays quiet without Save-Data", () => {
    expect(liveDataSaverNotice(false, false)).toBeNull();
    expect(liveDataSaverNotice(false, true)).toBeNull();
  });

  it("explains the default-off state and the manual override", () => {
    expect(liveDataSaverNotice(true, false)).toBe(
      "Data Saver is on — live vehicles are off.",
    );
    expect(liveDataSaverNotice(true, true)).toBe(
      "Data Saver is on — live vehicles enabled manually.",
    );
  });
});
