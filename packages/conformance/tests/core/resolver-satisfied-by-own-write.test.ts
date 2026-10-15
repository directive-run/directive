// Ported from packages/core/src/core/__tests__/resolver-satisfied-by-own-write.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * A resolver run whose own write, and nothing else, retracted its
 * requirement has satisfied it. Rules, each one a reviewer repro:
 *
 * - Writes are attributed per run, not per definition: a keyed sibling's
 *   write never shields another run, and a batch never shields another
 *   batch of the same definition.
 * - If anything else also changed what the constraint reads in that pass,
 *   it is an ordinary retraction and the run is canceled.
 * - A satisfied run stays in flight: stop() and destroy() abort it, and
 *   settle() does not hang after stop().
 * - It is not retried if it throws afterwards.
 * - If the requirement comes back while it runs, the new dispatch
 *   supersedes it: it is aborted and its later writes are dropped.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it } from "vitest";

const flushMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

function tracker() {
  const log = { completed: 0, canceled: 0, errors: 0 };
  const plugin = {
    name: "track",
    onResolverComplete: () => {
      log.completed++;
    },
    onResolverCancel: () => {
      log.canceled++;
    },
    onResolverError: () => {
      log.errors++;
    },
  };

  return { log, plugin };
}

function single(options: { retry?: number; throwAfterWrite?: boolean }) {
  const { log, plugin } = tracker();
  const runs: Array<{ signal: AbortSignal; release: () => void }> = [];
  const mod = createModule("load", {
    schema: {
      facts: { go: t.boolean(), done: t.boolean(), result: t.string() },
      derivations: {},
      events: {},
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.go = false;
      facts.done = false;
      facts.result = "";
    },
    constraints: {
      load: {
        when: (facts: any) => facts.go && !facts.done,
        require: { type: "LOAD" },
      },
    },
    resolvers: {
      load: {
        requirement: "LOAD",
        retry: options.retry
          ? { attempts: options.retry, backoff: "none" }
          : undefined,
        resolve: async (_req: unknown, context: any) => {
          const run = { signal: context.signal, release: () => {} };
          runs.push(run);
          const n = runs.length;
          context.facts.done = true;
          if (options.throwAfterWrite) {
            throw new Error("after write");
          }
          await new Promise<void>((resolve) => {
            run.release = resolve;
          });
          context.facts.result = `run ${n}`;
        },
      },
    },
  });
  const system = createSystem({ module: mod, plugins: [plugin] });

  return { system, log, runs };
}

describe("a run that satisfied its own requirement", () => {
  it("completes, is not canceled, and stays in flight until it finishes", async () => {
    const h = single({});
    h.system.start();
    h.system.facts.go = true;
    await flushMacrotask();
    expect(h.runs[0]!.signal.aborted).toBe(false);
    expect(h.log.canceled).toBe(0);
    let settled = false;
    void h.system.settle(1000).then(() => {
      settled = true;
    });
    await flushMacrotask();
    expect(settled).toBe(false);
    h.runs[0]!.release();
    await flushMacrotask();
    expect(settled).toBe(true);
    expect(h.log).toEqual({ completed: 1, canceled: 0, errors: 0 });
    h.system.destroy();
  });

  it("is aborted by stop(), and settle() does not hang after it", async () => {
    const h = single({});
    h.system.start();
    h.system.facts.go = true;
    await flushMacrotask();
    h.system.stop();
    expect(h.runs[0]!.signal.aborted).toBe(true);
    await expect(h.system.settle(200)).resolves.toBeUndefined();
    h.system.destroy();
  });

  it("is aborted by destroy()", async () => {
    const h = single({});
    h.system.start();
    h.system.facts.go = true;
    await flushMacrotask();
    h.system.destroy();
    expect(h.runs[0]!.signal.aborted).toBe(true);
  });

  it("is not retried if it throws after satisfying", async () => {
    const h = single({ retry: 4, throwAfterWrite: true });
    h.system.start();
    h.system.facts.go = true;
    // Past the default retry delay (100 ms): the run is checked before the
    // next attempt and stops there.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(h.runs).toHaveLength(1);
    expect(h.log.errors).toBe(1);
    h.system.destroy();
  });

  it("is superseded when the requirement returns: its late write is dropped", async () => {
    const h = single({});
    h.system.start();
    h.system.facts.go = true;
    await flushMacrotask();
    // The requirement comes back while run 1 is still going.
    h.system.facts.done = false;
    await flushMacrotask();
    expect(h.runs).toHaveLength(2);
    expect(h.runs[0]!.signal.aborted).toBe(true);
    h.runs[1]!.release();
    await flushMacrotask();
    expect(h.system.facts.result).toBe("run 2");
    h.runs[0]!.release();
    await flushMacrotask();
    expect(h.system.facts.result).toBe("run 2");
    h.system.destroy();
  });

  it("is canceled when something else also changed what the constraint reads", async () => {
    const { log, plugin } = tracker();
    let signal: AbortSignal | undefined;
    const mod = createModule("load", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.go = false;
        facts.done = false;
      },
      constraints: {
        load: {
          when: (facts: any) => facts.go && !facts.done,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_req: unknown, context: any) => {
            signal = context.signal;
            await flushMacrotask();
            context.facts.done = true;
            // Someone else turns it off in the same synchronous run.
            system.facts.go = false;
            await flushMacrotask();
          },
        },
      },
    });
    const system: any = createSystem({ module: mod, plugins: [plugin] });
    system.start();
    system.facts.go = true;
    for (let i = 0; i < 4; i++) {
      await flushMacrotask();
    }
    expect(signal!.aborted).toBe(true);
    expect(log.canceled).toBe(1);
    system.destroy();
  });
});

