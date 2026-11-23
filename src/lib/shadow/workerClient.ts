/**
 * Main-thread side of the shadow worker.
 *
 * One worker, one run at a time. A new request while a run is in flight
 * terminates the worker and starts a fresh one: the ray-march is a synchronous
 * loop, so a queued "cancel" message would be read only after the very work it
 * was meant to stop. Terminating is the honest abort, and it is cheap (the
 * worker reloads its module once per burst, not per frame).
 */
import { ShadowDataError } from "./buildings";
import type { ShadowRenderRequest, ShadowWorkerResponse } from "./workerTask";

export interface ShadowRunInput {
  bbox: ShadowRenderRequest["bbox"];
  timeMs: number;
  resolutionM: number;
  buildings: ShadowRenderRequest["buildings"];
}

export type ShadowWorkerFactory = () => Worker;

function defaultFactory(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

export class ShadowWorkerClient {
  private worker: Worker | null = null;
  private pending: {
    id: number;
    resolve: (response: ShadowWorkerResponse) => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private nextId = 1;

  constructor(private readonly createWorker: ShadowWorkerFactory = defaultFactory) {}

  /** True while a render is in flight. */
  get busy(): boolean {
    return this.pending !== null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<ShadowWorkerResponse>) => {
      const response = event.data;
      if (!this.pending || !response || response.id !== this.pending.id) return;
      const { resolve, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      resolve(response);
    };
    worker.onerror = (event) => {
      this.fail(new ShadowDataError("network", event.message || "worker error"));
    };
    this.worker = worker;
    return worker;
  }

  private fail(error: unknown): void {
    if (!this.pending) return;
    const { reject, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);
    reject(error);
  }

  private teardown(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Drop the current run. A running worker is terminated (it cannot observe a
   * cancel mid-march); an idle worker is kept warm, because re-creating it per
   * slider step costs more than the step itself.
   */
  cancel(): void {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    this.teardown();
    clearTimeout(pending.timer);
    pending.reject(new ShadowDataError("aborted", "aborted"));
  }

  terminate(): void {
    this.cancel();
  }

  /**
   * Render one viewport. Rejects with a `ShadowDataError`; aborted runs are
   * expected whenever the slider moves again before the result arrives.
   */
  run(input: ShadowRunInput, timeoutMs = 12_000): Promise<ShadowWorkerResponse> {
    if (this.pending) this.cancel();
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<ShadowWorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending;
        this.pending = null;
        // The worker is still marching; it will never answer a cancel, so it
        // has to go.
        this.teardown();
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(new ShadowDataError("timeout", `no result after ${timeoutMs} ms`));
        }
      }, timeoutMs);
      this.pending = { id, resolve, reject, timer };
      const request: ShadowRenderRequest = {
        type: "render",
        id,
        bbox: input.bbox,
        timeMs: input.timeMs,
        resolutionM: input.resolutionM,
        buildings: input.buildings,
      };
      try {
        worker.postMessage(request, [
          input.buildings.heights.buffer,
          input.buildings.offsets.buffer,
          input.buildings.coords.buffer,
        ]);
      } catch (error) {
        this.fail(error);
      }
    });
  }
}
