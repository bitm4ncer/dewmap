import { describe, expect, it } from "vitest";
import {
  RAIL_VECTOR_ATTRIBUTION,
  RAIL_VECTOR_LINES_LAYER,
  RAIL_VECTOR_STATIONS_LAYER,
  RAIL_VECTOR_TILEJSON_URL,
} from "./railway";

describe("rail data sources", () => {
  it("uses the OpenFreeMap rail schema", () => {
    expect(RAIL_VECTOR_TILEJSON_URL).toContain("openfreemap.org");
    expect(RAIL_VECTOR_LINES_LAYER).toBe("transportation");
    expect(RAIL_VECTOR_STATIONS_LAYER).toBe("poi");
    expect(RAIL_VECTOR_ATTRIBUTION).toContain("OpenStreetMap");
    expect(RAIL_VECTOR_ATTRIBUTION).toContain("OpenFreeMap");
  });
});
