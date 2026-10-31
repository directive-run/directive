import { describe, expect, it } from "vitest";
import {
  type SystemPart,
  createModule,
  createSystemCore,
} from "../api/core.js";
import { withPlugins } from "../api/plugins.js";
import { withReconcile } from "../api/reconcile.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import {
  completeTimer,
  elapsedMs,
  initialTimerState,
  pauseTimer,
  startTimer,
} from "../api/timer.js";
import { type KernelEvent, serializeEvent } from "../kernel.js";

const counter = () =>
  createModule("c", {
    schema: { facts: { n: t.number() } },
    init: (f: any) => {
      f.n = 0;
    },
  });

/** Records the kind of every record a system builds, and keeps the records. */
function recorder() {
  const built: KernelEvent[] = [];
  const part: SystemPart = ({ kernel }) => {
    const emit = kernel.hooks.emit;
    kernel.hooks.emit = (at, data) => {
      built.push({ ...data, t: 0, seq: 0, sys: 0, at });
      emit(at, data);
    };
  };

  return { built, part, kinds: () => built.map((e) => e.at) };
}

describe("P1 and P2: hooks are read when called, a replacement runs last", () => {
  it("fires a hook added after register, and stops one deleted", async () => {
    const seen: unknown[] = [];
    const plugin: Record<string, unknown> = { name: "late" };
    const sys: any = createSystem({
      module: counter(),
      plugins: [plugin as never],
    });
    sys.start();
    sys.facts.n = 1;
    plugin.onFactSet = (key: string, value: unknown) => seen.push([key, value]);
    sys.facts.n = 2;
    delete plugin.onFactSet;
    sys.facts.n = 3;
    await sys.settle();
    expect(seen).toEqual([["n", 2]]);
    sys.destroy();
  });

  it("moves a plugin replaced by a duplicate name to the end of the order", () => {
    const order: string[] = [];
    const hook = (tag: string) => ({ onFactSet: () => order.push(tag) });
    const warn = console.warn;
    console.warn = () => {};
    let sys: any;
    try {
      sys = createSystem({
        module: counter(),
        plugins: [
          { name: "a", ...hook("a1") },
          { name: "b", ...hook("b") },
          { name: "a", ...hook("a2") },
        ],
      });
    } finally {
      console.warn = warn;
    }
    sys.start();
    sys.facts.n = 1;
    expect(order).toEqual(["b", "a2"]);
    sys.destroy();
  });
});

describe("P3: a record is built only when something will read it", () => {
  it("builds no fact.set record for a plugin with only onError, until it gains onFactSet", () => {
    const rec = recorder();
    const plugin: Record<string, unknown> = { name: "e", onError: () => {} };
    const heard: unknown[][] = [];
    const sys: any = createSystemCore({ module: counter() }, [
      rec.part,
      withPlugins([plugin as never]),
    ]);
    sys.start();
    sys.facts.n = 1;
    sys.batch(() => {
      sys.facts.n = 2;
    });
    expect(rec.kinds()).not.toContain("fact.set");
    expect(rec.kinds()).not.toContain("fact.batch");
    plugin.onFactSet = (...args: unknown[]) => heard.push(args);
    sys.facts.n = 3;
    expect(rec.kinds().filter((k) => k === "fact.set")).toHaveLength(1);
    expect(heard).toEqual([["n", 3, 2]]);
    sys.destroy();
  });

  it("builds nothing per write with no plugin and no listener", () => {
    const rec = recorder();
    const sys: any = createSystemCore({ module: counter() }, [
      rec.part,
      withPlugins(),
    ]);
    sys.start();
    rec.built.length = 0;
    sys.facts.n = 1;
    sys.facts.n = 2;
    expect(rec.built).toEqual([]);
    sys.destroy();
  });
});

