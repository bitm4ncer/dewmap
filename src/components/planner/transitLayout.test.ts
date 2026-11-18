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

  it("keeps the When field at a compact width", () => {
    expect(src).toContain('className="ui-input ui-input-date"');
  });
});

const picker = readFileSync(
  new URL("./PlacePicker.tsx", import.meta.url),
  "utf8",
);

describe("station input form", () => {
  it("keeps location and map actions inside the input", () => {
    expect(picker).toContain("ui-input--actions");
    expect(picker).toContain('aria-label="Use my location"');
    expect(picker).toContain('aria-label="Pick on map"');
  });

  it("puts history behind a collapsed toggle", () => {
    expect(picker).toContain("ui-history-toggle");
    expect(picker).toContain("useState(false)");
  });

  it("gives the station inputs the full card width", () => {
    expect(src).not.toContain("items-stretch gap-2");
    expect(src).toContain('className="ui-input-action"');
  });
});
