import { describe, expect, it } from "vitest";
import { freeViewportPadding, routeBounds, type FitContext } from "./fitRoute";

const phone: FitContext = {
  viewportWidth: 390,
  viewportHeight: 844,
  // The sheet already drives the camera padding; at half it is 405.
  mapPadding: { top: 0, bottom: 405, left: 0, right: 0 },
  drawerWidth: 0,
  topbar: 103,
};

describe("routeBounds", () => {
  it("wraps every coordinate", () => {
    expect(
      routeBounds([
        [6.77, 51.22],
        [6.8, 51.2],
        [6.75, 51.25],
      ]),
    ).toEqual([
      [6.75, 51.2],
      [6.8, 51.25],
    ]);
  });

  it("is null without usable points", () => {
    expect(routeBounds([])).toBeNull();
    expect(routeBounds([[Number.NaN, 1]])).toBeNull();
  });
});

describe("freeViewportPadding", () => {
  it("adds only the remainder the map padding does not cover", () => {
    const padding = freeViewportPadding(phone);
    // MapLibre subtracts the map's own padding itself; repeating it makes the
    // box negative and the fit is refused.
    expect(padding.bottom).toBe(16);
    expect(padding.top).toBe(103 + 16);
    expect(padding.left).toBe(16);
  });

  it("leaves the sheet height to the map padding", () => {
    const padding = freeViewportPadding({
      ...phone,
      mapPadding: { top: 0, bottom: 88, left: 0, right: 0 },
    });
    expect(padding.bottom).toBe(16);
  });

  it("leaves room for the desktop drawer", () => {
    const padding = freeViewportPadding({
      viewportWidth: 1440,
      viewportHeight: 900,
      mapPadding: { top: 0, bottom: 0, left: 0, right: 0 },
      drawerWidth: 380,
      topbar: 24,
    });
    expect(padding.right).toBe(380 + 24);
    expect(padding.bottom).toBe(24);
  });

  it("uses plain margins on a closed desktop drawer", () => {
    const padding = freeViewportPadding({
      viewportWidth: 1440,
      viewportHeight: 900,
      mapPadding: { top: 0, bottom: 0, left: 0, right: 0 },
      drawerWidth: 0,
      topbar: 24,
    });
    expect(padding.right).toBe(24);
    expect(padding.left).toBe(24);
  });

  it("never asks for more than the free canvas can hold", () => {
    const padding = freeViewportPadding({
      ...phone,
      mapPadding: { top: 60, bottom: 700, left: 20, right: 20 },
    });
    // 844 - 60 - 700 = 84 of free canvas; 48 must stay for the route itself.
    expect(padding.top + padding.bottom).toBeLessThanOrEqual(84);
  });
});
