import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectiveError, createModule, createSystemCore } from "../api/core.js";
import { withErrorBoundary } from "../api/errors.js";
import { withPlugins } from "../api/plugins.js";
import { withReconcile } from "../api/reconcile.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { createClock } from "../clock.js";

// L3b: the error boundary. "throw" keeps 1.35's surfaces per source (E10),
// quirk (a) and its cap, retry-later's "never runs again" for a resolver,
// settle() while an entry waits (S8), and the poller's keep-alive (C5).

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type Source = "constraint" | "resolver" | "effect" | "derivation";
const OPTION: Record<Source, string> = {
  constraint: "onConstraintError",
  resolver: "onResolverError",
  effect: "onEffectError",
  derivation: "onDerivationError",
};

/** probe/c.mjs from the RFC review: one source throws once x > 0. */
function throwing(src: Source) {
  const heard: string[] = [];
  const moduleHook: unknown[] = [];
  const mod = createModule("m", {
    schema: {
      facts: { x: t.number(), done: t.boolean() },
      derivations: { d: t.number() },
      requirements: { GO: {} },
    },
    init: (f: any) => {
      f.x = 0;
      f.done = false;
    },
    derive: {
      d: (f: any) => {
        if (src === "derivation" && f.x > 0) {
          throw new Error("dboom");
        }

        return f.x;
      },
    },
    constraints: {
      c: {
        when: (f: any) => {
          if (src === "constraint" && f.x > 0) {
            throw new Error("cboom");
          }

          return src === "resolver" && f.x > 0 && !f.done;
        },
        require: { type: "GO" },
      },
    },
    effects: {
      e: {
        run: (f: any) => {
          if (src === "effect" && f.x > 0) {
            throw new Error("eboom");
          }
        },
      },
    },
    resolvers: {
      r: {
        requirement: "GO",
        resolve: async () => {
          throw new Error("rboom");
        },
      },
    },
    hooks: { onResolverError: (e: unknown) => moduleHook.push(e) },
  } as never);
  const sys: any = createSystem({
    module: mod,
    errorBoundary: { [OPTION[src]]: "throw" },
    plugins: [
      {
        name: "p",
        onConstraintError: () => heard.push("onConstraintError"),
        onEffectError: () => heard.push("onEffectError"),
        onResolverError: () => heard.push("onResolverError"),
        onErrorRecovery: (_e: unknown, s: string) =>
          heard.push(`recovery:${s}`),
      },
    ],
  } as never);

  return { sys, heard, moduleHook };
}

/** Collects unhandled rejections instead of vitest (as the diff harness does). */
function catchUnhandled() {
  const caught: unknown[] = [];
  const saved = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const mine = (reason: unknown) => caught.push(reason);
  process.on("unhandledRejection", mine);

  return {
    caught,
    restore() {
      process.off("unhandledRejection", mine);
      for (const fn of saved) {
        process.on("unhandledRejection", fn);
      }
    },
  };
}

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('L3b "throw" keeps 1.35\'s surfaces (E10)', () => {
  it("derivation: the reader gets the DirectiveError", async () => {
    const { sys, heard } = throwing("derivation");
    sys.start();
    await sys.settle();
    sys.facts.x = 1;
    let caught: unknown;
    try {
      sys.derive.d;
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(DirectiveError);
    expect(caught).toMatchObject({ source: "derivation", sourceId: "d" });
    expect(heard).toEqual(["recovery:throw"]);
    await expect(sys.settle()).resolves.toBeUndefined();
    sys.destroy();
  });

  it.each(["constraint", "effect"] as const)(
    "%s: the pass stops, development logs it, the write returns and settle() resolves; no source hook",
    async (src) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const { sys, heard } = throwing(src);
      sys.start();
      await sys.settle();
      expect(() => {
        sys.facts.x = 1;
      }).not.toThrow();
      await expect(sys.settle()).resolves.toBeUndefined();

      expect(heard).toEqual(["recovery:throw"]);
      const logged = error.mock.calls.filter(
        (c) => c[0] === "[Directive] Unexpected error in reconcile:",
      );
      expect(logged).toHaveLength(1);
      expect(logged[0]![1]).toBeInstanceOf(DirectiveError);
      expect(logged[0]![1]).toMatchObject({
        source: src,
        sourceId: src === "constraint" ? "c" : "e",
      });
      // The effect's own "threw an error" line comes after the boundary, so
      // the throw skips it too (1.35).
      expect(
        error.mock.calls.flat().some((a) => a instanceof DirectiveError),
      ).toBe(true);
      expect(error).toHaveBeenCalledTimes(1);
      sys.destroy();
    },
  );

  it("resolver: an unhandled rejection carrying the DirectiveError; no plugin or module hook", async () => {
    const unhandled = catchUnhandled();
    try {
      const { sys, heard, moduleHook } = throwing("resolver");
      sys.start();
      await sys.settle();
      sys.facts.x = 1;
      await macrotask();
      await macrotask();

      expect(unhandled.caught).toHaveLength(1);
      expect(unhandled.caught[0]).toBeInstanceOf(DirectiveError);
      expect(unhandled.caught[0]).toMatchObject({
        source: "resolver",
        sourceId: "r",
      });
      expect(heard).toEqual(["recovery:throw"]);
      expect(moduleHook).toEqual([]);
      await expect(sys.settle()).resolves.toBeUndefined();
      sys.destroy();
    } finally {
      unhandled.restore();
    }
  });
});

