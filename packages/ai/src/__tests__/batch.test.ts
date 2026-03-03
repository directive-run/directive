import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBatchQueue } from "../batch.js";
import type { AgentLike, AgentRunner, RunResult } from "../types.js";

// ============================================================================
// Helpers
// ============================================================================

function mockAgent(name = "test-agent") {
  return { name, instructions: "Be helpful." };
}

function successResult(output = "hello"): RunResult {
  return {
    output,
    messages: [{ role: "assistant", content: output }],
    toolCalls: [],
    totalTokens: 10,
    tokenUsage: { inputTokens: 5, outputTokens: 5 },
  };
}

function makeRunner(): AgentRunner {
  return vi.fn(async (_agent: AgentLike, input: string) => {
    return { ...successResult(), output: `echo:${input}` };
  }) as unknown as AgentRunner;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// createBatchQueue
// ============================================================================

describe("createBatchQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("submit resolves with result", async () => {
    const inner = makeRunner();
    const queue = createBatchQueue(inner, { maxBatchSize: 5, maxWaitMs: 100 });

    const promise = queue.submit(mockAgent(), "hello");
    vi.advanceTimersByTime(100);
    const result = await promise;

    expect(result.output).toBe("echo:hello");
    await queue.dispose();
  });

  it("flushes when batch is full", async () => {
    const inner = makeRunner();
    const queue = createBatchQueue(inner, {
      maxBatchSize: 2,
      maxWaitMs: 60000,
    });

    const p1 = queue.submit(mockAgent(), "a");
    const p2 = queue.submit(mockAgent(), "b"); // triggers flush at maxBatchSize=2

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.output).toBe("echo:a");
    expect(r2.output).toBe("echo:b");
    expect(inner).toHaveBeenCalledTimes(2);
    await queue.dispose();
  });

  it("flushes on timer when batch is not full", async () => {
    const inner = makeRunner();
    const queue = createBatchQueue(inner, { maxBatchSize: 100, maxWaitMs: 50 });

    const promise = queue.submit(mockAgent(), "hello");
    expect(queue.pending).toBe(1);

    vi.advanceTimersByTime(50);
    const result = await promise;

    expect(result.output).toBe("echo:hello");
    expect(queue.pending).toBe(0);
    await queue.dispose();
  });

  it("manual flush processes pending calls", async () => {
    vi.useRealTimers(); // flush is sync-ish
    const inner = makeRunner();
    const queue = createBatchQueue(inner, {
      maxBatchSize: 100,
      maxWaitMs: 60000,
    });

    const p1 = queue.submit(mockAgent(), "a");
    const p2 = queue.submit(mockAgent(), "b");

    await queue.flush();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.output).toBe("echo:a");
    expect(r2.output).toBe("echo:b");
    await queue.dispose();
  });

  it("respects concurrency limit", async () => {
    vi.useRealTimers();
    let concurrent = 0;
    let maxConcurrent = 0;

    const inner = vi.fn(async (_agent: AgentLike, input: string) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(10);
      concurrent--;

      return { ...successResult(), output: `echo:${input}` };
    }) as unknown as AgentRunner;

    const queue = createBatchQueue(inner, {
      maxBatchSize: 10,
      maxWaitMs: 10,
      concurrency: 2,
    });

    const promises = Array.from({ length: 5 }, (_, i) =>
      queue.submit(mockAgent(), `item-${i}`),
    );

    await queue.flush();
    await Promise.all(promises);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(inner).toHaveBeenCalledTimes(5);
    await queue.dispose();
  });

  it("individual call errors are delivered to that call's promise", async () => {
    let callCount = 0;
    const inner = vi.fn(async () => {
      callCount++;
      if (callCount === 2) {
        throw new Error("call 2 failed");
      }

      return successResult();
    }) as unknown as AgentRunner;

    const queue = createBatchQueue(inner, { maxBatchSize: 3, maxWaitMs: 100 });

    const p1 = queue.submit(mockAgent(), "a");
    const p2 = queue.submit(mockAgent(), "b");
    const p3 = queue.submit(mockAgent(), "c");

    vi.advanceTimersByTime(100);

    const r1 = await p1;
    expect(r1.output).toBe("hello");

    await expect(p2).rejects.toThrow("call 2 failed");

    const r3 = await p3;
    expect(r3.output).toBe("hello");

    await queue.dispose();
  });

  it("dispose flushes remaining calls", async () => {
    vi.useRealTimers();
    const inner = makeRunner();
    const queue = createBatchQueue(inner, {
      maxBatchSize: 100,
      maxWaitMs: 60000,
    });

    const promise = queue.submit(mockAgent(), "hello");
    await queue.dispose();

    const result = await promise;
    expect(result.output).toBe("echo:hello");
  });

  it("rejects submissions after dispose", async () => {
    vi.useRealTimers();
    const inner = makeRunner();
    const queue = createBatchQueue(inner, {
      maxBatchSize: 100,
      maxWaitMs: 100,
    });
    await queue.dispose();

    await expect(queue.submit(mockAgent(), "hello")).rejects.toThrow(
      "disposed",
    );
  });

  it("pending count tracks queue size", async () => {
    vi.useRealTimers();
    const inner = makeRunner();
    const queue = createBatchQueue(inner, {
      maxBatchSize: 100,
      maxWaitMs: 60000,
    });

    expect(queue.pending).toBe(0);
    queue.submit(mockAgent(), "a");
    expect(queue.pending).toBe(1);
    queue.submit(mockAgent(), "b");
    expect(queue.pending).toBe(2);

    await queue.flush();
    expect(queue.pending).toBe(0);
    await queue.dispose();
  });
});

// ============================================================================
// Config Validation (C1)
// ============================================================================

describe("createBatchQueue config validation", () => {
  it("throws on zero maxBatchSize", () => {
    const inner = makeRunner();
    expect(() => createBatchQueue(inner, { maxBatchSize: 0 })).toThrow(
      "maxBatchSize must be a positive finite number",
    );
  });

  it("throws on negative maxBatchSize", () => {
    const inner = makeRunner();
    expect(() => createBatchQueue(inner, { maxBatchSize: -1 })).toThrow(
      "maxBatchSize must be a positive finite number",
    );
  });

  it("throws on NaN maxBatchSize", () => {
    const inner = makeRunner();
    expect(() => createBatchQueue(inner, { maxBatchSize: Number.NaN })).toThrow(
      "maxBatchSize must be a positive finite number",
    );
  });

  it("throws on negative maxWaitMs", () => {
    const inner = makeRunner();
    expect(() => createBatchQueue(inner, { maxWaitMs: -1 })).toThrow(
      "maxWaitMs must be a non-negative finite number",
    );
  });

  it("throws on zero concurrency", () => {
    const inner = makeRunner();
    expect(() => createBatchQueue(inner, { concurrency: 0 })).toThrow(
      "concurrency must be a positive finite number",
    );
  });

  it("throws on NaN concurrency", () => {
    const inner = makeRunner();
    expect(() => createBatchQueue(inner, { concurrency: Number.NaN })).toThrow(
      "concurrency must be a positive finite number",
    );
  });

  it("accepts maxWaitMs of 0", async () => {
    vi.useRealTimers();
    const inner = makeRunner();
    // Should not throw — 0 is valid (immediate flush on timer)
    const queue = createBatchQueue(inner, { maxWaitMs: 0 });
    await queue.dispose();
  });
});