describe("attribution is per run", () => {
  it("a keyed sibling's write does not shield a run the user canceled", async () => {
    const gates: Record<string, () => void> = {};
    const signals: Record<string, AbortSignal> = {};
    const mod = createModule("keyed", {
      schema: {
        facts: {
          want: t.object<Record<string, boolean>>(),
          results: t.object<Record<string, string>>(),
        },
        derivations: {},
        events: {},
        requirements: { LOAD: { id: t.string() } },
      },
      init: (facts: any) => {
        facts.want = {};
        facts.results = {};
      },
      constraints: {
        load: {
          when: (facts: any) =>
            Object.keys(facts.want).some(
              (id) => facts.want[id] && !(id in facts.results),
            ),
          require: (facts: any) =>
            Object.keys(facts.want)
              .filter((id) => facts.want[id] && !(id in facts.results))
              .map((id) => ({ type: "LOAD" as const, id })),
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          key: (req: any) => `load-${req.id}`,
          resolve: async (req: any, context: any) => {
            signals[req.id] = context.signal;
            await new Promise<void>((resolve) => {
              gates[req.id] = resolve;
            });
            if (context.signal.aborted) {
              return;
            }
            context.facts.results = {
              ...context.facts.results,
              [req.id]: "done",
            };
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod }) as any;
    system.start();
    system.facts.want = { a: true, b: true };
    await flushMacrotask();
    expect(Object.keys(signals).sort()).toEqual(["a", "b"]);
    // In one synchronous run: a's write lands, and the user withdraws b.
    gates.a!();
    await Promise.resolve();
    system.facts.want = { a: true, b: false };
    await flushMacrotask();

    // b was withdrawn: canceled, never shielded by a's write. (a is canceled
    // too: the user's write changed what the constraint reads in the same
    // pass, so a's write was not the only change.)
    expect(signals.b!.aborted).toBe(true);
    gates.b!();
    await flushMacrotask();
    expect(system.facts.results.b).toBeUndefined();
    system.destroy();
  });

  it("one batch's write does not shield another batch of the same definition", async () => {
    const signals: AbortSignal[] = [];
    const gates: Array<() => void> = [];
    const mod = createModule("batch", {
      schema: {
        facts: {
          want: t.object<Record<string, boolean>>(),
          done: t.object<Record<string, boolean>>(),
        },
        derivations: {},
        events: {},
        requirements: { LOAD: { id: t.string() } },
      },
      init: (facts: any) => {
        facts.want = {};
        facts.done = {};
      },
      constraints: {
        load: {
          when: (facts: any) =>
            Object.keys(facts.want).some(
              (id) => facts.want[id] && !facts.done[id],
            ),
          require: (facts: any) =>
            Object.keys(facts.want)
              .filter((id) => facts.want[id] && !facts.done[id])
              .map((id) => ({ type: "LOAD" as const, id })),
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          batch: { enabled: true, windowMs: 0 },
          resolveBatch: async (reqs: any[], context: any) => {
            signals.push(context.signal);
            await new Promise<void>((resolve) => gates.push(resolve));
            if (context.signal.aborted) {
              return;
            }
            const done = { ...context.facts.done };
            for (const r of reqs) {
              done[r.id] = true;
            }
            context.facts.done = done;
          },
        },
      },
    } as never);
    const system = createSystem({ module: mod }) as any;
    system.start();
    system.facts.want = { a: true };
    await flushMacrotask();
    await flushMacrotask();
    system.facts.want = { a: true, b: true };
    await flushMacrotask();
    await flushMacrotask();
    expect(signals).toHaveLength(2);
    // Batch 1 (a) writes while the user withdraws b in the same run.
    gates[0]!();
    await Promise.resolve();
    system.facts.want = { a: true, b: false };
    await flushMacrotask();

    expect(signals[1]!.aborted).toBe(true);
    gates[1]!();
    await flushMacrotask();
    system.destroy();
  });
});
