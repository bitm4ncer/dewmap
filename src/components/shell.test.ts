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

  it("starts on the dark vector map with a collapsed panel", () => {
    const settings = readFileSync(new URL("../lib/settings.ts", import.meta.url), "utf8");
    expect(settings).toContain('basemapMode: "vector"');
    expect(map).toMatch(/useState<SheetState>\(\(\) => \{[\s\S]*?return "peek"/);
  });

  it("opens on the Routes pane", () => {
    expect(map).toContain('useState<SidebarPane>("hiking")');
  });

  it("keeps sheet actions out of the tab row and orders the map panel", () => {
    const tabsStart = map.indexOf('className="hud-sheet-tabs"');
    const tabsEnd = map.indexOf("</nav>", tabsStart);
    const tabRow = map.slice(tabsStart, tabsEnd);
    expect(tabRow).not.toContain("sheet-close");
    expect(tabRow).not.toContain("sheet-expand");
    expect(map.indexOf('"Vector Maps"')).toBeLessThan(map.indexOf('"Image Maps"'));
    expect(map.indexOf("<TimelinePanel")).toBeLessThan(map.indexOf("<RailsPanel"));
  });

  it("keeps the search action in the location card", () => {
    const panel = readFileSync(
      new URL("./planner/TransitPanel.tsx", import.meta.url),
      "utf8",
    );
    const find = panel.indexOf("Find connections");
    const when = panel.indexOf('"ui-kicker">When');
    expect(find).toBeGreaterThan(-1);
    expect(find).toBeLessThan(when);
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