/** A resolver run by `go`, failing while `fail(call)` says so. */
function retrying(fail: (call: number) => boolean, requeueOn?: number) {
  const seen: string[] = [];
  let calls = 0;
  const mod = createModule("m", {
    schema: {
      facts: { go: t.boolean(), done: t.boolean() },
      requirements: { WORK: {} },
    },
    init: (f: any) => {
      f.go = false;
      f.done = false;
    },
    constraints: {
      work: {
        when: (f: any) => f.go && !f.done,
        require: { type: "WORK" },
      },
    },
    resolvers: {
      work: {
        requirement: "WORK",
        resolve: async (_req: unknown, ctx: any) => {
          const call = ++calls;
          await Promise.resolve();
          if (fail(call)) {
            throw new Error(`failure ${call}`);
          }
          if (call === requeueOn) {
            ctx.requeue();

            return;
          }
          ctx.facts.done = true;
        },
      },
    },
  } as never);
  const sys: any = createSystem({
    module: mod,
    errorBoundary: { onResolverError: "retry" },
    plugins: [
      {
        name: "rec",
        onReconcileStart: () => seen.push("start"),
        onRequirementCreated: () => seen.push("created"),
        onResolverStart: () => seen.push("run"),
        onResolverError: () => seen.push("error"),
        onResolverComplete: () => seen.push("complete"),
        onErrorRecovery: (_e: unknown, s: string) => seen.push(`recovery:${s}`),
        onReconcileEnd: () => seen.push("end"),
      },
    ],
  } as never);

  return { sys, seen, calls: () => calls };
}

/** Run until nothing is left: settle, then let any follow-up run start. */
async function quiet(sys: any) {
  for (let i = 0; i < 20; i++) {
    await sys.settle();
    await macrotask();
  }
}

describe('L3b quirk (a): "retry" re-dispatches the resolver', () => {
  it("keeps 1.35's passes up to the run's end, then one more pass re-dispatches", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sys, seen, calls } = retrying((call) => call === 1);
    sys.start();
    await sys.settle();
    seen.length = 0;
    sys.facts.go = true;
    await quiet(sys);

    expect(calls()).toBe(2);
    expect(sys.facts.done).toBe(true);
    // The fresh run's outcome and the pass its write starts follow; their
    // order is ordinary L2 timing, not part of the quirk.
    expect(seen.slice(16).filter((s) => s === "complete")).toHaveLength(1);
    expect(seen.slice(0, 16)).toEqual([
      // The dispatch.
      "start",
      "created",
      "run",
      "end",
      // The failure: the boundary, then the source hook.
      "recovery:retry",
      "error",
      // 1.35: the error path's pass while the run is in flight drops the
      // dispatch as a duplicate (no "run")...
      "start",
      "created",
      "end",
      // ...and the pass every finished run triggers.
      "start",
      "created",
      "end",
      // Quirk (a): one more pass re-dispatches, through the requeue set.
      "start",
      "created",
      "run",
      "end",
    ]);
    sys.destroy();
  });

  it("re-dispatches an always-failing resolver at most 3 times in a row, then warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sys, seen, calls } = retrying(() => true);
    sys.start();
    sys.facts.go = true;
    await quiet(sys);

    expect(calls()).toBe(4);
    // Past the cap it is still reported as "retry".
    expect(seen.filter((s) => s === "recovery:retry")).toHaveLength(4);
    const capped = warn.mock.calls.filter((c) =>
      String(c[0]).includes("3 retries in a row"),
    );
    expect(capped).toHaveLength(1);
    expect(String(capped[0]![0])).toContain('resolver "work"');
    // 1.35's state: raised, and an unrelated pass does not run it.
    sys.facts.done = false;
    await quiet(sys);
    expect(calls()).toBe(4);
    sys.destroy();
  });

  it("a retraction starts the count over", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sys, calls } = retrying(() => true);
    sys.start();
    sys.facts.go = true;
    await quiet(sys);
    expect(calls()).toBe(4);
    sys.facts.go = false;
    await quiet(sys);
    sys.facts.go = true;
    await quiet(sys);

    // A new dispatch, then 3 re-dispatches again (without the reset: 5).
    expect(calls()).toBe(8);
    sys.destroy();
  });

  it("a completed run starts the count over", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Calls 1–3 fail, call 4 completes and requeues itself (the requirement
    // stays raised), and every call after fails.
    const { sys, calls } = retrying((call) => call !== 4, 4);
    sys.start();
    sys.facts.go = true;
    await quiet(sys);

    // Call 5 fails with a fresh count: 3 more (without the reset: 5 calls).
    expect(calls()).toBe(8);
    sys.destroy();
  });
});