describe("records: the v1 fields stay out of what hosts see", () => {
  it("stamps a resolver's write with `by`; the hooks' arguments are unchanged", async () => {
    const rec = recorder();
    const args: unknown[][] = [];
    const mod = createModule("r", {
      schema: { facts: { n: t.number(), done: t.boolean() } },
      init: (f: any) => {
        f.n = 0;
        f.done = false;
      },
      constraints: {
        go: { when: (f: any) => !f.done, require: { type: "GO" } },
      },
      resolvers: {
        r: {
          requirement: "GO",
          resolve: async (_req: any, ctx: any) => {
            ctx.facts.done = true;
          },
        },
      },
    } as never);
    const batches: unknown[][] = [];
    const sys: any = createSystemCore({ module: mod }, [
      rec.part,
      withReconcile,
      withPlugins([
        {
          name: "p",
          onFactSet: (...a: unknown[]) => args.push(a),
          onFactsBatch: (...a: unknown[]) => batches.push(a),
        },
      ]),
    ]);
    sys.start();
    sys.facts.n = 1;
    await sys.settle();
    const plain = rec.built.find((e) => e.at === "fact.set" && e.key === "n")!;
    // The run's synchronous start is batched: its write is a stamped batch.
    const resolved = rec.built.find(
      (e) =>
        e.at === "fact.batch" &&
        (e.changes as { key: string; value: unknown }[]).some(
          (c) => c.key === "done" && c.value === true,
        ),
    )!;
    expect("by" in plain).toBe(false);
    expect(resolved.by).toBeGreaterThan(0);
    expect(args).toEqual([["n", 1, 0]]);
    const heard = batches.find((a) =>
      (a[0] as { key: string; value: unknown }[]).some(
        (c) => c.key === "done" && c.value === true,
      ),
    )!;
    expect(heard).toHaveLength(1);
    expect(Object.keys((heard[0] as object[])[0]!).sort()).toEqual([
      "key",
      "origin",
      "prev",
      "type",
      "value",
    ]);
    expect(JSON.parse(serializeEvent(resolved))).toMatchObject({
      v: 1,
      at: "fact.batch",
      by: resolved.by,
    });
    sys.destroy();
  });

  it("gives an error record its code, phase, node and cause; onError still gets the error alone", () => {
    const rec = recorder();
    const heard: unknown[][] = [];
    const thrown = new Error("boom");
    const mod = createModule("d", {
      schema: { facts: { n: t.number() }, derivations: { bad: t.number() } },
      init: (f: any) => {
        f.n = 0;
      },
      derive: {
        bad: () => {
          throw thrown;
        },
      },
    } as never);
    const sys: any = createSystemCore({ module: mod }, [
      rec.part,
      withPlugins([{ name: "p", onError: (...a: unknown[]) => heard.push(a) }]),
    ]);
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(() => sys.derive.bad).toThrow("boom");
    } finally {
      console.warn = warn;
    }
    const error = rec.built.find((e) => e.at === "error")!;
    expect(error).toMatchObject({
      code: "E_DERIVATION",
      phase: "derivation",
      nodeId: "bad",
      cause: thrown,
    });
    expect(heard).toHaveLength(1);
    expect(heard[0]).toHaveLength(1);
    sys.destroy();
  });
});

describe("timers: quirk (f) only", () => {
  it("(f) a timer completed while paused stops counting", () => {
    const paused = pauseTimer(startTimer(initialTimerState(), 0), 100);
    const done = completeTimer(paused);
    expect(done.pausedAtMs).toBe(100);
    expect(elapsedMs(done, 500)).toBe(100);
  });

  it("(u) not approved: a timer completed while running keeps counting, as 1.35", () => {
    const done = completeTimer(startTimer(initialTimerState(), 0));
    expect(elapsedMs(done, 500)).toBe(500);
  });

  it("(q) approved: startTimer on a completed timer returns it unchanged (1.35 starts it again)", () => {
    const done = completeTimer(startTimer(initialTimerState(), 0));
    const again = startTimer(done, 300);
    expect(again).toBe(done);
    expect(again.status).toBe("completed");
    expect(again.startedAtMs).toBe(0);
    // reset() first, as its doc says, and it starts.
    const fresh = startTimer(initialTimerState(), 300);
    expect(fresh.status).toBe("running");
    expect(fresh.startedAtMs).toBe(300);
  });
});

describe("(n) approved: a timeout aborts the attempt's signal", () => {
  it("aborts context.signal, with the timeout error as its reason, and still reports an error", async () => {
    let signal: AbortSignal | undefined;
    const errors: unknown[] = [];
    const mod = createModule("n", {
      schema: { facts: { go: t.boolean() } },
      init: (f: any) => {
        f.go = true;
      },
      constraints: {
        c: { when: (f: any) => f.go, require: { type: "SLOW" } },
      },
      resolvers: {
        r: {
          requirement: "SLOW",
          timeout: 10,
          resolve: (_req: any, ctx: any) => {
            signal = ctx.signal;

            return new Promise(() => {});
          },
        },
      },
    } as never);
    const sys: any = createSystem({
      module: mod,
      plugins: [
        {
          name: "p",
          onResolverError: (_r: string, _q: unknown, e: unknown) =>
            errors.push(e),
        },
      ],
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      sys.start();
      await new Promise((r) => setTimeout(r, 60));
    } finally {
      console.warn = warn;
    }
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/timed out/);
    // 1.35 leaves the signal clean, so the body's work keeps going.
    expect(signal?.aborted).toBe(true);
    expect(String(signal?.reason)).toMatch(/timed out after 10ms/);
    sys.destroy();
  });
});
