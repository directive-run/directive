// Ported from packages/core/src/core/__tests__/l3-engine-oracle.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for the engine at L3: lifecycle (start, stop, destroy and
// their async forms), readiness and settling, the plugin hook stream,
// the error boundary's strategies and the clock. Public API only. They pin
// documented rules (each hook fires once, a refused start does nothing, a
// strategy does what its name says), not message text.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const HOOKS = [
  "onInit",
  "onStart",
  "onStop",
  "onDestroy",
  "onConstraintEvaluate",
  "onConstraintError",
  "onRequirementCreated",
  "onRequirementMet",
  "onRequirementCanceled",
  "onResolverStart",
  "onResolverComplete",
  "onResolverError",
  "onResolverRetry",
  "onResolverCancel",
  "onReconcileStart",
  "onReconcileEnd",
  "onEffectRun",
  "onEffectError",
  "onError",
  "onErrorRecovery",
] as const;

/** A plugin that records every hook call, in order. */
function recorder(name = "rec") {
  const calls: Array<{ hook: string; args: any[] }> = [];
  const plugin: Record<string, unknown> = { name };
  for (const hook of HOOKS) {
    plugin[hook] = (...args: any[]) => {
      calls.push({ hook, args });
    };
  }
  return {
    plugin: plugin as any,
    calls,
    of: (hook: string) =>
      calls.filter((c) => c.hook === hook).map((c) => c.args),
    order: () => calls.map((c) => c.hook),
  };
}

const schema = {
  facts: {
    count: t.number(),
    gate: t.boolean(),
    result: t.string(),
  },
  derivations: { parity: t.string() },
  events: { bump: {} },
  requirements: { LOAD: { n: t.number() }, ORPHAN: {} },
};

interface ModOptions {
  resolve?: (req: any, context: any) => unknown;
  retry?: unknown;
  when?: (facts: any) => boolean;
  effects?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  orphan?: boolean;
}

function mod(options: ModOptions = {}) {
  return createModule("m", {
    schema,
    init: (facts: any) => {
      facts.count = 0;
      facts.gate = false;
      facts.result = "";
    },
    derive: {
      parity: (facts: any) => (facts.count % 2 === 0 ? "even" : "odd"),
    },
    events: {
      bump: (facts: any) => {
        facts.count = facts.count + 1;
      },
    },
    constraints: {
      load: {
        when:
          options.when ?? ((facts: any) => facts.gate && facts.result === ""),
        require: (facts: any) => ({ type: "LOAD", n: facts.count }),
      },
      ...(options.orphan
        ? {
            orphan: {
              when: (facts: any) => facts.count === 7,
              require: { type: "ORPHAN" },
            },
          }
        : {}),
    },
    resolvers: {
      load: {
        requirement: "LOAD",
        ...(options.retry ? { retry: options.retry } : {}),
        resolve:
          options.resolve ??
          (async (req: any, context: any) => {
            context.facts.result = `loaded ${req.n}`;
          }),
      },
    },
    ...(options.effects ? { effects: options.effects } : {}),
    ...(options.hooks ? { hooks: options.hooks } : {}),
  } as never);
}

function system(
  options: ModOptions & { plugins?: unknown[]; errorBoundary?: unknown } = {},
) {
  const { plugins, errorBoundary, ...modOptions } = options;
  return createSystem({
    module: mod(modOptions),
    ...(plugins ? { plugins } : {}),
    ...(errorBoundary ? { errorBoundary } : {}),
  } as never) as any;
}

