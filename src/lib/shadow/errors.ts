/**
 * Turning a failed shadow run into something the panel can say.
 *
 * The one distinction that matters: an abort is expected (the user moved the
 * slider again, the component unmounted) and must stay silent; a timeout or a
 * network error is a real failure and must replace the spinner. Classifying
 * `timeout` as "aborted" is what once left the card stuck on
 * "resolving shadows…".
 */
import { isAbortError, ShadowDataError } from "./buildings";

export interface ShadowErrorOutcome {
  /** Expected interruption: leave the UI alone. */
  ignore: boolean;
  /** Panel message when `ignore` is false. */
  message: string | null;
}

export const SHADOW_TIMEOUT_MESSAGE =
  "Shadow data timed out — check the connection and try again.";

export function shadowErrorOutcome(error: unknown): ShadowErrorOutcome {
  if (isAbortError(error)) return { ignore: true, message: null };
  if (error instanceof ShadowDataError) {
    switch (error.code) {
      case "timeout":
        return { ignore: false, message: SHADOW_TIMEOUT_MESSAGE };
      case "network":
        return { ignore: false, message: "Building tiles are not reachable." };
      case "http":
        return { ignore: false, message: "Building tiles returned an error." };
      case "decode":
        return { ignore: false, message: "Building tiles could not be decoded." };
      case "empty":
        return { ignore: false, message: "No building data for this view." };
      default:
        return { ignore: true, message: null };
    }
  }
  const message =
    error instanceof Error && error.message ? error.message : "Shadow render failed.";
  return { ignore: false, message };
}
