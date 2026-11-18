import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandForZoom, clusterSites } from "./cluster.mjs";

const SITE_A = {
  lon: 6.95,
  lat: 50.94,
  heritage: true,
  unesco: false,
  category: "castle",
};
const SITE_B = { ...SITE_A, lon: 6.951, lat: 50.941 };
const SITE_FAR = { ...SITE_A, lon: 8.7, lat: 50.1 };

describe("clusterSites", () => {
  it("groups nearby sites and counts heritage and UNESCO", () => {
    const clusters = clusterSites(
      [
        SITE_A,
        { ...SITE_B, heritage: false, unesco: true },
        SITE_FAR,
      ],
      { resolution: 5 },
    );
    const near = clusters.find((cluster) => cluster.count === 2);
    assert.ok(near);
    assert.equal(near.heritageCount, 1);
    assert.equal(near.unescoCount, 1);
    assert.equal(near.coordinates.length, 2);
    assert.equal(clusters.length, 2);
  });

  it("keeps distant sites separate", () => {
    const clusters = clusterSites([SITE_A, SITE_FAR], { resolution: 5 });
    assert.equal(clusters.length, 2);
  });

  it("returns no clusters for no sites", () => {
    assert.deepEqual(clusterSites([], { resolution: 4 }), []);
  });
});

describe("bandForZoom", () => {
  it("maps zoom bands without overlap", () => {
    assert.deepEqual(bandForZoom(0), { resolution: 1, minzoom: 0, maxzoom: 1 });
    assert.deepEqual(bandForZoom(2), { resolution: 2, minzoom: 2, maxzoom: 3 });
    assert.deepEqual(bandForZoom(4), { resolution: 3, minzoom: 4, maxzoom: 5 });
    assert.deepEqual(bandForZoom(7), { resolution: 4, minzoom: 6, maxzoom: 7 });
    assert.equal(bandForZoom(8), undefined);
  });
});
