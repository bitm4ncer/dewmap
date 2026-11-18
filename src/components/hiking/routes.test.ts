import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("../hud/HikingPanel.tsx", import.meta.url), "utf8");
const layers = readFileSync(new URL("./useHikingLayers.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("route identity", () => {
  it("drops the generated pastel palette", () => {
    expect(panel).not.toContain("pastelForWaypoint");
    expect(layers).not.toContain("pastelForWaypoint");
  });
  it("never floods a card with its route color", () => {
    expect(css).not.toMatch(/background:\s*var\(--route-color/);
  });
});
