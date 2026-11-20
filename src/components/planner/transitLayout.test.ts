import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./TransitPanel.tsx", import.meta.url), "utf8");

describe("transit panel layout", () => {
  it("shows the selected journey detail above the connection list", () => {
    expect(src.indexOf("<JourneyDetail")).toBeLessThan(src.indexOf(">When<"));
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

  it("offers departure chips above the journey detail", () => {
    expect(src).toContain("journey-switcher");
    expect(src).toContain("Next departures");
    // A tap on a chip selects and scrolls; automatic swaps do not.
    expect(src).toContain("selectFromUi(entry.id)");
  });

  it("keeps the When field at a compact width", () => {
    expect(src).toContain('className="ui-input ui-input-date"');
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
