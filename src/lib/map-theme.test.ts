import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME } from "./theme";

const files = ["../components/Map.tsx", "../components/hiking/useHikingLayers.ts", "../components/planner/usePlannerLayers.ts"]
  .map((p) => readFileSync(new URL(p, import.meta.url), "utf8"));

const allowed = new Set(
  Object.values(THEME).filter((v) => v.startsWith("#")).map((v) => v.toLowerCase()),
);

describe("map paint colors", () => {
  it("uses only theme hexes in map-layer code", () => {
    const bad = files.flatMap((text) =>
      [...text.matchAll(/#[0-9a-f]{6}\b/gi)].map((m) => m[0]).filter((h) => !allowed.has(h.toLowerCase())),
    );
    expect([...new Set(bad)]).toEqual([]);
  });
});
