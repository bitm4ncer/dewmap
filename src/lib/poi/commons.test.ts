import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCommonsImage } from "./commons";

const response = {
  query: {
    pages: {
      "1": {
        imageinfo: [
          {
            thumburl:
              "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/TEST.jpg/960px-TEST.jpg",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:TEST.jpg",
            extmetadata: {
              Artist: {
                value:
                  '<b><a href="//commons.wikimedia.org/wiki/User:Jane">Jane Doe</a></b>, <small>photo</small>',
              },
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
            },
          },
        ],
      },
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveCommonsImage", () => {
  it("returns a direct thumbnail URL with author and licence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => response,
      })),
    );

    const image = await resolveCommonsImage("File:Test unique one.jpg", 900);
    expect(image.url).toContain("thumb.wikimedia.org");
    expect(image.href).toBe("https://commons.wikimedia.org/wiki/File:TEST.jpg");
    expect(image.credit).toBe("Jane Doe, photo · CC BY-SA 4.0");
    expect(image.license).toBe("CC BY-SA 4.0");
    expect(image.licenseUrl).toContain("creativecommons.org");
  });

  it("falls back to Special:FilePath when the API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );

    const image = await resolveCommonsImage("File:Test fallback.jpg", 900);
    expect(image.url).toContain("Special:FilePath");
    expect(image.credit).toBe("Wikimedia Commons");
  });
});
