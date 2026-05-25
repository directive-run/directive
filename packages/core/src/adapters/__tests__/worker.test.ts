/**
 * Tests for the Web Worker adapter — R6 SECURITY fix:
 * unbounded `pendingRequests` Map must be reclaimed on timeout and on
 * worker error, with opt-out via `timeoutMs: 0 | Infinity`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerClient } from "../worker.js";
import type { WorkerOutboundMessage } from "../worker.js";

// ----------------------------------------------------------------------------
// Mock Worker
// ----------------------------------------------------------------------------

interface MockWorker {
  postMessage: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  onmessage: ((event: MessageEvent<WorkerOutboundMessage>) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  /** Test helper — simulate a message from worker → main thread */
  emit(message: WorkerOutboundMessage): void;
  /** Test helper — simulate a worker-level error */
  emitError(message: string): void;
}

function makeMockWorker(): MockWorker {
  const w: MockWorker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    emit(message) {
      w.onmessage?.({ data: message } as MessageEvent<WorkerOutboundMessage>);
    },
    emitError(message) {
      w.onerror?.({ message });
    },
  };
  return w;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("createWorkerClient — pending request hygiene", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a stalled request after the default 30s timeout", async () => {
    const worker = makeMockWorker();
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
    const client = createWorkerClient({ worker: worker as any });

    const promise = client.inspect();

    // Attach a sync catch so the rejection doesn't bubble as unhandled
    const caught = promise.catch((err) => err);

    // Advance just under the timeout — still pending
    await vi.advanceTimersByTimeAsync(29_999);

    // Now cross the threshold
    await vi.advanceTimersByTimeAsync(2);

    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(
      /worker request timed out after 30000ms/,
    );
  });

  it("does NOT time out when timeoutMs is 0 (opt-out)", async () => {
    const worker = makeMockWorker();
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
    const client = createWorkerClient({ worker: worker as any });

    let settled = false;
    const promise = client.inspect(0).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // Burn way past the default timeout
    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);

    // Cleanup: resolve the pending request via a fake response so the test
    // doesn't hang Promise resolution post-suite
    const lastCall = worker.postMessage.mock.calls.at(-1)?.[0] as {
      requestId: string;
    };
    worker.emit({
      type: "INSPECT_RESULT",
      requestId: lastCall.requestId,
      // biome-ignore lint/suspicious/noExplicitAny: minimal payload
      inspection: {} as any,
    });

    await promise;
    expect(settled).toBe(true);
  });

  it("does NOT time out when timeoutMs is Infinity (opt-out)", async () => {
    const worker = makeMockWorker();
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
    const client = createWorkerClient({ worker: worker as any });

    let settled = false;
    const promise = client
      .inspect(Number.POSITIVE_INFINITY)
      .then(() => {
        settled = true;
      })
      .catch(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(settled).toBe(false);

    const lastCall = worker.postMessage.mock.calls.at(-1)?.[0] as {
      requestId: string;
    };
    worker.emit({
      type: "INSPECT_RESULT",
      requestId: lastCall.requestId,
      // biome-ignore lint/suspicious/noExplicitAny: minimal payload
      inspection: {} as any,
    });

    await promise;
    expect(settled).toBe(true);
  });

  it("rejects all pending requests when worker.onerror fires", async () => {
    const worker = makeMockWorker();
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
    const client = createWorkerClient({ worker: worker as any });

    const a = client.inspect().catch((err) => err);
    const b = client.getSnapshot().catch((err) => err);
    const c = client.settle().catch((err) => err);

    worker.emitError("uncaught reference");

    const [errA, errB, errC] = await Promise.all([a, b, c]);
    for (const err of [errA, errB, errC]) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(
        /\[Directive\] worker errored: uncaught reference/,
      );
    }
  });

  it("clears the timeout when a response arrives in time (no leak)", async () => {
    const worker = makeMockWorker();
    // biome-ignore lint/suspicious/noExplicitAny: minimal mock
    const client = createWorkerClient({ worker: worker as any });

    const promise = client.inspect();
    const lastCall = worker.postMessage.mock.calls.at(-1)?.[0] as {
      requestId: string;
    };

    // Respond before the timeout fires
    worker.emit({
      type: "INSPECT_RESULT",
      requestId: lastCall.requestId,
      // biome-ignore lint/suspicious/noExplicitAny: minimal payload
      inspection: { fooState: "ok" } as any,
    });

    // Now advance past the default timeout — must NOT reject
    await vi.advanceTimersByTimeAsync(60_000);

    const result = await promise;
    expect(result).toBeDefined();
  });
});