describe("lifecycle: each transition happens once and is announced once", () => {
  it("start() twice starts once: one onStart for plugins and for modules", async () => {
    const rec = recorder();
    const onStart = vi.fn();
    const sys = system({ plugins: [rec.plugin], hooks: { onStart } });
    sys.start();
    sys.start();
    await sys.settle();
    expect(sys.isRunning).toBe(true);
    expect(rec.of("onStart")).toHaveLength(1);
    expect(onStart).toHaveBeenCalledTimes(1);
    sys.destroy();
  });

  it("stop() before start() does nothing; on a running system it announces once", async () => {
    const rec = recorder();
    const onStop = vi.fn();
    const sys = system({ plugins: [rec.plugin], hooks: { onStop } });
    sys.stop();
    expect(rec.of("onStop")).toHaveLength(0);
    expect(onStop).not.toHaveBeenCalled();
    sys.start();
    await sys.settle();
    sys.stop();
    sys.stop();
    expect(sys.isRunning).toBe(false);
    expect(rec.of("onStop")).toHaveLength(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    sys.destroy();
  });

  it("destroy() stops a running system first, then announces the destroy once", async () => {
    const rec = recorder();
    const sys = system({ plugins: [rec.plugin] });
    sys.start();
    await sys.settle();
    sys.destroy();
    sys.destroy();
    expect(sys.isRunning).toBe(false);
    const order = rec
      .order()
      .filter((h) => h === "onStop" || h === "onDestroy");
    expect(order).toEqual(["onStop", "onDestroy"]);
  });

  it("start() after destroy() is refused: no start hooks and no work", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rec = recorder();
    const resolve = vi.fn(async () => {});
    const sys = system({ plugins: [rec.plugin], resolve });
    sys.start();
    await sys.settle();
    sys.destroy();
    sys.start();
    expect(sys.isRunning).toBe(false);
    expect(rec.of("onStart")).toHaveLength(1);
    sys.facts.gate = true;
    await flush();
    expect(resolve).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
  });

  it("stopAsync() announces to plugins and modules once and runs effect cleanups", async () => {
    const rec = recorder();
    const onStop = vi.fn();
    const cleanup = vi.fn();
    const sys = system({
      plugins: [rec.plugin],
      hooks: { onStop },
      effects: {
        watcher: {
          run: (facts: any) => {
            void facts.count;
            return cleanup;
          },
        },
      },
    });
    await sys.stopAsync();
    expect(rec.of("onStop")).toHaveLength(0);
    sys.start();
    await sys.settle();
    await sys.stopAsync();
    await sys.stopAsync();
    expect(sys.isRunning).toBe(false);
    expect(rec.of("onStop")).toHaveLength(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    sys.destroy();
  });

  it("stopAsync() on a module with no hooks resolves", async () => {
    const sys = system();
    sys.start();
    await sys.settle();
    await expect(sys.stopAsync()).resolves.toBeUndefined();
    expect(sys.isRunning).toBe(false);
  });

  it("destroyAsync() stops, then announces the destroy once", async () => {
    const rec = recorder();
    const sys = system({ plugins: [rec.plugin] });
    sys.start();
    await sys.settle();
    await sys.destroyAsync();
    await sys.destroyAsync();
    const order = rec
      .order()
      .filter((h) => h === "onStop" || h === "onDestroy");
    expect(order).toEqual(["onStop", "onDestroy"]);
    expect(sys.isRunning).toBe(false);
  });

  it("a pass scheduled just before stop() does not run after it", async () => {
    const resolve = vi.fn(async () => {});
    const sys = system({ resolve });
    sys.start();
    await sys.settle();
    sys.facts.gate = true;
    sys.stop();
    await flush();
    expect(resolve).not.toHaveBeenCalled();
    sys.destroy();
  });
});

describe("readiness", () => {
  it("isReady is false before start, and whenReady() before start rejects", async () => {
    const sys = system();
    expect(sys.isReady).toBe(false);
    await expect(sys.whenReady()).rejects.toBeInstanceOf(Error);
    sys.destroy();
  });

  it("whenReady() right after start resolves for every caller once the first pass is done", async () => {
    const sys = system();
    sys.start();
    expect(sys.isReady).toBe(false);
    let resolved = 0;
    const first = sys.whenReady().then(() => resolved++);
    const second = sys.whenReady().then(() => resolved++);
    await Promise.all([first, second]);
    expect(resolved).toBe(2);
    expect(sys.isReady).toBe(true);
    await expect(sys.whenReady()).resolves.toBeUndefined();
    sys.destroy();
  });
});

describe("settling", () => {
  it("isSettled is false while a pass is scheduled and while a resolver is in flight", async () => {
    const gate = deferred();
    const sys = system({
      resolve: async (req: any, context: any) => {
        await gate.promise;
        context.facts.result = `loaded ${req.n}`;
      },
    });
    sys.start();
    await sys.settle();
    expect(sys.isSettled).toBe(true);
    sys.facts.gate = true;
    expect(sys.isSettled).toBe(false);
    await flush();
    expect(sys.isSettled).toBe(false);
    gate.resolve();
    await sys.settle();
    expect(sys.isSettled).toBe(true);
    expect(sys.facts.result).toBe("loaded 0");
    sys.destroy();
  });

  it("onSettledChange hears the system become busy, and nothing after unsubscribing", async () => {
    const sys = system();
    sys.start();
    await sys.settle();
    const listener = vi.fn();
    const unsubscribe = sys.onSettledChange(listener);
    sys.facts.count = 1;
    expect(listener).toHaveBeenCalled();
    await sys.settle();
    unsubscribe();
    listener.mockClear();
    sys.facts.count = 2;
    await sys.settle();
    expect(listener).not.toHaveBeenCalled();
    sys.destroy();
  });

  it("a resolver whose own write retracts its requirement completes and is never canceled", async () => {
    for (const viaDerivation of [false, true]) {
      for (const waitAfterWrite of [0, 1]) {
        const rec = recorder();
        const m = createModule("load", {
          schema: {
            facts: { go: t.boolean(), done: t.boolean() },
            derivations: { pending: t.boolean() },
            events: {},
            requirements: { LOAD: {} },
          },
          init: (facts: any) => {
            facts.go = false;
            facts.done = false;
          },
          derive: { pending: (facts: any) => facts.go && !facts.done },
          constraints: {
            load: {
              when: viaDerivation
                ? (_facts: any, derived: any) => derived.pending
                : (facts: any) => facts.go && !facts.done,
              require: { type: "LOAD" },
            },
          },
          resolvers: {
            load: {
              requirement: "LOAD",
              resolve: async (_req: unknown, context: any) => {
                context.facts.done = true;
                for (let i = 0; i < waitAfterWrite; i++) {
                  await Promise.resolve();
                }
              },
            },
          },
        } as never);
        const sys = createSystem({
          module: m,
          plugins: [rec.plugin],
        } as never) as any;
        sys.start();
        await sys.settle();
        sys.facts.go = true;
        await sys.settle();
        await flush();
        expect(rec.of("onResolverComplete")).toHaveLength(1);
        expect(rec.of("onResolverCancel")).toHaveLength(0);
        expect(rec.of("onRequirementCanceled")).toHaveLength(0);
        sys.destroy();
      }
    }
  });
});

describe("the plugin hook stream", () => {
  it("a constraint's pass reports evaluate, created, start, complete and met, in order", async () => {
    const rec = recorder();
    const sys = system({ plugins: [rec.plugin] });
    sys.start();
    await sys.settle();
    const evaluated = () =>
      rec.of("onConstraintEvaluate").map((args) => args.slice(0, 2));
    expect(evaluated()).toContainEqual(["load", false]);
    rec.calls.length = 0;
    sys.facts.gate = true;
    await sys.settle();

    expect(evaluated()).toContainEqual(["load", true]);
    const [created] = rec.of("onRequirementCreated");
    expect(created![0].requirement).toEqual({ type: "LOAD", n: 0 });
    expect(rec.of("onResolverStart")[0]![0]).toBe("load");
    expect(rec.of("onResolverStart")[0]![1].id).toBe(created![0].id);
    expect(rec.of("onResolverComplete")[0]![0]).toBe("load");
    const [met] = rec.of("onRequirementMet");
    expect(met![0].id).toBe(created![0].id);
    expect(met![1]).toBe("load");

    const order = rec.order();
    const at = (hook: string) => order.indexOf(hook);
    expect(at("onReconcileStart")).toBeLessThan(at("onConstraintEvaluate"));
    expect(at("onConstraintEvaluate")).toBeLessThan(at("onRequirementCreated"));
    expect(at("onRequirementCreated")).toBeLessThan(at("onResolverStart"));
    expect(at("onResolverStart")).toBeLessThan(at("onReconcileEnd"));
    expect(at("onResolverStart")).toBeLessThan(at("onRequirementMet"));
    expect(sys.facts.result).toBe("loaded 0");
    sys.destroy();
  });

  it("onReconcileEnd lists unmet and in-flight requirements, and a canceled one with its resolver", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rec = recorder();
    const hold = deferred();
    const sys = system({
      plugins: [rec.plugin],
      orphan: true,
      resolve: async () => {
        await hold.promise;
      },
    });
    sys.start();
    await sys.settle();
    sys.facts.gate = true;
    await flush();

    let ends = rec.of("onReconcileEnd");
    let last = ends[ends.length - 1]![0];
    expect(last.inflight).toHaveLength(1);
    expect(last.inflight[0].resolverId).toBe("load");
    expect(last.unmet).toEqual([]);
    expect(last.canceled).toEqual([]);
    const reqId = rec.of("onRequirementCreated")[0]![0].id;

    sys.facts.gate = false;
    await flush();
    ends = rec.of("onReconcileEnd");
    last = ends[ends.length - 1]![0];
    expect(last.canceled.map((c: any) => c.id)).toEqual([reqId]);
    expect(typeof last.canceled[0].resolverId).toBe("string");
    expect(rec.of("onResolverCancel")[0]![0]).toBe("load");
    expect(rec.of("onRequirementCanceled")[0]![0].id).toBe(reqId);

    sys.facts.count = 7;
    await flush();
    ends = rec.of("onReconcileEnd");
    last = ends[ends.length - 1]![0];
    expect(last.unmet.map((r: any) => r.requirement.type)).toEqual(["ORPHAN"]);
    hold.resolve();
    sys.destroy();
  });

  it("an effect's run is reported to plugins by its id", async () => {
    const rec = recorder();
    const sys = system({
      plugins: [rec.plugin],
      effects: {
        mirror: {
          run: (facts: any) => {
            void facts.count;
          },
        },
      },
    });
    sys.start();
    await sys.settle();
    expect(rec.of("onEffectRun")).toEqual([["mirror"]]);
    sys.facts.count = 1;
    await sys.settle();
    expect(rec.of("onEffectRun")).toEqual([["mirror"], ["mirror"]]);
    sys.destroy();
  });

  it("a resolver retry is reported with the attempt number", async () => {
    let calls = 0;
    const rec = recorder();
    const sys = system({
      plugins: [rec.plugin],
      retry: { attempts: 2, backoff: "none", initialDelay: 1 },
      resolve: async (req: any, context: any) => {
        calls++;
        if (calls === 1) {
          throw new Error("first try fails");
        }
        context.facts.result = `loaded ${req.n}`;
      },
    });
    sys.start();
    sys.facts.gate = true;
    await sys.settle();
    await flush();
    await sys.settle();
    expect(calls).toBe(2);
    const retries = rec.of("onResolverRetry");
    expect(retries).toHaveLength(1);
    expect(retries[0]![0]).toBe("load");
    expect(retries[0]![1].requirement.type).toBe("LOAD");
    expect(retries[0]![2]).toBe(2);
    expect(sys.facts.result).toBe("loaded 0");
    sys.destroy();
  });

  it("an async plugin onInit that rejects is reported, and the system still runs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sys = system({
      plugins: [
        {
          name: "bad-init",
          onInit: async () => {
            throw new Error("init failed");
          },
        },
      ],
    });
    sys.start();
    sys.facts.gate = true;
    await sys.settle();
    await flush();
    expect(sys.facts.result).toBe("loaded 0");
    expect(console.error).toHaveBeenCalled();
    sys.destroy();
  });
});

