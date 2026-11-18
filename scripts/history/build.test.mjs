import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildId, capSites } from "./build.mjs";

describe("capSites", () => {
  it("keeps every represented category when the cap applies", () => {
    const sites = [
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `castle-${index}`,
        name: `Castle ${index}`,
        category: "castle",
        heritage: true,
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `museum-${index}`,
        name: `Museum ${index}`,
        category: "museum",
        heritage: false,
      })),
      ...Array.from({ length: 20 }, (_, index) => ({
        id: `religious-${index}`,
        name: `Church ${index}`,
        category: "religious",
        heritage: true,
      })),
    ];
    const capped = capSites(sites, 9, { categoryQuota: 0.1 });
    const categories = new Set(capped.map((site) => site.category));
    assert.equal(capped.length, 9);
    assert.deepEqual([...categories].sort(), ["castle", "museum", "religious"]);
  });

  it("does not duplicate an id shared by two categories", () => {
    const sites = [
      { id: "same", name: "A", category: "castle", heritage: true },
      { id: "same", name: "A", category: "museum", heritage: false },
      { id: "other", name: "B", category: "religious", heritage: true },
    ];
    const capped = capSites(sites, 2, { categoryQuota: 0.2 });
    assert.equal(new Set(capped.map((site) => site.id)).size, capped.length);
  });
});

describe("buildId", () => {
  it("includes seconds so a rerun cannot overwrite the previous build", () => {
    assert.equal(
      buildId(new Date("2026-11-18T04:00:31Z")),
      "history-20261118-040031",
    );
  });
});
