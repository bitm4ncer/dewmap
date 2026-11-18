import { describe, expect, it, vi } from "vitest";
import {
  escapeHistoryHtml,
  externalLinkIcon,
  fetchSiteDetail,
  siteDetailHeader,
  siteDetailLinks,
  stripHistoryEmoji,
} from "./detail";
import type { HistoricSiteTile } from "./types";

const SITE: HistoricSiteTile = {
  id: "wd/Q1",
  qid: "Q1",
  name: "Test <Castle>",
  category: "castle",
  heritage: true,
  unesco: false,
  inception: 1200,
};

describe("escapeHistoryHtml", () => {
  it("escapes markup and quotes", () => {
    expect(escapeHistoryHtml('<a href="x">&\'')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });
});

describe("stripHistoryEmoji", () => {
  it("removes platform emoji from data-driven text", () => {
    expect(stripHistoryEmoji("Castle \u{1F3F0}  ·  Tower \u{1F5FC}")).toBe("Castle · Tower");
  });
});

describe("externalLinkIcon", () => {
  it("uses an inline SVG instead of a Unicode arrow", () => {
    const icon = externalLinkIcon();
    expect(icon).toContain("<svg");
    expect(icon).not.toContain("\u2197");
  });
});

describe("siteDetailHeader", () => {
  it("renders name, category and dates", () => {
    const html = siteDetailHeader(SITE);
    expect(html).toContain("Test &lt;Castle&gt;");
    expect(html).toContain("Castle");
    expect(html).toContain("1200");
  });

  it("strips emoji from names", () => {
    const html = siteDetailHeader({ ...SITE, name: "Castle \u{1F3F0}" });
    expect(html).not.toContain("\u{1F3F0}");
    expect(html).toContain("Castle");
  });

  it("marks undated sites", () => {
    expect(siteDetailHeader({ ...SITE, inception: undefined })).toContain(
      "date unknown",
    );
  });

  it("adds heritage and UNESCO badges", () => {
    const html = siteDetailHeader({ ...SITE, unesco: true });
    expect(html).toContain("Heritage");
    expect(html).toContain("UNESCO");
  });
});

describe("siteDetailLinks", () => {
  it("links Wikidata and OSM", () => {
    const html = siteDetailLinks(SITE);
    expect(html).toContain("https://www.wikidata.org/wiki/Q1");
    expect(html).toContain("https://www.openstreetmap.org/");
    expect(html).toContain("<svg");
    expect(html).not.toContain("\u2197");
  });

  it("omits the Wikidata link without a QID", () => {
    expect(siteDetailLinks({ ...SITE, qid: "" })).not.toContain("wikidata.org");
    expect(siteDetailLinks(SITE, [9.19, 45.86])).toContain(
      "query=45.86%2C9.19",
    );
  });
});

describe("fetchSiteDetail", () => {
  it("returns summary and image from injected lookups", async () => {
    const summary = vi.fn(async () => ({
      title: "Test Castle",
      extract: "A fine castle.",
      url: "https://en.wikipedia.org/wiki/Test_Castle",
      lang: "en",
    }));
    const image = vi.fn(async () => "https://commons.test/castle.jpg");
    const detail = await fetchSiteDetail(SITE, { summary, image });
    expect(detail.summary?.extract).toBe("A fine castle.");
    expect(detail.image).toBe("https://commons.test/castle.jpg");
    expect(summary).toHaveBeenCalledWith("Q1");
  });

  it("survives missing detail", async () => {
    const detail = await fetchSiteDetail(
      { ...SITE, qid: "" },
      {
        summary: async () => null,
        image: async () => null,
      },
    );
    expect(detail).toEqual({ summary: null, image: null });
  });
});
