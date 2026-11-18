import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const map = readFileSync(new URL("./Map.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("shell", () => {
  it("has no logo in the top bar", () => {
    expect(map).not.toContain("ui-logo");
    expect(map).not.toContain("ICON_BASE_PATH");
    expect(css).not.toContain(".ui-logo");
  });

  it("opens on the Routes pane", () => {
    expect(map).toContain('useState<SidebarPane>("hiking")');
  });

  it("gives every travel mode an icon", () => {
    const routes = readFileSync(new URL("./hud/RoutesPanel.tsx", import.meta.url), "utf8");
    for (const icon of ["TransitIcon", "WalkIcon", "BikeIcon", "CarIcon"]) {
      expect(routes).toContain(`<${icon}`);
    }
  });

  it("draws a heading arrow in the live marker", () => {
    expect(map).toContain("live-location-arrow");
    expect(css).toContain(".live-location-arrow");
  });

  it("leads the top bar with search and keeps the basemap switch after it", () => {
    const start = map.indexOf('className={["ui-topbar"');
    const end = map.indexOf("{/* Rail-network loading pill", start);
    const topbar = map.slice(start, end);
    expect(topbar).not.toContain("<img");
    expect(topbar.indexOf("<SearchBox")).toBeGreaterThan(-1);
    expect(topbar.indexOf("<SearchBox")).toBeLessThan(topbar.indexOf("<BasemapSwitch"));
  });
});
