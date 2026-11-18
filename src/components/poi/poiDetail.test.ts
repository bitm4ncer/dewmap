import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("./PoiDetail.tsx", import.meta.url), "utf8");

describe("PoiDetail hero", () => {
  it("renders no placeholder when there is no photo", () => {
    expect(src).not.toContain("poi-hero-fallback");
    expect(src).not.toContain("poi-hero--empty");
    expect(src).toContain("{hasImage && current && (");
  });

  it("keeps the close control in flow when the hero is absent", () => {
    expect(src).toContain("poi-close--inline");
  });
});
