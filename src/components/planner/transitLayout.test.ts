import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./TransitPanel.tsx", import.meta.url), "utf8");

describe("transit panel layout", () => {
  it("folds the form into a summary so the route sits at the top", () => {
    // Collapsed: summary line, then the journey. Expanded: the same summary
    // slot holds the inputs, so the route never sits under a tall form.
    expect(src).toContain("transit-summary");
    expect(src).toContain("const showForm = formOpen || !from || !to");
    const summary = src.indexOf("transit-summary");
    expect(summary).toBeLessThan(src.indexOf("<JourneyDetail"));
    expect(src.indexOf("<JourneyDetail")).toBeLessThan(
      src.indexOf("Connections ·"),
    );
  });

  it("scrolls a freshly selected journey detail into view", () => {
    expect(src).toContain("scrollIntoView");
  });

  it("explains reservation and colours transfer urgency", () => {
    const detail = readFileSync(
      new URL("./JourneyDetail.tsx", import.meta.url),
      "utf8",
    );
    expect(detail).toContain(
      "Reservation required: book a seat before boarding.",
    );
    expect(detail).toContain("transferSeverity");
    expect(detail).toContain("Transfer colours: amber under 5 min");
  });

  it("clears alert-line highlights when the transit panel unmounts", () => {
    expect(src).toContain(
      "return () => useTransit.getState().setLiveAlertLines([]);",
    );
  });

  it("keeps every filter chip reachable and explains empty filters", () => {
    const bar = readFileSync(
      new URL("./LiveTransitBar.tsx", import.meta.url),
      "utf8",
    );
    expect(bar).toContain('className="sr-only" aria-live="polite"');
    expect(bar).toContain("Live vehicles visible in this view.");
    expect(bar.match(/aria-live="/g)?.length ?? 0).toBe(1);
    expect(bar).not.toContain("disabled={!available");
    expect(bar).toContain("No ${group.label.toLowerCase()} vehicles in this view.");
    expect(bar).toContain("Show all");
    expect(bar).toContain("The filter hides all");
  });

  it("offers departure chips above the journey detail", () => {
    expect(src).toContain("journey-switcher");
    expect(src).toContain("Next departures");
    // A tap on a chip selects and scrolls; automatic swaps do not.
    expect(src).toContain("selectFromUi(entry.id)");
  });

  it("keeps the When field at a compact width", () => {
    expect(src).toContain('className="ui-input ui-input-date"');
  });

  it("keeps live vehicles outside Route options and always visible", () => {
    const bar = readFileSync(
      new URL("./LiveTransitBar.tsx", import.meta.url),
      "utf8",
    );
    expect(bar).toContain('role="switch"');
    expect(bar).toContain("aria-checked={liveVehicles}");
    expect(bar).toContain("Disruptions");
    expect(bar).toContain("Vehicles in view");
    // The old buried toggle is gone, the bar is a sibling of the collapsible
    // form/summary rather than a child of "Route options".
    expect(src).not.toContain('label="Live vehicles"');
    // Expanded: the bar sits directly under the header, above When/Filters/
    // Route options. Collapsed: it follows the summary line.
    const barIndex = src.indexOf("<LiveTransitBar />");
    expect(barIndex).toBeGreaterThan(src.indexOf("Train &amp; local transit"));
    expect(barIndex).toBeLessThan(src.indexOf(">Route options<"));
    expect(src).toContain("{!showForm && <LiveTransitBar />}");
    expect(src.indexOf("transit-summary")).toBeLessThan(
      src.indexOf("{!showForm && <LiveTransitBar />}"),
    );
  });

  it("does not pin the journey actions while scrolling", () => {
    expect(journeyDetail).not.toContain("sticky");
  });
});

const journeyDetail = readFileSync(
  new URL("./JourneyDetail.tsx", import.meta.url),
  "utf8",
);

const picker = readFileSync(
  new URL("./PlacePicker.tsx", import.meta.url),
  "utf8",
);

describe("station input form", () => {
  it("keeps location and map actions inside the input", () => {
    expect(picker).toContain("actionCount");
    expect(picker).toContain('aria-label="Use my location"');
    expect(picker).toContain('aria-label="Pick on map"');
  });

  it("resolves My location to a street address in the field", () => {
    expect(picker).toContain("reverseGeocode");
  });

  it("puts history behind a collapsed toggle", () => {
    expect(picker).toContain("ui-history-toggle");
    expect(picker).toContain("useState(false)");
  });

  it("gives the station inputs the full card width", () => {
    expect(src).not.toContain("items-stretch gap-2");
    expect(src).toContain('className="ui-input-action"');
  });

  it("searches on its own once origin and destination are set", () => {
    expect(src).toContain("transit-place-row");
    expect(src).toContain("transit-place-fields");
    // No submit button: the form searches as soon as the question is complete.
    expect(src).not.toContain("Find connections");
    expect(src).not.toContain("transit-find-btn");
    expect(src).toContain("transitSearchKey");
  });

  it("marks origin and destination while they are still empty", () => {
    expect(src).toContain("missing={!from}");
    expect(src).toContain("missing={!to}");
  });
});
