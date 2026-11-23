import { describe, expect, it } from "vitest";
import { ShadowDataError } from "./buildings";
import { shadowErrorOutcome, SHADOW_TIMEOUT_MESSAGE } from "./errors";

describe("shadow error classification", () => {
  it("stays silent for real aborts", () => {
    expect(shadowErrorOutcome(new ShadowDataError("aborted", "aborted"))).toEqual({
      ignore: true,
      message: null,
    });
    const domAbort = new Error("aborted");
    domAbort.name = "AbortError";
    expect(shadowErrorOutcome(domAbort).ignore).toBe(true);
  });

  it("reports a timeout instead of swallowing it", () => {
    const outcome = shadowErrorOutcome(new ShadowDataError("timeout", "no response after 8000 ms"));
    expect(outcome.ignore).toBe(false);
    expect(outcome.message).toBe(SHADOW_TIMEOUT_MESSAGE);
    expect(outcome.message).toContain("timed out");
  });

  it("maps the remaining data errors to actionable copy", () => {
    expect(shadowErrorOutcome(new ShadowDataError("network", "x")).message).toContain(
      "not reachable",
    );
    expect(shadowErrorOutcome(new ShadowDataError("decode", "x")).message).toContain(
      "decoded",
    );
    expect(shadowErrorOutcome(new ShadowDataError("http", "x")).message).toContain("error");
    expect(shadowErrorOutcome(new ShadowDataError("empty", "x")).ignore).toBe(false);
  });

  it("passes unknown errors through as a message", () => {
    expect(shadowErrorOutcome(new Error("boom"))).toEqual({ ignore: false, message: "boom" });
    expect(shadowErrorOutcome("weird")).toEqual({
      ignore: false,
      message: "Shadow render failed.",
    });
  });
});
