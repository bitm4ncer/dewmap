/**
 * Shadow worker shell.
 *
 * All logic lives in `workerTask.ts`; this file only wires `onmessage`. The
 * guard keeps a Node test import from touching `self`.
 */
/// <reference lib="webworker" />
import { encodeMaskPng } from "./png";
import { handleShadowRequest, type ShadowWorkerRequest } from "./workerTask";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ShadowWorkerRequest>) => void) | null;
  postMessage: (message: unknown) => void;
};

const inWorker =
  typeof self !== "undefined" &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === "function" &&
  typeof (self as unknown as { document?: unknown }).document === "undefined";

if (inWorker) {
  scope.onmessage = (event) => {
    void handleShadowRequest(event.data, encodeMaskPng)
      .then((response) => {
        if (response) scope.postMessage(response);
      })
      .catch((error) => {
        scope.postMessage({
          type: "error",
          id: typeof event.data?.id === "number" ? event.data.id : -1,
          code: "compute",
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };
}
