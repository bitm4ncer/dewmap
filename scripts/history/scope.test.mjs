import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const queryPath = resolve(dirname(fileURLToPath(import.meta.url)), "scope.rq");

describe("scope query", () => {
  it("excludes only direct P31 classes, not subclasses", async () => {
    const query = await readFile(queryPath, "utf8");
    assert.doesNotMatch(query, /P31\/wdt:P279\*\s+\?excluded/);
    assert.match(query, /P31\s+\?excluded/);
  });

  it("contains the reviewed categories whose subclasses were accidentally removed", async () => {
    const query = await readFile(queryPath, "utf8");
    for (const qid of ["Q23413", "Q33506", "Q1569871", "Q57831", "Q82117"]) {
      assert.match(query, new RegExp(`wd:${qid}`));
    }
  });
});