describe("error boundary strategies", () => {
  it("a throwing constraint is reported, and disable stops asking it", async () => {
    const rec = recorder();
    const when = vi.fn((facts: any) => {
      if (facts.count > 0) {
        throw new Error("bad when");
      }
      return false;
    });
    const sys = system({
      plugins: [rec.plugin],
      when,
      errorBoundary: { onConstraintError: "disable" },
    });
    sys.start();
    await sys.settle();
    sys.facts.count = 1;
    await sys.settle();
    const errors = rec.of("onConstraintError");
    expect(errors).toHaveLength(1);
    expect(errors[0]![0]).toBe("load");
    expect(rec.of("onErrorRecovery").map((a) => a[1])).toEqual(["disable"]);
    const asked = when.mock.calls.length;
    sys.facts.count = 2;
    await sys.settle();
    sys.facts.count = 3;
    await sys.settle();
    expect(when.mock.calls.length).toBe(asked);
    sys.destroy();
  });

  it("skip leaves a throwing constraint in place, so it is asked again", async () => {
    const rec = recorder();
    const when = vi.fn((facts: any) => {
      if (facts.count > 0) {
        throw new Error("bad when");
      }
      return false;
    });
    const sys = system({
      plugins: [rec.plugin],
      when,
      errorBoundary: { onConstraintError: "skip" },
    });
    sys.start();
    await sys.settle();
    sys.facts.count = 1;
    await sys.settle();
    const asked = when.mock.calls.length;
    sys.facts.count = 2;
    await sys.settle();
    expect(when.mock.calls.length).toBeGreaterThan(asked);
    expect(rec.of("onErrorRecovery").map((a) => a[1])).toEqual([
      "skip",
      "skip",
    ]);
    sys.destroy();
  });

  it("an effect that throws under disable stops running", async () => {
    const run = vi.fn((facts: any) => {
      void facts.count;
      throw new Error("effect boom");
    });
    const rec = recorder();
    const sys = system({
      plugins: [rec.plugin],
      effects: { bad: { run } },
      errorBoundary: { onEffectError: "disable" },
    });
    sys.start();
    await sys.settle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(rec.of("onEffectError")[0]![0]).toBe("bad");
    sys.facts.count = 1;
    await sys.settle();
    sys.facts.count = 2;
    await sys.settle();
    expect(run).toHaveBeenCalledTimes(1);
    sys.destroy();
  });

  it("an effect that keeps throwing under retry is retried three times, then waits for its next change", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const run = vi.fn((facts: any) => {
      void facts.count;
      throw new Error("effect boom");
    });
    const sys = system({
      effects: { bad: { run } },
      errorBoundary: { onEffectError: "retry" },
    });
    sys.start();
    await sys.settle();
    await flush();
    await sys.settle();
    expect(run).toHaveBeenCalledTimes(4);
    expect(console.warn).toHaveBeenCalled();
    sys.facts.count = 1;
    await sys.settle();
    await flush();
    await sys.settle();
    expect(run.mock.calls.length).toBeGreaterThan(4);
    sys.destroy();
  });

  it("an effect that fails once under retry runs again and then stops", async () => {
    let runs = 0;
    const sys = system({
      effects: {
        flaky: {
          run: (facts: any) => {
            void facts.count;
            runs++;
            if (runs === 1) {
              throw new Error("once");
            }
          },
        },
      },
      errorBoundary: { onEffectError: "retry" },
    });
    sys.start();
    await sys.settle();
    await flush();
    await sys.settle();
    expect(runs).toBe(2);
    sys.destroy();
  });

  it("a resolver that fails under disable turns its constraint off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const resolve = vi.fn(async () => {
      throw new Error("resolver boom");
    });
    const sys = system({
      resolve,
      errorBoundary: { onResolverError: "disable" },
    });
    sys.start();
    sys.facts.gate = true;
    await sys.settle();
    await flush();
    expect(resolve).toHaveBeenCalledTimes(1);
    sys.facts.count = 5;
    await sys.settle();
    await flush();
    expect(resolve).toHaveBeenCalledTimes(1);
    sys.destroy();
  });

  it("a resolver that fails under skip is run again for its next requirement", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const resolve = vi.fn(async () => {
      throw new Error("resolver boom");
    });
    const sys = system({
      resolve,
      errorBoundary: { onResolverError: "skip" },
    });
    sys.start();
    sys.facts.gate = true;
    await sys.settle();
    await flush();
    expect(resolve).toHaveBeenCalledTimes(1);
    sys.facts.count = 5;
    await sys.settle();
    await flush();
    expect(resolve).toHaveBeenCalledTimes(2);
    sys.destroy();
  });

  it("retry-later gives a failed resolver's requirement another pass after its delay, not before", async () => {
    vi.useFakeTimers();
    const rec = recorder();
    const sys = system({
      plugins: [rec.plugin],
      resolve: async () => {
        throw new Error("always");
      },
      errorBoundary: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 300 },
      },
    });
    sys.start();
    sys.facts.gate = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(rec.of("onErrorRecovery").map((a) => a[1])).toEqual(["retry-later"]);
    const passes = rec.of("onReconcileStart").length;
    await vi.advanceTimersByTimeAsync(240);
    expect(rec.of("onReconcileStart").length).toBe(passes);
    await vi.advanceTimersByTimeAsync(500);
    expect(rec.of("onReconcileStart").length).toBeGreaterThan(passes);
    sys.destroy();
  });

  it("retry-later chosen by a function, with no retryLater config, still polls (default delay)", async () => {
    vi.useFakeTimers();
    const rec = recorder();
    const sys = system({
      plugins: [rec.plugin],
      resolve: async () => {
        throw new Error("always");
      },
      errorBoundary: { onResolverError: () => "retry-later" },
    });
    sys.start();
    sys.facts.gate = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    const passes = rec.of("onReconcileStart").length;
    await vi.advanceTimersByTimeAsync(900);
    expect(rec.of("onReconcileStart").length).toBe(passes);
    await vi.advanceTimersByTimeAsync(600);
    expect(rec.of("onReconcileStart").length).toBeGreaterThan(passes);
    sys.destroy();
  });

  it("skip starts no retry-later polling", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sys = system({
      resolve: async () => {
        throw new Error("always");
      },
      errorBoundary: { onResolverError: "skip" },
    });
    sys.start();
    sys.facts.gate = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(vi.getTimerCount()).toBe(0);
    sys.destroy();
  });

  it("stop() drops a pending retry-later", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const sys = system({
      resolve: async () => {
        calls++;
        throw new Error("always");
      },
      errorBoundary: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 300 },
      },
    });
    sys.start();
    sys.facts.gate = true;
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toBe(1);
    sys.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    sys.destroy();
  });

  it("retry-later asks a throwing constraint again after the delay", async () => {
    vi.useFakeTimers();
    let throws = true;
    const sys = system({
      when: (facts: any) => {
        if (throws) {
          throws = false;
          throw new Error("not yet");
        }
        return facts.result === "";
      },
      errorBoundary: {
        onConstraintError: "retry-later",
        retryLater: { delayMs: 300 },
      },
    });
    sys.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(sys.facts.result).toBe("");
    await vi.advanceTimersByTimeAsync(1000);
    expect(sys.facts.result).toBe("loaded 0");
    sys.destroy();
  });

  it("a module's onResolverError hook hears the error and requirement; a throwing hook is isolated", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: unknown[] = [];
    const sys = system({
      resolve: async () => {
        throw "not an Error";
      },
      hooks: {
        onResolverError: (error: unknown, requirement: unknown) => {
          seen.push(error, requirement);
          throw new Error("hook boom");
        },
      },
    });
    sys.start();
    sys.facts.gate = true;
    await sys.settle();
    await flush();
    expect(seen[0]).toBeInstanceOf(Error);
    expect(seen[1]).toEqual({ type: "LOAD", n: 0 });
    // The system keeps working after the hook threw.
    sys.dispatch({ type: "bump" });
    expect(sys.facts.count).toBe(1);
    sys.destroy();
  });

  it("a resolver error in a module with no hooks does not break the system", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sys = system({
      resolve: async () => {
        throw new Error("boom");
      },
    });
    sys.start();
    sys.facts.gate = true;
    await sys.settle();
    await flush();
    sys.dispatch({ type: "bump" });
    expect(sys.facts.count).toBe(1);
    sys.destroy();
  });
});

