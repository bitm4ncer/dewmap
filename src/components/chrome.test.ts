import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("./", import.meta.url).pathname;
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );
}
const files = walk(root).map((p) => ({ path: p, text: readFileSync(p, "utf8") }));

describe("component chrome", () => {
  it("has no corner marks, tape or scanlines", () => {
    const bad = files.filter((f) => /hud-corner|pane-tape|hud-scanlines/.test(f.text));
    expect(bad.map((f) => f.path)).toEqual([]);
  });

  it("has no Tailwind border/ring utilities", () => {
    const bad = files.filter((f) => /\bborder-[a-z0-9[]|\bborder-[trblxy]\b|\bring-\d/.test(f.text));
    expect(bad.map((f) => f.path)).toEqual([]);
  });
});