/** A resolver that always fails under retry-later, and the passes it causes. */
function waiting() {
  let calls = 0;
  let passes = 0;
  const mod = createModule("m", {
    schema: { facts: { go: t.boolean() }, requirements: { WORK: {} } },
    init: (f: any) => {
      f.go = false;
    },
    constraints: {
      work: { when: (f: any) => f.go, require: { type: "WORK" } },
    },
    resolvers: {
      work: {
        requirement: "WORK",
        resolve: async () => {
          calls++;
          throw new Error("down");
        },
      },
    },
  } as never);
  const sys: any = createSystem({
    module: mod,
    errorBoundary: {
      onResolverError: "retry-later",
      retryLater: { delayMs: 300, maxRetries: 5 },
    },
    plugins: [{ name: "p", onReconcileStart: () => passes++ }],
  } as never);

  return { sys, calls: () => calls, passes: () => passes };
}

describe("L3b retry-later (E8, E9, S8)", () => {
  it("a failed resolver never runs again (1.35; candidate (p) not approved), though its due entry runs a pass", async () => {
    vi.useFakeTimers();
    const w = waiting();
    w.sys.start();
    w.sys.facts.go = true;
    await vi.advanceTimersByTimeAsync(10);
    expect(w.calls()).toBe(1);
    const before = w.passes();
    await vi.advanceTimersByTimeAsync(3000);

    expect(w.passes()).toBeGreaterThan(before);
    expect(w.calls()).toBe(1);
    w.sys.destroy();
  });

  it("settle() resolves while an entry waits, and destroy() leaves no timer", async () => {
    vi.useFakeTimers();
    const w = waiting();
    w.sys.start();
    w.sys.facts.go = true;
    await vi.advanceTimersByTimeAsync(10);
    const before = w.passes();
    const settled = w.sys.settle(50);
    await vi.advanceTimersByTimeAsync(0);

    await expect(settled).resolves.toBeUndefined();
    // The entry was still waiting: its pass comes later.
    expect(w.passes()).toBe(before);
    await vi.advanceTimersByTimeAsync(600);
    expect(w.passes()).toBeGreaterThan(before);
    w.sys.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("C5: the poller's host handle is unref'd, the tick's is not", () => {
    const handles: { ms: number; unref: ReturnType<typeof vi.fn> }[] = [];
    const clock = createClock({
      now: () => 0,
      setTimer: (_cb, ms) => {
        const handle = { ms, unref: vi.fn() };
        handles.push(handle);

        return handle;
      },
      clearTimer: () => {},
    });
    const mod = createModule("m", {
      schema: { facts: { n: t.number() }, events: { tick: {} } },
      init: (f: any) => {
        f.n = 0;
      },
      events: { tick: () => {} },
      constraints: { c: { when: () => false, require: { type: "X" } } },
    } as never);
    const sys: any = createSystemCore(
      { module: mod, tickMs: 1000 } as never,
      [
        withErrorBoundary({ retryLater: { delayMs: 300 } }),
        withReconcile,
        withPlugins([]),
      ],
      { clock },
    );
    // retryLater configured: 1.35 polls from start().
    sys.start();
    const poller = handles.filter((h) => h.ms === 300);
    const tick = handles.filter((h) => h.ms === 1000);

    expect(poller).toHaveLength(1);
    expect(poller[0]!.unref).toHaveBeenCalledTimes(1);
    expect(tick).toHaveLength(1);
    expect(tick[0]!.unref).not.toHaveBeenCalled();
    sys.destroy();
  });
});
