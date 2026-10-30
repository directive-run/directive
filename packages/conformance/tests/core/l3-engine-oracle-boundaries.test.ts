// Ported from packages/core/src/core/__tests__/l3-engine-oracle-boundaries.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { createModule, createSystem, t } from "@directive-run/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// Black-box tests for the engine at L3, second file: what a module author is
// told when a definition is refused, what settle() says when it gives up, how
// a resolver's error strategy and its module hook behave, and when a resolver
// that wrote the fact its constraint reads counts as having finished the job.
// Public API only; they pin what a user can see, not message wording beyond
// the names a person needs to find the problem.

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function recorder() {
  const calls: Array<{ hook: string; args: any[] }> = [];
  const plugin: Record<string, unknown> = { name: "rec" };
  for (const hook of [
    "onResolverStart",
    "onResolverComplete",
    "onResolverError",
    "onResolverCancel",
    "onRequirementCanceled",
    "onReconcileEnd",
  ]) {
    plugin[hook] = (...args: any[]) => {
      calls.push({ hook, args });
    };
  }
  return {
    plugin: plugin as any,
    of: (hook: string) =>
      calls.filter((c) => c.hook === hook).map((c) => c.args),
  };
}

const emptySchema = {
  facts: {},
  derivations: {},
  events: {},
  requirements: {},
};

describe("a module with a dangerous key is refused, naming where it is", () => {
  const noop = () => {};
  const sections: Array<[string, Record<string, unknown>]> = [
    ["events", { events: { constructor: noop } }],
    ["derive", { derive: { constructor: () => 1 } }],
    ["effects", { effects: { constructor: { run: noop } } }],
    [
      "constraints",
      {
        constraints: {
          constructor: { when: () => false, require: { type: "X" } },
        },
      },
    ],
    [
      "resolvers",
      { resolvers: { constructor: { requirement: "X", resolve: noop } } },
    ],
  ];

  it.each(sections)("a dangerous key in %s", (section, body) => {
    const mod = createModule("bad", {
      schema: emptySchema,
      ...body,
    } as never);
    expect(() => createSystem({ module: mod } as never)).toThrow(
      new RegExp(`"constructor".*${section}`),
    );
  });

  it("a name starting with $ is only reserved for facts: events, derivations and effects may use it", () => {
    const mod = createModule("dollar", {
      schema: {
        facts: { n: t.number() },
        derivations: { $total: t.number() },
        events: { $bump: {} },
        requirements: {},
      },
      init: (facts: any) => {
        facts.n = 1;
      },
      derive: { $total: (facts: any) => facts.n * 2 },
      events: {
        $bump: (facts: any) => {
          facts.n = facts.n + 1;
        },
      },
      effects: { $watch: { run: (facts: any) => void facts.n } },
    } as never);
    const sys = createSystem({ module: mod } as never) as any;
    sys.start();
    expect(sys.read("$total")).toBe(2);
    sys.dispatch({ type: "$bump" });
    expect(sys.read("$total")).toBe(4);
    sys.destroy();
  });
});

function stuckSystem(maxWaitHolder: {
  hold: ReturnType<typeof deferred<void>>;
}) {
  const mod = createModule("stuck", {
    schema: {
      facts: { go: t.boolean() },
      derivations: {},
      events: {},
      requirements: { FETCH_THING: {} },
    },
    init: (facts: any) => {
      facts.go = false;
    },
    constraints: {
      want: {
        when: (facts: any) => facts.go,
        require: { type: "FETCH_THING" },
      },
    },
    resolvers: {
      fetcher: {
        requirement: "FETCH_THING",
        resolve: async () => {
          await maxWaitHolder.hold.promise;
        },
      },
    },
  } as never);
  return createSystem({ module: mod } as never) as any;
}

// Sources are an L5 feature: kept in their own describe so the placement of
// the L3 sections above is not lifted to L5.
describe("a source with a dangerous key is refused, naming where it is", () => {
  it("a dangerous key in sources", () => {
    const mod = createModule("bad", {
      schema: emptySchema,
      sources: { constructor: {} },
    } as never);
    expect(() => createSystem({ module: mod } as never)).toThrow(
      /"constructor".*sources/,
    );
  });
});