describe("watch, when and subscribe", () => {
  it("watch on a derivation calls back only when its value changes", async () => {
    const sys = system();
    sys.start();
    await sys.settle();
    const cb = vi.fn();
    sys.watch("parity", cb);
    sys.facts.count = 2;
    await sys.settle();
    expect(cb).not.toHaveBeenCalled();
    sys.facts.count = 3;
    await sys.settle();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]!.slice(0, 2)).toEqual(["odd", "even"]);
    sys.destroy();
  });

  it("watch with an equalityFn calls back only when it says the value changed", async () => {
    const sys = system();
    sys.start();
    await sys.settle();
    const cb = vi.fn();
    sys.watch("count", cb, {
      equalityFn: (a: number, b: number | undefined) =>
        Math.floor(a / 10) === Math.floor((b ?? 0) / 10),
    });
    sys.facts.count = 5;
    await sys.settle();
    expect(cb).not.toHaveBeenCalled();
    sys.facts.count = 12;
    await sys.settle();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]![0]).toBe(12);
    sys.destroy();
  });

  it("watch on an unknown key warns in development", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sys = system();
    sys.watch("nope", () => {});
    expect(console.warn).toHaveBeenCalled();
    sys.destroy();
  });

  it("when() resolves once its predicate holds and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const sys = system();
    sys.start();
    let done = false;
    const waiting = sys
      .when((facts: any) => facts.count >= 3, { timeout: 1000 })
      .then(() => {
        done = true;
      });
    sys.facts.count = 1;
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false);
    sys.facts.count = 3;
    await waiting;
    expect(done).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    sys.destroy();
  });

  it("when() with a timeout rejects once it passes; a zero timeout never rejects", async () => {
    vi.useFakeTimers();
    const sys = system();
    sys.start();
    const timed = sys.when((facts: any) => facts.count > 100, { timeout: 200 });
    const failed = expect(timed).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(199);
    await vi.advanceTimersByTimeAsync(1);
    await failed;

    let settled = false;
    const untimed = sys.when((facts: any) => facts.count > 100, { timeout: 0 });
    untimed.then(
      () => (settled = true),
      () => (settled = true),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBe(false);
    sys.facts.count = 101;
    await untimed;
    sys.destroy();
  });

  it("subscribe hears facts and derivations it names, and warns about unknown ones", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sys = system();
    sys.start();
    await sys.settle();
    const onFact = vi.fn();
    const onDerived = vi.fn();
    sys.subscribe(["result"], onFact);
    sys.subscribe(["parity"], onDerived);
    sys.subscribe(["nope"], () => {});
    expect(console.warn).toHaveBeenCalled();
    sys.facts.count = 1;
    await sys.settle();
    expect(onFact).not.toHaveBeenCalled();
    expect(onDerived).toHaveBeenCalled();
    sys.facts.result = "x";
    await sys.settle();
    expect(onFact).toHaveBeenCalled();
    sys.destroy();
  });
});

