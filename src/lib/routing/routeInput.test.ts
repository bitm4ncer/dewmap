import { describe, expect, it } from "vitest";
import {
  inputFromTransit,
  inputFromWaypoints,
  inputWithPin,
  toTransitPlaces,
  toWaypoints,
} from "./routeInput";

const start = { name: "My location", lat: 49.41, lon: 8.69 };
const end = { name: "Mannheim Hbf", lat: 49.479, lon: 8.469, kind: "stop" as const };

describe("route input", () => {
  it("round-trips transit places through waypoints", () => {
    const input = inputFromTransit(start, end, [{ name: "Heidelberg Hbf", lat: 49.403, lon: 8.675 }]);
    const waypoints = toWaypoints(input);
    expect(waypoints.map((w) => w.label)).toEqual(["My location", "Heidelberg Hbf", "Mannheim Hbf"]);
    expect(waypoints[0].source).toBe("gps");
    expect(waypoints[2].source).toBe("search");
    const back = inputFromWaypoints(waypoints.map((w, i) => ({ ...w, id: String(i) })));
    expect(back.start?.lat).toBe(49.41);
    expect(back.via.map((v) => v.name)).toEqual(["Heidelberg Hbf"]);
    expect(back.end?.name).toBe("Mannheim Hbf");
  });

  it("maps back to transit places", () => {
    const input = inputFromWaypoints(
      toWaypoints(inputFromTransit(start, end, [])).map((w, i) => ({ ...w, id: String(i) })),
    );
    const { from, to, via } = toTransitPlaces(input);
    expect(from?.name).toBe("My location");
    expect(to?.name).toBe("Mannheim Hbf");
    expect(via).toEqual([]);
  });

  it("builds a pin input with the current position as start", () => {
    const input = inputWithPin(start, { name: "Ziel", lat: 50, lon: 9 });
    expect(input.start?.name).toBe("My location");
    expect(input.end?.name).toBe("Ziel");
    expect(input.via).toEqual([]);
  });
});
