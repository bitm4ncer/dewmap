import { describe, expect, it } from "vitest";
import {
  ALERT_REFRESH_MS,
  alertGateAction,
  commitAlertGate,
  initialAlertGate,
  movedKm,
  resetAlertGate,
} from "./alertSchedule";

const CENTER = { lat: 50.11, lon: 8.68 };
const NOW = 1_700_000_000_000;

describe("alert refresh gate", () => {
  it("clears alerts when the view has no sampled stops (F2)", () => {
    const gate = commitAlertGate(CENTER, NOW);
    expect(
      alertGateAction(gate, {
        stopCount: 0,
        center: CENTER,
        now: NOW + 10_000,
      }),
    ).toBe("clear");
    // An empty sample must not leave a timestamp that suppresses the next
    // visit; the hook resets the gate, so a fresh stop list refreshes.
    expect(
      alertGateAction(resetAlertGate(), {
        stopCount: 2,
        center: CENTER,
        now: NOW + 20_000,
      }),
    ).toBe("refresh");
  });

  it("refreshes immediately after a zoom reset (F3)", () => {
    const gate = commitAlertGate(CENTER, NOW);
    expect(
      alertGateAction(gate, { stopCount: 2, center: CENTER, now: NOW + 1 }),
    ).toBe("skip");
    const afterZoom = resetAlertGate();
    expect(
      alertGateAction(afterZoom, {
        stopCount: 2,
        center: CENTER,
        now: NOW + 2,
      }),
    ).toBe("refresh");
  });

  it("skips repeats inside the 5-minute and 4-km window", () => {
    const gate = commitAlertGate(CENTER, NOW);
    expect(
      alertGateAction(gate, {
        stopCount: 3,
        center: { lat: 50.12, lon: 8.69 },
        now: NOW + ALERT_REFRESH_MS - 1,
      }),
    ).toBe("skip");
  });

  it("refreshes after five minutes or a four-kilometre move", () => {
    const gate = commitAlertGate(CENTER, NOW);
    expect(
      alertGateAction(gate, {
        stopCount: 3,
        center: CENTER,
        now: NOW + ALERT_REFRESH_MS,
      }),
    ).toBe("refresh");
    expect(
      alertGateAction(gate, {
        stopCount: 3,
        center: { lat: CENTER.lat + 0.05, lon: CENTER.lon },
        now: NOW + 1_000,
      }),
    ).toBe("refresh");
    expect(
      alertGateAction(initialAlertGate(), {
        stopCount: 1,
        center: CENTER,
        now: NOW,
      }),
    ).toBe("refresh");
  });
});

describe("movedKm", () => {
  it("scales longitude by latitude and treats the same point as zero", () => {
    expect(movedKm(CENTER, CENTER)).toBe(0);
    expect(movedKm(CENTER, { lat: CENTER.lat, lon: CENTER.lon + 0.1 }))
      .toBeGreaterThan(6);
    expect(movedKm(CENTER, { lat: CENTER.lat + 0.1, lon: CENTER.lon }))
      .toBeGreaterThan(11);
  });
});
