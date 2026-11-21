import { describe, expect, it } from "vitest";
import {
  RADAR_GRADIENT,
  RADAR_PALETTE,
  formatClock,
  frameHint,
  frameOffsetMinutes,
  radarCoordinates,
  radarFrameUrls,
  weatherDayKey,
} from "./radar";

const anchor = "2026-11-21T04:50:00.000Z";
const frame = (time: string, kind: "analysis" | "forecast" = "analysis") => ({
  time,
  kind,
});

describe("radar coordinates", () => {
  it("maps the lon/lat bbox to image corners, north first", () => {
    const coords = radarCoordinates([1, 45, 19, 56]);
    expect(coords).toEqual([
      [1, 56],
      [19, 56],
      [19, 45],
      [1, 45],
    ]);
  });
});

describe("frame offsets", () => {
  it("is negative for analysis frames and positive for nowcast", () => {
    expect(frameOffsetMinutes(frame("2026-11-21T03:55:00.000Z"), anchor)).toBe(-55);
    expect(frameOffsetMinutes(frame(anchor), anchor)).toBe(0);
    expect(frameOffsetMinutes(frame("2026-11-21T05:20:00.000Z", "forecast"), anchor)).toBe(30);
  });

  it("never returns NaN for unparseable input", () => {
    expect(frameOffsetMinutes(frame("nonsense"), anchor)).toBe(0);
    expect(frameOffsetMinutes(frame(anchor), "nonsense")).toBe(0);
  });
});

describe("frame hints", () => {
  it("labels past, now and nowcast", () => {
    expect(frameHint(frame("2026-11-21T03:55:00.000Z"), anchor)).toBe("vor 55 Min");
    expect(frameHint(frame(anchor), anchor)).toBe("Jetzt");
    expect(frameHint(frame("2026-11-21T06:20:00.000Z", "forecast"), anchor)).toBe(
      "Nowcast +90 Min",
    );
  });
});

describe("clock formatting", () => {
  it("formats in the requested timezone", () => {
    expect(formatClock("2026-11-21T04:50:00.000Z", "UTC")).toBe("04:50");
    expect(formatClock("2026-11-21T04:50:00.000Z", "Europe/Berlin")).toBe("05:50");
  });

  it("degrades gracefully", () => {
    expect(formatClock("not a date", "UTC")).toBe("--:--");
  });
});

describe("legend", () => {
  it("uses the 15 DWD classes in order", () => {
    expect(RADAR_PALETTE).toHaveLength(15);
    expect(RADAR_PALETTE[0]).toBe("#33ffff");
    expect(RADAR_PALETTE.at(-1)).toBe("#0000fe");
  });

  it("turns the palette into a CSS gradient", () => {
    expect(RADAR_GRADIENT.startsWith("linear-gradient(to right, #33ffff")).toBe(true);
    expect(RADAR_GRADIENT).toContain("#fe0000");
  });
});

describe("frame urls", () => {
  it("resolves gateway-relative paths against the data API origin", () => {
    // Regression: the prefetch used the raw relative url and hit the app
    // origin (18 x 404) instead of the gateway.
    expect(
      radarFrameUrls([
        {
          slot: "20261121T1410",
          time: "2026-11-21T14:10:00.000Z",
          kind: "analysis",
          url: "/api/weather/radar/frames/20261121T1410.png",
        },
      ]),
    ).toEqual([
      "https://data.dewmap.app/api/weather/radar/frames/20261121T1410.png",
    ]);
  });

  it("keeps absolute urls untouched", () => {
    expect(
      radarFrameUrls([
        {
          slot: "x",
          time: "2026-11-21T14:10:00.000Z",
          kind: "forecast",
          url: "https://cdn.example/f.png",
        },
      ]),
    ).toEqual(["https://cdn.example/f.png"]);
  });
});

describe("daylight saving", () => {
  it("formats both sides of the spring change in Berlin time", () => {
    // The clock jumps 02:00 CET -> 03:00 CEST at 01:00 UTC on 2026-03-29.
    expect(formatClock("2026-03-29T00:30:00.000Z")).toBe("01:30");
    expect(formatClock("2026-03-29T01:00:00.000Z")).toBe("03:00");
    expect(formatClock("2026-03-29T02:00:00.000Z")).toBe("04:00");
    expect(weatherDayKey(new Date("2026-03-28T23:30:00.000Z"))).toBe("2026-03-29");
  });

  it("formats both sides of the autumn change in Berlin time", () => {
    // 2026-10-25 00:30 UTC is 02:30 CEST, 01:30 UTC is 02:30 CET.
    expect(formatClock("2026-10-25T00:30:00.000Z")).toBe("02:30");
    expect(formatClock("2026-10-25T01:30:00.000Z")).toBe("02:30");
    expect(formatClock("2026-10-25T02:30:00.000Z")).toBe("03:30");
  });
});
