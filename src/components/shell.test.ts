import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const poi = readFileSync(
  new URL("./poi/PoiDetail.tsx", import.meta.url),
  "utf8",
);

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

  it("puts orientation on a map compass instead of the panel", () => {
    expect(map).toContain("new OrientationControl");
    expect(map).not.toContain("Map orientation");
  });

  it("shows the pane switcher instead of a burger when the drawer is closed", () => {
    expect(map).toContain("hud-desk-nav");
    expect(map).not.toContain("hud-drawer-open");
    expect(css).toContain(".hud-desk-nav");
    expect(css).not.toContain(".hud-drawer-open");
    // The floating bar is desktop-only; phones keep the bottom sheet tabs.
    expect(css).toMatch(/@media \(min-width: 768px\) \{ \.hud-desk-nav \{ display: flex; \} \}/);
  });

  it("orders the pane tabs History, Nature, Map, Routes", () => {
    const start = map.indexOf("const SIDEBAR_PANES");
    const block = map.slice(start, map.indexOf("\n];", start) + 3);
    const order = [...block.matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["history", "biosphere", "control", "hiking"]);
  });

  it("opens place details when a search result is selected", () => {
    const search = map.slice(
      map.indexOf("const handleSearchSelect"),
      map.indexOf("const handleStartTimeline"),
    );
    expect(search).toContain("openPoi({");
    expect(search).toContain("setPendingPin(null)");
    expect(search).not.toContain("setPendingPin({");
  });

  it("retries overlay layers once the map becomes idle", () => {
    const retries = map.match(/map\.once\("idle", apply\)/g) ?? [];
    expect(retries.length).toBeGreaterThanOrEqual(5);
  });

  it("lets active overlay badges be dismissed from the map", () => {
    expect(map).toContain("onDismiss: () => setLandCoverOn(false)");
    expect(map).toContain("onClick={overlay.onDismiss}");
    expect(map).toContain("Turn off ${overlay.label}");
  });

  it("marks a selected place and offers route planning from its card", () => {
    expect(map).toContain("poi-crosshair");
    expect(map).toContain("planPoiRoute");
    expect(map).toContain("onPlanRoute={planPoiRoute}");
    expect(poi).toContain("Plan Route");
  });

  it("puts the desktop header above the pane tabs", () => {
    expect(map.indexOf('className="ui-panel-header hidden md:flex"')).toBeLessThan(
      map.indexOf('className="hud-panel-tabs"'),
    );
  });

  it("uses live-capable overlay endpoints", () => {
    expect(map).not.toContain("__map");
    expect(map).toContain("mapproxy.terrascope.be");
    expect(map).toContain("{bbox-epsg-3857}");
    expect(map).toContain("OMI_Nitrogen_Dioxide_Tropo_Column");
    expect(map).not.toContain('"OMI_NO2_Tropospheric_Column"');
  });

  it("keeps sheet actions out of the tab row and orders the map panel", () => {
    const tabsStart = map.indexOf('className="hud-sheet-tabs"');
    const tabsEnd = map.indexOf("</nav>", tabsStart);
    const tabRow = map.slice(tabsStart, tabsEnd);
    expect(tabRow).not.toContain("sheet-close");
    expect(tabRow).not.toContain("sheet-expand");
    expect(map.indexOf('"Vector Maps"')).toBeLessThan(map.indexOf('"Image Maps"'));
    expect(map.indexOf("<TimelinePanel")).toBeLessThan(map.indexOf("<DataSourcesPanel"));
    // The rails toggle lives in the View section; the old standalone
    // Rails panel with its opacity slider is gone.
    expect(map).toContain("onRailChange={setRailOn}");
    expect(map).not.toContain("<RailsPanel");
  });

  it("searches transit without a submit button", () => {
    const panel = readFileSync(
      new URL("./planner/TransitPanel.tsx", import.meta.url),
      "utf8",
    );
    expect(panel).not.toContain("Find connections");
    expect(panel).toContain("transitSearchKey");
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
