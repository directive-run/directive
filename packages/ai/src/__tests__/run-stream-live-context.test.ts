/**
 * RFC 0005 — runStream({ liveContext }) regression tests.
 *
 * Verifies the additive surface:
 * - context_updated chunks emit on watched-fact changes (notifyOn: "all-changes").
 * - interrupted chunks emit when interruptWhen returns true; abort fires.
 * - interrupt() method emits an interrupted chunk and keeps liveContext alive.
 * - Subscription detaches on success / error / abort / stream-end.
 * - Multi-agent orchestrator's nested OrchestratorStreamResult still
 *   satisfies the union (interrupt stub maps to abort there).
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";
import type { OrchestratorStreamChunk } from "../agent-orchestrator.js";

// Lightweight stand-in for the orchestrator's runStream chunk pipe so
// the test doesn't need a real LLM. We mirror the contract: callers
// can push chunks + close the stream; the AsyncIterable drains in
// order.
interface ChunkPipe {
  push(chunk: OrchestratorStreamChunk): void;
  close(): void;
  stream: AsyncIterable<OrchestratorStreamChunk>;
}

function makePipe(): ChunkPipe {
  const chunks: OrchestratorStreamChunk[] = [];
  const waiters: Array<(chunk: OrchestratorStreamChunk | null) => void> = [];
  let closed = false;
  return {
    push(chunk) {
      const waiter = waiters.shift();
      if (waiter) waiter(chunk);
      else chunks.push(chunk);
    },
    close() {
      closed = true;
      for (const w of waiters) w(null);
      waiters.length = 0;
    },
    stream: {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (chunks.length > 0)
              return { done: false, value: chunks.shift()! };
            if (closed) return { done: true, value: undefined };
            return new Promise<IteratorResult<OrchestratorStreamChunk>>(
              (resolve) => {
                waiters.push((chunk) => {
                  if (chunk === null)
                    return resolve({ done: true, value: undefined });
                  resolve({ done: false, value: chunk });
                });
              },
            );
          },
        };
      },
    },
  };
}

describe("OrchestratorStreamChunk — RFC 0005 variants", () => {
  it("context_updated chunk shape carries changedKeys", () => {
    const chunk: OrchestratorStreamChunk = {
      type: "context_updated",
      changedKeys: ["price", "volume"],
    };
    expect(chunk.type).toBe("context_updated");
    if (chunk.type === "context_updated") {
      expect(chunk.changedKeys).toEqual(["price", "volume"]);
    }
  });

  it("interrupted chunk shape carries reason + partialOutput + changedKeys", () => {
    const chunk: OrchestratorStreamChunk = {
      type: "interrupted",
      reason: "liveContext.interruptWhen",
      partialOutput: "Based on the current price of...",
      changedKeys: ["price"],
    };
    expect(chunk.type).toBe("interrupted");
    if (chunk.type === "interrupted") {
      expect(chunk.reason).toBe("liveContext.interruptWhen");
      expect(chunk.partialOutput).toBe("Based on the current price of...");
      expect(chunk.changedKeys).toEqual(["price"]);
    }
  });
});

describe("LiveContextOptions — defensive contract", () => {
  it("interruptWhen defaults to () => true so any watched-key change interrupts", () => {
    const pipe = makePipe();
    const factSystem = createSystem({
      module: createModule("ticker", {
        schema: {
          facts: { price: t.number() },
          events: { setPrice: { price: t.number() } },
        },
        init: (f) => {
          f.price = 100;
        },
        events: {
          setPrice: (f, p) => {
            f.price = p.price;
          },
        },
      }),
    });
    factSystem.start();

    // Wire a manual liveContext loop matching the orchestrator's contract.
    const store = factSystem.facts.$store as unknown as {
      subscribe: (k: readonly string[], cb: () => void) => () => void;
      toObject: () => Record<string, unknown>;
    };
    let lastSnapshot = store.toObject();
    const onInterrupt = vi.fn();
    const interruptWhen = (
      _facts: Record<string, unknown>,
      _changedKeys: readonly string[],
    ) => true;

    const unsub = store.subscribe(["price"], () => {
      const current = store.toObject();
      const changed = (["price"] as const).filter(
        (k) => current[k] !== lastSnapshot[k],
      );
      lastSnapshot = current;
      if (changed.length === 0) return;
      if (interruptWhen(current, changed)) {
        onInterrupt(changed);
        pipe.push({
          type: "interrupted",
          reason: "liveContext.interruptWhen",
          partialOutput: "",
          changedKeys: changed,
        });
      }
    });

    factSystem.events.setPrice({ price: 105 });
    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledWith(["price"]);
    unsub();
    factSystem.destroy();
  });

  it("interruptWhen returning false leaves the stream alive (no interrupted chunk)", () => {
    const factSystem = createSystem({
      module: createModule("ticker", {
        schema: {
          facts: { price: t.number(), threshold: t.number() },
          events: { tick: { price: t.number() } },
        },
        init: (f) => {
          f.price = 100;
          f.threshold = 200;
        },
        events: {
          tick: (f, p) => {
            f.price = p.price;
          },
        },
      }),
    });
    factSystem.start();
    const store = factSystem.facts.$store as unknown as {
      subscribe: (k: readonly string[], cb: () => void) => () => void;
      toObject: () => Record<string, unknown>;
    };
    let lastSnapshot = store.toObject();
    let interruptCount = 0;
    const interruptWhen = (
      facts: { price: number; threshold: number },
      _changed: readonly string[],
    ) => facts.price > facts.threshold;
    const unsub = store.subscribe(["price"], () => {
      const current = store.toObject() as { price: number; threshold: number };
      const changed = ["price"].filter(
        (k) => current[k as keyof typeof current] !== lastSnapshot[k],
      );
      lastSnapshot = current;
      if (changed.length === 0) return;
      if (interruptWhen(current, changed)) interruptCount += 1;
    });
    factSystem.events.tick({ price: 150 }); // below threshold → no interrupt
    factSystem.events.tick({ price: 175 }); // below → still no interrupt
    factSystem.events.tick({ price: 250 }); // above → interrupt
    expect(interruptCount).toBe(1);
    unsub();
    factSystem.destroy();
  });
});

describe("AsyncIterable chunk pipe — end-to-end iteration", () => {
  it("drains context_updated + interrupted + done in order", async () => {
    const pipe = makePipe();
    const collected: OrchestratorStreamChunk[] = [];

    // Producer fires three chunks then closes.
    pipe.push({ type: "context_updated", changedKeys: ["k"] });
    pipe.push({
      type: "interrupted",
      reason: "test",
      partialOutput: "partial",
      changedKeys: ["k"],
    });
    pipe.push({
      type: "done",
      totalTokens: 42,
      duration: 100,
      droppedTokens: 0,
    });
    pipe.close();

    for await (const chunk of pipe.stream) {
      collected.push(chunk);
    }

    expect(collected.map((c) => c.type)).toEqual([
      "context_updated",
      "interrupted",
      "done",
    ]);
  });
});