describe("initialize, reserved names, effect chains and settle(maxWait)", () => {
  it("initialize() a second time does not run module init again", async () => {
    const init = vi.fn((facts: any) => {
      facts.count = 0;
      facts.gate = false;
      facts.result = "";
    });
    const m = createModule("m", {
      schema,
      init,
      derive: {
        parity: (facts: any) => (facts.count % 2 === 0 ? "even" : "odd"),
      },
      events: {
        bump: (facts: any) => {
          facts.count = facts.count + 1;
        },
      },
    } as never);
    const sys = createSystem({ module: m } as never) as any;
    sys.start();
    await sys.settle();
    sys.facts.count = 5;
    sys.initialize();
    expect(sys.facts.count).toBe(5);
    expect(init).toHaveBeenCalledTimes(1);
    sys.destroy();
  });

  it("dispatching a reserved name such as __proto__ is ignored without a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sys = system();
    sys.start();
    expect(() => sys.dispatch({ type: "__proto__" })).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
    expect(sys.facts.count).toBe(0);
    // An ordinary unknown name is reported, which the reserved one was not.
    sys.dispatch({ type: "nope" });
    expect(warn).toHaveBeenCalled();
    sys.destroy();
  });

  it("an effect whose run keeps waking itself is cut after a bounded run, with a warning, and wakes again on a later write", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    const holder: { sys?: any } = {};
    const sys = system({
      effects: {
        loop: {
          run: (facts: any) => {
            void facts.count;
            runs++;
            holder.sys.dispatch({ type: "bump" });
          },
        },
      },
    });
    holder.sys = sys;
    sys.start();
    await sys.settle();
    await flush();
    expect(runs).toBeGreaterThan(10);
    expect(runs).toBeLessThan(1000);
    expect(console.warn).toHaveBeenCalled();
    expect(sys.isSettled).toBe(true);
    const cut = runs;
    sys.facts.count = -1;
    await sys.settle();
    await flush();
    expect(runs).toBeGreaterThan(cut);
    sys.destroy();
  });

  it("settle(maxWait) rejects when a resolver never finishes; a settle that resolves leaves no timer", async () => {
    vi.useFakeTimers();
    const hang = deferred();
    const sys = system({ resolve: () => hang.promise });
    sys.start();
    sys.facts.gate = true;
    const waiting = sys.settle(100);
    const failed = expect(waiting).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(99);
    await vi.advanceTimersByTimeAsync(1);
    await failed;
    hang.resolve();
    const done = sys.settle(1000);
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(vi.getTimerCount()).toBe(0);
    sys.destroy();
  });
});

