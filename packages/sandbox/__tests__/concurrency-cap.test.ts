// Per-process worker-spawn cap. The host queues calls that exceed
// the cap and serves them as slots free. Tests the cap honors size 1
// (strict serialization) and Infinity (unbounded).

import { afterEach, describe, expect, it } from "vitest";
import { setMaxConcurrentWorkers } from "../src/host.js";
import { runInSandbox } from "../src/index.js";

const TRIVIAL = [
  {
    path: "src/main.ts",
    source: [
      'import { createModule, createSystem, t } from "@directive-run/core";',
      'const m = createModule("noop", {',
      "  schema: { facts: { v: t.number() }, events: {} },",
      "  init: (f) => { f.v = 1; },",
      "});",
      "const system = createSystem({ module: m });",
      "system.start();",
      "await system.settle();",
      "system.destroy();",
    ].join("\n"),
  },
];

describe("sandbox host worker cap", () => {
  afterEach(() => {
    setMaxConcurrentWorkers(Number.POSITIVE_INFINITY);
  });

  it("serializes calls when cap is 1", async () => {
    const prev = setMaxConcurrentWorkers(1);
    expect(prev).toBeGreaterThan(0);
    const results = await Promise.all([
      runInSandbox({ files: TRIVIAL, timeoutMs: 4000 }),
      runInSandbox({ files: TRIVIAL, timeoutMs: 4000 }),
      runInSandbox({ files: TRIVIAL, timeoutMs: 4000 }),
    ]);
    for (const r of results) {
      expect(r.errors).toEqual([]);
      expect(r.timedOut).toBe(false);
    }
  });

  it("returns the previous cap from setMaxConcurrentWorkers", () => {
    const a = setMaxConcurrentWorkers(2);
    const b = setMaxConcurrentWorkers(8);
    expect(b).toBe(2);
    expect(typeof a).toBe("number");
  });

  it("ignores non-finite, non-Infinity values", () => {
    const before = setMaxConcurrentWorkers(4);
    const after = setMaxConcurrentWorkers(Number.NaN);
    expect(after).toBe(4);
    // Reset to a known value before checking — a Nan input should NOT
    // have mutated the cap, so the next call returns the previous
    // value we set (4).
    const reset = setMaxConcurrentWorkers(before);
    expect(reset).toBe(4);
  });

  it("aborted callers do not leak a worker slot", async () => {
    setMaxConcurrentWorkers(1);
    // First call holds the only slot.
    const first = runInSandbox({ files: TRIVIAL, timeoutMs: 4000 });
    // Second + third callers queue. Abort the second before the first
    // returns — without the AbortSignal plumbing, an aborted caller
    // would leave a phantom waiter that consumes a slot when the first
    // call releases, permanently saturating the pool.
    const aborter = new AbortController();
    const second = runInSandbox({
      files: TRIVIAL,
      timeoutMs: 4000,
      signal: aborter.signal,
    });
    aborter.abort();
    await expect(second).rejects.toThrow();
    // First completes; third should then proceed without being blocked
    // by the abandoned second.
    const firstResult = await first;
    expect(firstResult.errors).toEqual([]);
    const third = await runInSandbox({ files: TRIVIAL, timeoutMs: 4000 });
    expect(third.errors).toEqual([]);
  });

  it("acquireSlot rejects synchronously when given an already-aborted signal", async () => {
    setMaxConcurrentWorkers(1);
    // Hold the slot with a long-running call so the next one MUST queue.
    const blocker = runInSandbox({ files: TRIVIAL, timeoutMs: 4000 });
    const pre = new AbortController();
    pre.abort();
    await expect(
      runInSandbox({ files: TRIVIAL, timeoutMs: 4000, signal: pre.signal }),
    ).rejects.toThrow();
    await blocker;
  });

  it("post-acquisition signal abort terminates the running worker + frees the slot", async () => {
    setMaxConcurrentWorkers(1);
    // Long-running snippet — busy-loop close to the timeout so the
    // worker doesn't naturally finish before the abort fires.
    const LONG_RUNNING = [
      {
        path: "src/main.ts",
        source: [
          'import { createModule, createSystem, t } from "@directive-run/core";',
          'const m = createModule("noop", {',
          "  schema: { facts: { v: t.number() }, events: {} },",
          "  init: (f) => { f.v = 0; },",
          "});",
          "const system = createSystem({ module: m });",
          "system.start();",
          "// Busy loop until budget close — keeps the worker active.",
          "const end = Date.now() + 3500;",
          "while (Date.now() < end) { for (let i=0; i<1000; i++) {} }",
          "system.destroy();",
        ].join("\n"),
      },
    ];
    const aborter = new AbortController();
    const t0 = Date.now();
    const resultPromise = runInSandbox({
      files: LONG_RUNNING,
      timeoutMs: 4000,
      signal: aborter.signal,
    });
    // Abort after the worker has spawned + acquired the slot. Without
    // post-acquisition signal wiring this would hang for ~3.5s; with
    // it the worker is terminated immediately and the next acquire
    // sees the slot free.
    setTimeout(() => aborter.abort(), 100);
    // `runInSandbox` converts WorkerExecError into a SandboxResult
    // with the message in `errors[]` rather than rejecting outright.
    const result = await resultPromise;
    const aborted_at = Date.now();
    // Should have aborted well before the 3.5s busy-loop.
    expect(aborted_at - t0).toBeLessThan(2000);
    expect(result.errors.some((e) => /aborted/i.test(e))).toBe(true);
    // Slot freed: a fresh call should run immediately.
    const fresh = await runInSandbox({ files: TRIVIAL, timeoutMs: 4000 });
    expect(fresh.errors).toEqual([]);
  });
});