describe("settle() that gives up says what it was waiting for", () => {
  it("names the resolver still running and the requirement that is unmet", async () => {
    const holder = { hold: deferred() };
    const sys = stuckSystem(holder);
    sys.start();
    sys.facts.go = true;
    await flush();
    let message = "";
    await sys.settle(30).catch((e: Error) => {
      message = e.message;
    });
    expect(message).toMatch(/settle\(\) timed out/);
    expect(message).toMatch(/fetcher/);
    expect(message).toMatch(/FETCH_THING/);
    expect(message).toMatch(/30/);
    holder.hold.resolve();
    sys.destroy();
  });

  it("a settle that is not stuck does not mention resolvers or requirements", async () => {
    const holder = { hold: deferred() };
    const sys = stuckSystem(holder);
    sys.start();
    sys.facts.go = true;
    await flush();
    // The first settle times out; once the resolver finishes, a new one resolves.
    await expect(sys.settle(20)).rejects.toThrow();
    holder.hold.resolve();
    await expect(sys.settle(1000)).resolves.toBeUndefined();
    sys.destroy();
  });
});

describe("module hooks that are only partly filled in", () => {
  function hooked(hooks: Record<string, unknown>) {
    const mod = createModule("partial", {
      schema: emptySchema,
      hooks,
    } as never);
    return createSystem({ module: mod } as never) as any;
  }

  it("a module with onStart but no onStop stops and destroys, sync and async", async () => {
    const onStart = vi.fn();
    for (const how of ["stop", "stopAsync", "destroy", "destroyAsync"]) {
      const sys = hooked({ onStart });
      sys.start();
      await expect(Promise.resolve(sys[how]())).resolves.toBeUndefined();
      expect(sys.isRunning).toBe(false);
    }
    expect(onStart).toHaveBeenCalledTimes(4);
  });

  it("destroy() and destroyAsync() of a running system call the module's onStop once", async () => {
    for (const how of ["destroy", "destroyAsync"]) {
      const onStop = vi.fn();
      const sys = hooked({ onStop });
      sys.start();
      await sys[how]();
      await sys[how]();
      expect(onStop).toHaveBeenCalledTimes(1);
    }
  });
});

describe("stopping a system ends what is in flight", () => {
  it("stop() and stopAsync() abort a resolver that is still running", async () => {
    for (const how of ["stop", "stopAsync"]) {
      const signals: AbortSignal[] = [];
      const mod = createModule("inflight", {
        schema: {
          facts: { go: t.boolean() },
          derivations: {},
          events: {},
          requirements: { SLOW: {} },
        },
        init: (facts: any) => {
          facts.go = false;
        },
        constraints: {
          slow: { when: (facts: any) => facts.go, require: { type: "SLOW" } },
        },
        resolvers: {
          slowpoke: {
            requirement: "SLOW",
            resolve: async (_req: unknown, context: any) => {
              signals.push(context.signal);
              await new Promise(() => {});
            },
          },
        },
      } as never);
      const sys = createSystem({ module: mod } as never) as any;
      sys.start();
      sys.facts.go = true;
      await flush();
      expect(signals).toHaveLength(1);
      expect(signals[0]!.aborted).toBe(false);
      await sys[how]();
      expect(signals[0]!.aborted).toBe(true);
      sys.destroy();
    }
  });
});

describe("a resolver's error strategy and its module hook", () => {
  function failing(options: {
    failures: number;
    strategy?: unknown;
    hooks?: Record<string, unknown>;
    thrown?: unknown;
  }) {
    let calls = 0;
    const mod = createModule("flaky", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean() },
        derivations: {},
        events: {},
        requirements: { WORK: {} },
      },
      init: (facts: any) => {
        facts.go = false;
        facts.done = false;
      },
      constraints: {
        work: {
          when: (facts: any) => facts.go && !facts.done,
          require: { type: "WORK" },
        },
      },
      resolvers: {
        worker: {
          requirement: "WORK",
          resolve: async (_req: unknown, context: any) => {
            calls++;
            if (calls <= options.failures) {
              throw options.thrown ?? new Error("nope");
            }
            context.facts.done = true;
          },
        },
      },
      ...(options.hooks ? { hooks: options.hooks } : {}),
    } as never);
    const rec = recorder();
    const sys = createSystem({
      module: mod,
      plugins: [rec.plugin],
      ...(options.strategy
        ? { errorBoundary: { onResolverError: options.strategy } }
        : {}),
    } as never) as any;
    return { sys, rec, calls: () => calls };
  }

  it("the module's onResolverError hook is given an Error, the requirement and the facts", async () => {
    const seen: any[] = [];
    const { sys } = failing({
      failures: 1,
      strategy: "skip",
      thrown: "plain string",
      hooks: {
        onResolverError: (error: unknown, requirement: any, context: any) => {
          seen.push({
            isError: error instanceof Error,
            message: (error as Error).message,
            type: requirement.type,
            go: context.facts.go,
          });
        },
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sys.start();
    sys.facts.go = true;
    await flush();
    expect(seen).toEqual([
      { isError: true, message: "plain string", type: "WORK", go: true },
    ]);
    sys.destroy();
  });

  it("a module with other hooks but no onResolverError reports no hook failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sys, rec } = failing({
      failures: 1,
      strategy: "skip",
      hooks: { onStart: () => {} },
    });
    sys.start();
    sys.facts.go = true;
    await flush();
    expect(rec.of("onResolverError")).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
    sys.destroy();
  });

  it("a throwing onResolverError hook is reported with the module's id, and the system carries on", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sys, rec } = failing({
      failures: 1,
      strategy: "skip",
      hooks: {
        onResolverError: () => {
          throw new Error("hook broke");
        },
      },
    });
    sys.start();
    sys.facts.go = true;
    await flush();
    expect(rec.of("onResolverError")).toHaveLength(1);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]![0])).toMatch(/flaky/);
    expect(sys.isRunning).toBe(true);
    sys.destroy();
  });
});