describe("resolver keys and system.notify", () => {
  it("a resolver's key decides which requirements are the same run", async () => {
    const rec = recorder();
    const hold = deferred();
    const m = createModule("m", {
      schema,
      init: (facts: any) => {
        facts.count = 0;
        facts.gate = false;
        facts.result = "";
      },
      derive: {
        parity: (facts: any) => (facts.count % 2 === 0 ? "even" : "odd"),
      },
      events: {
        bump: (facts: any) => {
          facts.count = facts.count + 1;
        },
      },
      constraints: {
        load: {
          when: (facts: any) => facts.gate && facts.result === "",
          require: (facts: any) => ({ type: "LOAD", n: facts.count }),
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          key: (req: any) => (req.n < 10 ? "small" : "large"),
          resolve: async () => {
            await hold.promise;
          },
        },
      },
    } as never);
    const sys = createSystem({
      module: m,
      plugins: [rec.plugin],
    } as never) as any;
    sys.start();
    sys.facts.gate = true;
    await flush();
    expect(rec.of("onResolverStart")).toHaveLength(1);
    // The same key: the run in flight is the same run.
    sys.facts.count = 1;
    await flush();
    expect(rec.of("onResolverStart")).toHaveLength(1);
    expect(rec.of("onResolverCancel")).toHaveLength(0);
    // A new key: the old run is canceled and a new one starts.
    sys.facts.count = 12;
    await flush();
    expect(rec.of("onResolverCancel")).toHaveLength(1);
    expect(rec.of("onResolverStart")).toHaveLength(2);
    hold.resolve();
    sys.destroy();
  });

  it("notify.guardrailBlocked reaches plugins only for a registered plugin name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const guard: unknown[][] = [];
    const other: unknown[][] = [];
    const sys = createSystem({
      module: mod(),
      plugins: [
        {
          name: "guard",
          onGuardrailBlocked: (...args: unknown[]) => guard.push(args),
        },
        {
          name: "other",
          onGuardrailBlocked: (...args: unknown[]) => other.push(args),
        },
      ],
    } as never) as any;
    sys.start();
    sys.notify.guardrailBlocked("guard", "count", "redact", 2, "pii");
    expect(guard).toEqual([["guard", "count", "redact", 2, "pii"]]);
    expect(other).toHaveLength(1);
    sys.notify.guardrailBlocked("forged", "count", "alert", 1);
    expect(guard).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    // Calls one after another all arrive; only nesting is capped.
    for (let i = 0; i < 6; i++) {
      sys.notify.guardrailBlocked("guard", "count", "detect", i);
    }
    expect(guard).toHaveLength(7);
    sys.destroy();
    sys.notify.guardrailBlocked("guard", "count", "redact", 1);
    expect(guard).toHaveLength(7);
  });

  it("notify.guardrailCoverage reaches plugins until destroy; with no plugins notify is silent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seen: unknown[][] = [];
    const sys = createSystem({
      module: mod(),
      plugins: [
        {
          name: "guard",
          onGuardrailCoverage: (...args: unknown[]) => seen.push(args),
        },
      ],
    } as never) as any;
    sys.start();
    sys.notify.guardrailCoverage("guard", 3, "abc", "start");
    expect(seen).toEqual([["guard", 3, "abc", "start"]]);
    sys.destroy();
    sys.notify.guardrailCoverage("guard", 4, "def", "tags-changed");
    expect(seen).toHaveLength(1);
    const bare = system();
    bare.start();
    bare.notify.guardrailBlocked("guard", "count", "redact", 1);
    bare.notify.guardrailCoverage("guard", 1, "x", "start");
    expect(warn).not.toHaveBeenCalled();
    bare.destroy();
  });
});

describe("readiness and polling after the first pass", () => {
  it("whenReady() first called after the system is ready resolves at once", async () => {
    const sys = system();
    sys.start();
    await sys.settle();
    expect(sys.isReady).toBe(true);
    await expect(sys.whenReady()).resolves.toBeUndefined();
    sys.destroy();
  });

  it("stop() and stopAsync() end retry-later polling at once", async () => {
    vi.useFakeTimers();
    for (const stopper of ["stop", "stopAsync"] as const) {
      const sys = system({
        resolve: async () => {
          throw new Error("always");
        },
        errorBoundary: {
          onResolverError: "retry-later",
          retryLater: { delayMs: 300 },
        },
      });
      sys.start();
      sys.facts.gate = true;
      await vi.advanceTimersByTimeAsync(50);
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      await sys[stopper]();
      expect(vi.getTimerCount()).toBe(0);
      sys.destroy();
    }
  });
});
