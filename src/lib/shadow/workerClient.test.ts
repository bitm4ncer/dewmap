import { describe, expect, it } from "vitest";
import { ShadowWorkerClient } from "./workerClient";
import type { SerializedBuildings } from "./render";
import type { ShadowRenderRequest, ShadowWorkerResponse } from "./workerTask";

/**
 * Minimal Worker stand-in: records lifecycle calls and lets a test play the
 * worker side. `terminate()` is the property under test, not a no-op.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];
  static reset(): void {
    FakeWorker.instances = [];
  }
  onmessage: ((event: MessageEvent<ShadowWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted: ShadowRenderRequest[] = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: ShadowRenderRequest): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: ShadowWorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<ShadowWorkerResponse>);
  }

  fail(message: string): void {
    this.onerror?.({ message } as ErrorEvent);
  }
}

function client(): { client: ShadowWorkerClient; spawn: () => FakeWorker } {
  FakeWorker.reset();
  const instance = new ShadowWorkerClient(() => new FakeWorker() as unknown as Worker);
  return { client: instance, spawn: () => FakeWorker.instances[FakeWorker.instances.length - 1] };
}

const buildings: SerializedBuildings = {
  count: 1,
  heights: new Float32Array([10]),
  offsets: new Uint32Array([0, 3]),
  coords: new Float64Array([0, 0, 0.1, 0, 0.1, 0.1]),
  ids: [""],
};

const input = { bbox: [0, 0, 0.1, 0.1] as [number, number, number, number], timeMs: 0, resolutionM: 2, buildings };

const result = (id: number): ShadowWorkerResponse => ({
  type: "result",
  id,
  pngUrl: "data:image/png;base64,AA",
  bbox: [0, 0, 0.1, 0.1],
  width: 1,
  height: 1,
  resolutionM: 2,
  sun: {
    azimuthDeg: 180,
    elevationDeg: 20,
    elevationGeometricDeg: 20,
    declinationDeg: 0,
    hourAngleDeg: 0,
    equationOfTimeMin: 0,
  },
  stats: { buildingCount: 1, cells: 1, shadowFraction: 0, computeMs: 1, encodeMs: 1 },
});

describe("ShadowWorkerClient", () => {
  it("posts one request and resolves the matching response", async () => {
    const { client: workerClient, spawn } = client();
    const promise = workerClient.run(input);
    const worker = spawn();
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0].id).toBe(1);
    expect(workerClient.busy).toBe(true);
    worker.respond(result(1));
    await expect(promise).resolves.toMatchObject({ type: "result", id: 1 });
    expect(workerClient.busy).toBe(false);
  });

  it("ignores responses for an older request id", async () => {
    const { client: workerClient, spawn } = client();
    const promise = workerClient.run(input);
    const worker = spawn();
    worker.respond(result(999));
    expect(workerClient.busy).toBe(true);
    worker.respond(result(worker.posted[0].id));
    await expect(promise).resolves.toMatchObject({ id: 1 });
  });

  it("cancels a running render by terminating the worker", async () => {
    const { client: workerClient, spawn } = client();
    const promise = workerClient.run(input);
    const worker = spawn();
    workerClient.cancel();
    expect(worker.terminated).toBe(true);
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
    expect(workerClient.busy).toBe(false);
  });

  it("keeps an idle worker warm on cancel", async () => {
    const { client: workerClient, spawn } = client();
    const promise = workerClient.run(input);
    const worker = spawn();
    worker.respond(result(worker.posted[0].id));
    await promise;
    workerClient.cancel();
    expect(worker.terminated).toBe(false);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("terminate() always stops the worker, idle or not", async () => {
    const { client: workerClient, spawn } = client();
    const first = workerClient.run(input);
    const worker = spawn();
    worker.respond(result(worker.posted[0].id));
    await first;
    // The regression: an idle terminate used to leave the thread alive.
    workerClient.terminate();
    expect(worker.terminated).toBe(true);

    // Pending work rejects too, and the client can start over.
    const pending = workerClient.run(input);
    const next = FakeWorker.instances[FakeWorker.instances.length - 1];
    expect(next).not.toBe(worker);
    workerClient.terminate();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(next.terminated).toBe(true);

    const again = workerClient.run(input);
    const fresh = spawn();
    expect(FakeWorker.instances).toHaveLength(3);
    fresh.respond(result(fresh.posted[0].id));
    await expect(again).resolves.toMatchObject({ type: "result" });
  });

  it("times out and drops the worker instead of waiting forever", async () => {
    const { client: workerClient, spawn } = client();
    const promise = workerClient.run(input, 20);
    const worker = spawn();
    await expect(promise).rejects.toMatchObject({ code: "timeout" });
    expect(worker.terminated).toBe(true);
    expect(workerClient.busy).toBe(false);
  });

  it("discards a worker that reports an error", async () => {
    const { client: workerClient, spawn } = client();
    const promise = workerClient.run(input);
    const worker = spawn();
    worker.fail("boom");
    await expect(promise).rejects.toMatchObject({ code: "network" });
    expect(worker.terminated).toBe(true);

    const retry = workerClient.run(input);
    const next = spawn();
    expect(next).not.toBe(worker);
    next.respond(result(next.posted[0].id));
    await expect(retry).resolves.toMatchObject({ type: "result" });
  });

  it("rejects a superseded run when a new one starts", async () => {
    const { client: workerClient, spawn } = client();
    const first = workerClient.run(input);
    spawn();
    const second = workerClient.run(input);
    await expect(first).rejects.toMatchObject({ code: "aborted" });
    const worker = spawn();
    worker.respond(result(worker.posted[0].id));
    await expect(second).resolves.toMatchObject({ type: "result" });
  });
});