describe("a resolver that wrote the fact its constraint reads", () => {
  function ownWriteSystem() {
    const before = deferred();
    const after = deferred();
    const rec = recorder();
    const mod = createModule("own", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean(), extra: t.number() },
        derivations: { inner: t.number(), outer: t.boolean() },
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.go = false;
        facts.done = false;
        facts.extra = 0;
      },
      derive: {
        inner: (facts: any) => facts.extra,
        outer: (facts: any, derived: any) =>
          derived.inner >= 0 && facts.go && !facts.done,
      },
      constraints: {
        load: {
          when: (_facts: any, derived: any) => derived.outer === true,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_req: unknown, context: any) => {
            await before.promise;
            context.facts.done = true;
            await after.promise;
          },
        },
      },
    } as never);
    const sys = createSystem({
      module: mod,
      plugins: [rec.plugin],
    } as never) as any;
    return { sys, rec, before, after };
  }

  it("alone in changing what the constraint reads: finishes, is not canceled", async () => {
    const { sys, rec, before, after } = ownWriteSystem();
    sys.start();
    sys.facts.go = true;
    await flush();
    before.resolve();
    await flush();
    expect(rec.of("onResolverCancel")).toHaveLength(0);
    after.resolve();
    await flush();
    expect(rec.of("onResolverComplete")).toHaveLength(1);
    expect(rec.of("onResolverCancel")).toHaveLength(0);
    sys.destroy();
  });

  it("a write from outside in the same pass to something the constraint reads, even only through a derivation of a derivation, makes it an ordinary cancel", async () => {
    const { sys, rec, before, after } = ownWriteSystem();
    sys.start();
    sys.facts.go = true;
    await flush();
    expect(rec.of("onResolverStart")).toHaveLength(1);
    before.resolve();
    sys.facts.extra = 9;
    await flush();
    expect(rec.of("onResolverCancel")).toHaveLength(1);
    expect(rec.of("onRequirementCanceled")).toHaveLength(1);
    after.resolve();
    sys.destroy();
  });

  it("two resolvers that between them end their constraint's requirements: neither is canceled", async () => {
    const before = deferred();
    const after = deferred();
    const rec = recorder();
    const mod = createModule("joint", {
      schema: {
        facts: { go: t.boolean(), x: t.boolean(), y: t.boolean() },
        derivations: {},
        events: {},
        requirements: { A: {}, B: {} },
      },
      init: (facts: any) => {
        facts.go = false;
        facts.x = false;
        facts.y = false;
      },
      constraints: {
        both: {
          when: (facts: any) => facts.go && !(facts.x && facts.y),
          require: () => [{ type: "A" }, { type: "B" }],
        },
      },
      resolvers: {
        a: {
          requirement: "A",
          resolve: async (_req: unknown, context: any) => {
            await before.promise;
            context.facts.x = true;
            await after.promise;
          },
        },
        b: {
          requirement: "B",
          resolve: async (_req: unknown, context: any) => {
            await before.promise;
            context.facts.y = true;
            await after.promise;
          },
        },
      },
    } as never);
    const sys = createSystem({
      module: mod,
      plugins: [rec.plugin],
    } as never) as any;
    sys.start();
    sys.facts.go = true;
    await flush();
    expect(rec.of("onResolverStart")).toHaveLength(2);
    before.resolve();
    await flush();
    expect(rec.of("onResolverCancel")).toHaveLength(0);
    after.resolve();
    await flush();
    expect(rec.of("onResolverComplete")).toHaveLength(2);
    expect(rec.of("onResolverCancel")).toHaveLength(0);
    sys.destroy();
  });
});
