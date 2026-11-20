import { describe, expect, it } from "vitest";
import { applyWhenReady, type MapLike } from "./applyWhenReady";

function stubMap(loaded: boolean) {
  const listeners = new Map<string, () => void>();
  const map: MapLike = {
    isStyleLoaded: () => loaded,
    once: (event, cb) => {
      listeners.set(event, cb);
    },
    off: (event) => {
      listeners.delete(event);
    },
  };
  return { map, listeners, fire: (event: string) => listeners.get(event)?.() };
}

describe("applyWhenReady", () => {
  it("applies immediately when the style is loaded", () => {
    const { map, listeners } = stubMap(true);
    let calls = 0;
    applyWhenReady(map, () => {
      calls += 1;
    });
    expect(calls).toBe(1);
    expect(listeners.has("idle")).toBe(false);
  });

  it("applies immediately and retries on idle while tiles stream", () => {
    const { map, fire } = stubMap(false);
    let calls = 0;
    applyWhenReady(map, () => {
      calls += 1;
    });
    expect(calls).toBe(1);
    fire("idle");
    expect(calls).toBe(2);
  });

  it("drops the idle retry on cleanup", () => {
    const { map, listeners, fire } = stubMap(false);
    let calls = 0;
    const stop = applyWhenReady(map, () => {
      calls += 1;
    });
    stop();
    expect(listeners.has("idle")).toBe(false);
    fire("idle");
    expect(calls).toBe(1);
  });

  it("swallows an apply that runs while the style is swapping", () => {
    const { map } = stubMap(false);
    expect(() =>
      applyWhenReady(map, () => {
        throw new Error("Style is not done loading");
      }),
    ).not.toThrow();
  });
});
