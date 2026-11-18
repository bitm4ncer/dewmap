import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./TransitPanel.tsx", import.meta.url), "utf8");

describe("transit panel layout", () => {
  it("shows the selected journey detail above the connection list", () => {
    expect(src.indexOf("<JourneyDetail")).toBeLessThan(
      src.indexOf(">When<"),
    );
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
