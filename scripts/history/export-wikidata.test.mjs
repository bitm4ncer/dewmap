import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { buildQuery, exportPages, parseCsv } from "./export-wikidata.mjs";

const cleanups = [];
afterEach(async () => {
  for (const dir of cleanups.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("parseCsv", () => {
  it("handles quoted commas, quotes and newlines", () => {
    const rows = parseCsv(
      'item,name,coord\r\nQ1,"Castle, Old",POINT(1 2)\r\nQ2,"Say ""hi""",POINT(3 4)\r\n',
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, "Castle, Old");
    assert.equal(rows[1].name, 'Say "hi"');
  });
});

describe("buildQuery", () => {
  it("injects a keyset cursor and limit", () => {
    const query = buildQuery("SELECT * WHERE { %%CURSOR_FILTER%% } LIMIT %%LIMIT%%", 25, "Q123");
    assert.match(query, /FILTER\(\?item > <http:\/\/www\.wikidata\.org\/entity\/Q123>\)/);
    assert.match(query, /LIMIT 25/);
  });

  it("omits the filter on the first page", () => {
    const query = buildQuery("SELECT * WHERE { %%CURSOR_FILTER%% } LIMIT %%LIMIT%%", 10);
    assert.doesNotMatch(query, /FILTER/);
    assert.match(query, /LIMIT 10/);
  });
});

describe("exportPages", () => {
  it("writes pages and a resumable cursor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "history-export-"));
    cleanups.push(dir);
    const calls = [];
    const fetchImpl = async (_url, init) => {
      calls.push(String(init.body));
      const page = calls.length;
      const rows =
        page === 1
          ? [
              "item,name,coord,inception,dissolved,types,heritage,unesco",
              "http://www.wikidata.org/entity/Q1,A,POINT(1 2),,,Q23413,true,false",
              "http://www.wikidata.org/entity/Q2,B,POINT(3 4),,,Q23413,true,false",
            ]
          : [
              "item,name,coord,inception,dissolved,types,heritage,unesco",
              "http://www.wikidata.org/entity/Q3,C,POINT(5 6),,,Q23413,true,false",
            ];
      return new Response(rows.join("\n"), { status: 200 });
    };
    const result = await exportPages({
      outDir: dir,
      pageSize: 2,
      limit: 10,
      queryTemplate: "SELECT * WHERE { %%CURSOR_FILTER%% } LIMIT %%LIMIT%%",
      fetchImpl,
      sleepImpl: async () => {},
    });
    assert.equal(result.rows, 3);
    assert.equal(result.pages, 2);
    assert.match(await readFile(join(dir, "page-0001.csv"), "utf8"), /Q1/);
    assert.match(await readFile(join(dir, "page-0002.csv"), "utf8"), /Q3/);
    const cursor = JSON.parse(await readFile(join(dir, "cursor.json"), "utf8"));
    assert.equal(cursor.cursor, "Q3");
    assert.match(calls[1], /Q2/);
  });

  it("falls back to WDQS when QLever keeps failing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "history-export-"));
    cleanups.push(dir);
    const targets = [];
    const fetchImpl = async (url) => {
      targets.push(url);
      if (String(url).includes("qlever")) {
        return new Response("down", { status: 503 });
      }
      return new Response(
        "item,name,coord,inception,dissolved,types,heritage,unesco\nhttp://www.wikidata.org/entity/Q9,Nine,POINT(1 2),,,Q23413,true,false\n",
        { status: 200 },
      );
    };
    const result = await exportPages({
      outDir: dir,
      pageSize: 2,
      limit: 1,
      queryTemplate: "SELECT * WHERE { %%CURSOR_FILTER%% } LIMIT %%LIMIT%%",
      fetchImpl,
      sleepImpl: async () => {},
    });
    assert.equal(result.rows, 1);
    assert.ok(targets.some((url) => String(url).includes("wikidata.org")));
  });

  it("honours a page offset for resumed exports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "history-export-"));
    cleanups.push(dir);
    const fetchImpl = async () =>
      new Response(
        "item,name,coord,inception,dissolved,types,heritage,unesco\nhttp://www.wikidata.org/entity/Q9,Nine,POINT(1 2),,,Q23413,true,false\n",
        { status: 200 },
      );
    const result = await exportPages({
      outDir: dir,
      pageSize: 2,
      limit: 2,
      pageStart: 3,
      queryTemplate: "SELECT * WHERE { %%CURSOR_FILTER%% } LIMIT %%LIMIT%%",
      fetchImpl,
      sleepImpl: async () => {},
    });
    assert.equal(result.pages, 1);
    assert.match(await readFile(join(dir, "page-0003.csv"), "utf8"), /Q9/);
  });
});
