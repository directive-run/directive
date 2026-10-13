/**
 * Resolver outcomes, from the round-4 review:
 *
 * - A batch that satisfied its requirement is superseded when the
 *   requirement returns: the new batch owns it, the old one is aborted and
 *   its late write dropped.
 * - Runs whose requirements disappear in the same pass own that pass's
 *   changes jointly: keyed runs each writing their own entry of one shared
 *   fact are all satisfied.
 * - Every run reports exactly one of complete / cancel / error.
 * - A satisfied run that times out reports one error (not "unmet"), is
 *   aborted, and its late write is dropped.
 */

import { describe, expect, it } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const flushMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

describe("resolver outcomes", () => {
  it("a batch that satisfied its requirement is superseded when it returns", async () => {
    const { log, plugin } = tracker();
    const gates: Array<() => void> = [];
    const signals: AbortSignal[] = [];
    let n = 0;
    const mod = createModule("batch", {
      schema: {
        facts: { want: t.boolean(), done: t.boolean(), result: t.string() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.want = false;
        facts.done = false;
        facts.result = "";
      },
      constraints: {
        load: {
          when: (facts: any) => facts.want && !facts.done,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          batch: { enabled: true, windowMs: 0 },
          resolveBatch: async (_reqs: any[], context: any) => {
            const k = ++n;
            signals.push(context.signal);
            context.facts.done = true;
            await new Promise<void>((resolve) => gates.push(resolve));
            context.facts.result = `batch ${k}`;
          },
        },
      },
    } as never);
    const system: any = createSystem({ module: mod, plugins: [plugin] });
    system.start();
    system.facts.want = true;
    await flushMacrotask();
    await flushMacrotask();
    expect(log.canceled).toBe(0);
    system.facts.done = false; // the requirement returns
    await flushMacrotask();
    await flushMacrotask();
    expect(n).toBe(2);
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
    gates[1]!(); // the new batch finishes first
    await flushMacrotask();
    gates[0]!(); // the old one late: its write is dropped
    await flushMacrotask();
    expect(system.facts.result).toBe("batch 2");
    expect(system.facts.done).toBe(true);
    system.destroy();
  });

  it("keyed runs that each write their own entry in one pass are both satisfied", async () => {
    const { log, plugin } = tracker();
    const gates: Record<string, () => void> = {};
    const after: Record<string, () => void> = {};
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
            context.facts.results = {
              ...context.facts.results,
              [req.id]: "done",
            };
            await new Promise<void>((resolve) => {
              after[req.id] = resolve;
            });
          },
        },
      },
    } as never);
    const system: any = createSystem({ module: mod, plugins: [plugin] });
    system.start();
    system.facts.want = { a: true, b: true };
    await flushMacrotask();
    gates.a!();
    gates.b!();
    await flushMacrotask();
    expect(signals.a!.aborted).toBe(false);
    expect(signals.b!.aborted).toBe(false);
    after.a!();
    after.b!();
    await flushMacrotask();
    expect(log).toEqual({ completed: 2, canceled: 0, errors: 0 });
    expect(system.facts.results).toEqual({ a: "done", b: "done" });
    system.destroy();
  });

  it("a canceled run that returns normally reports only the cancel", async () => {
    const { log, plugin } = tracker();
    let release: () => void = () => {};
    const mod = createModule("load", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.go = false;
      },
      constraints: {
        load: { when: (facts: any) => facts.go, require: { type: "LOAD" } },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async () => {
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          },
        },
      },
    });
    const system: any = createSystem({ module: mod, plugins: [plugin] });
    system.start();
    system.facts.go = true;
    await flushMacrotask();
    system.facts.go = false;
    await flushMacrotask();
    release();
    await flushMacrotask();
    expect(log).toEqual({ completed: 0, canceled: 1, errors: 0 });
    system.destroy();
  });

  it("a satisfied run that times out reports one error, not unmet, and its late write still lands", async () => {
    const { log, plugin } = tracker();
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    let signal: AbortSignal | undefined;
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
          timeout: 30,
          resolve: async (_req: unknown, context: any) => {
            signal = context.signal;
            context.facts.done = true;
            await sleep(100);
            context.facts.result = "late";
          },
        },
      },
    });
    const system: any = createSystem({ module: mod, plugins: [plugin] });
    try {
      system.start();
      system.facts.go = true;
      await sleep(150);
      expect(log).toEqual({ completed: 0, canceled: 0, errors: 1 });
      expect(signal!.aborted).toBe(true);
      // Like a cancel (RFC 0003): the signal aborts, the write lands.
      expect(system.facts.result).toBe("late");
      expect(warnings.some((w) => w.includes("stays unmet"))).toBe(false);
    } finally {
      console.warn = warn;
      system.destroy();
    }
  });
});
