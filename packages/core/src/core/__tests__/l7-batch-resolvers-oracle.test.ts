import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests for batched resolvers at L7: what a batch window collects,
// how per-item results and whole-batch failures are reported, how a batch
// retries and times out, and what stopping, destroying, settling or retracting
// a requirement does to a batch that is queued or already running. Public API
// only; a plugin observes the resolver hooks. The window is a number the
// caller configures, so those tests pin it; the default window is pinned only
// as "not zero, and short".

beforeEach(() => {
  vi.useFakeTimers();
  // Failing resolvers print a development warning; it is not under test.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

interface Log {
  completes: string[];
  errors: Array<[string, unknown]>;
  cancels: string[];
  retries: Array<[string, number]>;
}

/**
 * A system whose `want` fact lists the ids to fetch: one FETCH requirement per
 * id, keyed by that id so a hook's requirement id is the id itself.
 */
function build(resolver: Record<string, unknown>) {
  const log: Log = { completes: [], errors: [], cancels: [], retries: [] };
  const plugin = {
    name: "rec",
    onResolverComplete: (_resolver: string, req: { id: string }) => {
      log.completes.push(req.id);
    },
    onResolverError: (
      _resolver: string,
      req: { id: string },
      error: unknown,
    ) => {
      log.errors.push([req.id, error]);
    },
    onResolverCancel: (_resolver: string, req: { id: string }) => {
      log.cancels.push(req.id);
    },
    onResolverRetry: (
      _resolver: string,
      req: { id: string },
      attempt: number,
    ) => {
      log.retries.push([req.id, attempt]);
    },
  };
  const mod = createModule("m", {
    schema: {
      facts: { want: t.array<string>() },
      derivations: {},
      events: {},
      requirements: { FETCH: { id: t.string() } },
    },
    init: (f: any) => {
      f.want = [];
    },
    constraints: {
      fetch: {
        when: (f: any) => f.want.length > 0,
        require: (f: any) =>
          f.want.map((id: string) => ({ type: "FETCH", id })),
      },
    },
    resolvers: {
      fetch: {
        requirement: "FETCH",
        key: (req: { id: string }) => req.id,
        ...resolver,
      },
    },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [plugin],
  } as never) as any;
  system.start();

  return { system, log };
}

/** A batch handler that records each call's ids, context and start time. */
function handler(impl?: (ids: string[], ctx: any, call: number) => unknown) {
  const calls: string[][] = [];
  const contexts: any[] = [];
  const times: number[] = [];
  const fn = async (reqs: Array<{ id: string }>, ctx: any) => {
    const ids = reqs.map((r) => r.id);
    calls.push(ids);
    contexts.push(ctx);
    times.push(Date.now());

    return impl ? impl(ids, ctx, calls.length) : undefined;
  };

  return { calls, contexts, times, fn };
}

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { promise, open };
}

const sorted = (xs: string[]) => [...xs].sort();

describe("resolveBatchWithResults reports each item on its own", () => {
  it("completes every item that succeeds and runs the batch once, whatever the retry policy", async () => {
    const h = handler((ids) => ids.map(() => ({ success: true })));
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 3, backoff: "none" },
      resolveBatchWithResults: h.fn,
    });
    system.facts.want = ["a", "b", "c"];
    await advance(100);

    expect(h.calls).toEqual([["a", "b", "c"]]);
    expect(sorted(log.completes)).toEqual(["a", "b", "c"]);
    expect(log.errors).toEqual([]);
    expect(log.cancels).toEqual([]);
    system.destroy();
  });

  it("errors only the item that failed, with its own error, and does not run the batch again", async () => {
    const boom = new Error("b failed");
    const h = handler(() => [
      { success: true },
      { success: false, error: boom },
      { success: true },
    ]);
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 3, backoff: "none" },
      resolveBatchWithResults: h.fn,
    });
    system.facts.want = ["a", "b", "c"];
    await advance(100);

    expect(h.calls).toEqual([["a", "b", "c"]]);
    expect(sorted(log.completes)).toEqual(["a", "c"]);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]![0]).toBe("b");
    expect(log.errors[0]![1]).toBe(boom);
    expect(log.cancels).toEqual([]);
    system.destroy();
  });

  it("reports a failed item that carries no error as an Error", async () => {
    const h = handler(() => [{ success: true }, { success: false }]);
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatchWithResults: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(100);

    expect(log.completes).toEqual(["a"]);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]![0]).toBe("b");
    expect(log.errors[0]![1]).toBeInstanceOf(Error);
    expect((log.errors[0]![1] as Error).message.length).toBeGreaterThan(0);
    system.destroy();
  });

  it("runs the whole batch again when every item failed, and completes them when the rerun succeeds", async () => {
    const h = handler((ids, _ctx, call) =>
      ids.map(() =>
        call === 1
          ? { success: false, error: new Error("first try") }
          : { success: true },
      ),
    );
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 3, backoff: "none" },
      resolveBatchWithResults: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(1000);

    expect(h.calls).toEqual([
      ["a", "b"],
      ["a", "b"],
    ]);
    expect(sorted(log.completes)).toEqual(["a", "b"]);
    system.destroy();
  });

  it("when every item fails on every attempt, runs once per attempt and reports each item failed", async () => {
    const h = handler((ids) =>
      ids.map(() => ({ success: false, error: new Error("nope") })),
    );
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 3, backoff: "none" },
      resolveBatchWithResults: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(1000);

    expect(h.calls).toHaveLength(3);
    expect(new Set(log.errors.map(([id]) => id))).toEqual(new Set(["a", "b"]));
    expect(log.completes).toEqual([]);
    system.destroy();
  });

  it("fails the whole batch when the results do not match the requirements in number", async () => {
    const h = handler(() => [{ success: true }, { success: true }]);
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatchWithResults: h.fn,
    });
    system.facts.want = ["a", "b", "c"];
    await advance(100);

    expect(log.completes).toEqual([]);
    expect(sorted(log.errors.map(([id]) => id))).toEqual(["a", "b", "c"]);
    const message = (log.errors[0]![1] as Error).message;
    expect(log.errors[0]![1]).toBeInstanceOf(Error);
    // It names the resolver and both counts, so the author can find the slip.
    expect(message).toContain("fetch");
    expect(message).toContain("2");
    expect(message).toContain("3");
    system.destroy();
  });

  it("drops the results of a batch that was aborted while it ran", async () => {
    const g = gate();
    const h = handler(async (ids) => {
      await g.promise;

      return ids.map(() => ({ success: false, error: new Error("late") }));
    });
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatchWithResults: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(20);
    system.facts.want = [];
    await advance(10);
    g.open();
    await advance(100);

    expect(sorted(log.cancels)).toEqual(["a", "b"]);
    expect(log.errors).toEqual([]);
    expect(log.completes).toEqual([]);
    system.destroy();
  });
});

describe("a whole-batch failure retries the batch and reports every requirement", () => {
  it("retries after the backoff and tells each requirement about each retry", async () => {
    const h = handler((_ids, _ctx, call) => {
      if (call < 3) {
        throw new Error(`boom${call}`);
      }
    });
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 3, backoff: "exponential", initialDelay: 100 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(1000);

    expect(h.calls).toEqual([
      ["a", "b"],
      ["a", "b"],
      ["a", "b"],
    ]);
    expect(h.times.map((x) => x - h.times[0]!)).toEqual([0, 100, 300]);
    expect(log.retries).toEqual([
      ["a", 2],
      ["b", 2],
      ["a", 3],
      ["b", 3],
    ]);
    expect(sorted(log.completes)).toEqual(["a", "b"]);
    expect(log.errors).toEqual([]);
    system.destroy();
  });

  it("when the attempts run out, errors every requirement once, with the last error", async () => {
    const h = handler((_ids, _ctx, call) => {
      throw new Error(`boom${call}`);
    });
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 2, backoff: "none" },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b", "c"];
    await advance(1000);

    expect(h.calls).toHaveLength(2);
    expect(sorted(log.errors.map(([id]) => id))).toEqual(["a", "b", "c"]);
    for (const [, error] of log.errors) {
      expect((error as Error).message).toBe("boom2");
    }
    expect(log.completes).toEqual([]);
    system.destroy();
  });

  it("stops retrying when shouldRetry says no", async () => {
    const h = handler(() => {
      throw new Error("fatal");
    });
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 3, backoff: "none", shouldRetry: () => false },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(1000);

    expect(h.calls).toHaveLength(1);
    expect(sorted(log.errors.map(([id]) => id))).toEqual(["a", "b"]);
    expect(log.retries).toEqual([]);
    system.destroy();
  });

  it("does not run the batch again once a retry wait finds its requirements aborted", async () => {
    const h = handler(() => {
      throw new Error("boom");
    });
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      retry: { attempts: 3, backoff: "linear", initialDelay: 100 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(50);
    expect(h.calls).toHaveLength(1);
    system.facts.want = [];
    await advance(1000);

    expect(h.calls).toHaveLength(1);
    expect(log.completes).toEqual([]);
    system.destroy();
  });

  it("does not retry a batch that already satisfied its requirement before it failed", async () => {
    const log: Log = { completes: [], errors: [], cancels: [], retries: [] };
    let calls = 0;
    const mod = createModule("own", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (f: any) => {
        f.go = false;
        f.done = false;
      },
      constraints: {
        load: {
          when: (f: any) => f.go && !f.done,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          batch: { enabled: true, windowMs: 10 },
          retry: { attempts: 3, backoff: "linear", initialDelay: 100 },
          resolveBatch: async (_reqs: unknown, ctx: any) => {
            calls++;
            ctx.facts.done = true;
            throw new Error("failed after writing");
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "rec",
          onResolverComplete: (_r: string, req: { id: string }) => {
            log.completes.push(req.id);
          },
          onResolverError: (_r: string, req: { id: string }, e: unknown) => {
            log.errors.push([req.id, e]);
          },
          onResolverRetry: (_r: string, req: { id: string }, n: number) => {
            log.retries.push([req.id, n]);
          },
        },
      ],
    } as never) as any;
    system.start();
    system.facts.go = true;
    await advance(2000);

    expect(system.facts.done).toBe(true);
    expect(calls).toBe(1);
    expect(log.errors).toHaveLength(1);
    expect(log.retries).toEqual([]);
    system.destroy();
  });
});

describe("a batch that never settles times out", () => {
  it.each(["resolveBatch", "resolveBatchWithResults"])(
    "%s: batch.timeoutMs fails every requirement, and wins over the resolver timeout",
    async (kind) => {
      const { system, log } = build({
        batch: { enabled: true, windowMs: 10, timeoutMs: 100 },
        timeout: 5000,
        [kind]: () => new Promise(() => {}),
      });
      system.facts.want = ["a", "b"];
      await advance(105);
      expect(log.errors).toEqual([]);
      await advance(20);

      expect(sorted(log.errors.map(([id]) => id))).toEqual(["a", "b"]);
      expect(log.errors[0]![1]).toBeInstanceOf(Error);
      expect(log.completes).toEqual([]);
      system.destroy();
    },
  );

  it.each(["resolveBatch", "resolveBatchWithResults"])(
    "%s: with no batch.timeoutMs, the resolver timeout applies",
    async (kind) => {
      const { system, log } = build({
        batch: { enabled: true, windowMs: 10 },
        timeout: 200,
        [kind]: () => new Promise(() => {}),
      });
      system.facts.want = ["a", "b"];
      await advance(205);
      expect(log.errors).toEqual([]);
      await advance(20);

      expect(sorted(log.errors.map(([id]) => id))).toEqual(["a", "b"]);
      system.destroy();
    },
  );
});

describe("the batch window", () => {
  it("by default collects requirements raised close together into one call and runs ones raised later in another", async () => {
    const h = handler();
    const { system, log } = build({
      batch: { enabled: true },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(1);
    system.facts.want = ["a", "b", "c"];
    await advance(1);
    // Nothing has run yet: the default window is not zero.
    expect(h.calls).toEqual([]);

    await advance(5000);
    expect(h.calls).toEqual([["a", "b", "c"]]);
    expect(sorted(log.completes)).toEqual(["a", "b", "c"]);

    system.facts.want = ["a", "b", "c", "d"];
    await advance(5000);
    expect(h.calls).toEqual([["a", "b", "c"], ["d"]]);
    expect(sorted(log.completes)).toEqual(["a", "b", "c", "d"]);
    system.destroy();
  });

  it("windowMs holds requirements back until it has passed", async () => {
    const h = handler();
    const { system } = build({
      batch: { enabled: true, windowMs: 100 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(99);
    expect(h.calls).toEqual([]);
    await advance(1);

    expect(h.calls).toEqual([["a", "b"]]);
    system.destroy();
  });

  it("maxSize runs a full batch at once and leaves the rest to the window", async () => {
    const h = handler();
    const { system } = build({
      batch: { enabled: true, windowMs: 5000, maxSize: 3 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(10);
    // Two of three: still waiting.
    expect(h.calls).toEqual([]);

    system.facts.want = ["a", "b", "c", "d", "e", "f", "g"];
    await advance(10);
    expect(h.calls).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);

    await advance(5000);
    expect(h.calls).toEqual([["a", "b", "c"], ["d", "e", "f"], ["g"]]);
    system.destroy();
  });

  it("takes a retracted requirement out of the batch before it runs", async () => {
    const h = handler();
    const { system, log } = build({
      batch: { enabled: true, windowMs: 100 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b", "c"];
    await advance(10);
    system.facts.want = ["a", "c"];
    await advance(10);
    expect(log.cancels).toEqual(["b"]);

    await advance(500);
    expect(h.calls).toEqual([["a", "c"]]);
    expect(sorted(log.completes)).toEqual(["a", "c"]);
    expect(log.cancels).toEqual(["b"]);
    system.destroy();
  });

  it("never runs the handler with no requirements when the only queued one is retracted", async () => {
    const h = handler();
    const { system, log } = build({
      batch: { enabled: true, windowMs: 100 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a"];
    await advance(10);
    system.facts.want = [];
    await advance(1000);

    expect(h.calls).toEqual([]);
    expect(log.cancels).toEqual(["a"]);
    expect(log.completes).toEqual([]);
    system.destroy();
  });

  it("settle() runs a queued batch now instead of waiting out the window", async () => {
    const h = handler();
    const { system, log } = build({
      batch: { enabled: true, windowMs: 600_000 },
      resolveBatch: h.fn,
    });
    const start = Date.now();
    system.facts.want = ["a", "b"];
    const settled = system.settle();
    await advance(10);
    await settled;

    expect(h.calls).toEqual([["a", "b"]]);
    expect(sorted(log.completes)).toEqual(["a", "b"]);
    expect(Date.now() - start).toBeLessThan(1000);
    system.destroy();
  });
});

describe("stopping or destroying a system ends batched work", () => {
  it.each(["stop", "destroy"] as const)(
    "%s() cancels the requirements of a queued batch and the handler never runs, even through settle()",
    async (how) => {
      const h = handler();
      const { system, log } = build({
        batch: { enabled: true, windowMs: 100 },
        resolveBatch: h.fn,
      });
      system.facts.want = ["a", "b"];
      await advance(10);
      system[how]();

      expect(sorted(log.cancels)).toEqual(["a", "b"]);
      await advance(1000);
      if (how === "stop") {
        await system.settle();
      }
      expect(h.calls).toEqual([]);
      expect(log.completes).toEqual([]);
    },
  );

  it.each(["stop", "destroy"] as const)(
    "%s() aborts a batch that is running and cancels each of its requirements once",
    async (how) => {
      const g = gate();
      const h = handler(async () => {
        await g.promise;
      });
      const { system, log } = build({
        batch: { enabled: true, windowMs: 10 },
        resolveBatch: h.fn,
      });
      system.facts.want = ["a", "b", "c"];
      await advance(20);
      expect(h.calls).toEqual([["a", "b", "c"]]);
      expect(h.contexts[0].signal.aborted).toBe(false);

      system[how]();
      expect(h.contexts[0].signal.aborted).toBe(true);
      expect(sorted(log.cancels)).toEqual(["a", "b", "c"]);

      g.open();
      await advance(100);
      expect(sorted(log.cancels)).toEqual(["a", "b", "c"]);
      expect(log.completes).toEqual([]);
      expect(log.errors).toEqual([]);
    },
  );

  it("a second stop() does not cancel a batch that the first stop() already canceled", async () => {
    const g = gate();
    const h = handler(async () => {
      await g.promise;
    });
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b"];
    await advance(20);
    system.stop();
    expect(sorted(log.cancels)).toEqual(["a", "b"]);

    // The first batch is still running (it ignores its signal). A new one starts.
    system.start();
    system.facts.want = ["a", "b", "c"];
    await advance(20);
    expect(h.calls).toEqual([["a", "b"], ["c"]]);
    system.stop();

    expect(sorted(log.cancels)).toEqual(["a", "b", "c"]);
    g.open();
    await advance(100);
    system.destroy();
  });

  it("a batch that is running when the system stops does not take its requirement away from the new batch", async () => {
    const g = gate();
    const log: Log = { completes: [], errors: [], cancels: [], retries: [] };
    let call = 0;
    const mod = createModule("own", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (f: any) => {
        f.go = false;
        f.done = false;
      },
      constraints: {
        load: {
          when: (f: any) => f.go && !f.done,
          require: { type: "LOAD" },
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          batch: { enabled: true, windowMs: 10 },
          resolveBatch: async (_reqs: unknown, ctx: any) => {
            call++;
            if (call === 1) {
              await g.promise;

              return;
            }
            ctx.facts.done = true;
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "rec",
          onResolverComplete: (_r: string, req: { id: string }) => {
            log.completes.push(req.id);
          },
          onResolverCancel: (_r: string, req: { id: string }) => {
            log.cancels.push(req.id);
          },
        },
      ],
    } as never) as any;
    system.start();
    system.facts.go = true;
    await advance(20);
    system.stop();
    system.start();
    system.facts.go = false;
    await advance(20);
    system.facts.go = true;
    await advance(50);

    // The second batch wrote the fact that made its own requirement go away:
    // it satisfied the requirement. The first, aborted batch is no part of it.
    expect(call).toBe(2);
    expect(system.facts.done).toBe(true);
    expect(log.completes).toHaveLength(1);
    expect(log.cancels).toHaveLength(1);
    g.open();
    await advance(100);
    system.destroy();
  });
});

describe("retracting every requirement of a running batch aborts it", () => {
  it("aborts the handler's signal and cancels each requirement once", async () => {
    const g = gate();
    const h = handler(async () => {
      await g.promise;
    });
    const { system, log } = build({
      batch: { enabled: true, windowMs: 10 },
      resolveBatch: h.fn,
    });
    system.facts.want = ["a", "b", "c"];
    await advance(20);
    expect(h.contexts[0].signal.aborted).toBe(false);

    system.facts.want = [];
    await advance(10);
    expect(h.contexts[0].signal.aborted).toBe(true);
    expect(sorted(log.cancels)).toEqual(["a", "b", "c"]);

    g.open();
    await advance(100);
    expect(sorted(log.cancels)).toEqual(["a", "b", "c"]);
    expect(log.completes).toEqual([]);
    expect(log.errors).toEqual([]);
    system.destroy();
  });
});

describe("abortOn on a batched resolver", () => {
  function buildBound(constraints: "one" | "mixed") {
    const g = gate();
    let signal: AbortSignal | undefined;
    const rejections: Array<Record<string, unknown>> = [];
    const mod = createModule("bound", {
      schema: {
        facts: { go: t.boolean(), mark: t.number(), result: t.number() },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (f: any) => {
        f.go = false;
        f.mark = 0;
        f.result = 0;
      },
      constraints: {
        bound: {
          when: (f: any) => f.go,
          require: { type: "FETCH", id: "a" },
          abortOn: ["mark"],
        },
        ...(constraints === "mixed"
          ? {
              free: {
                when: (f: any) => f.go,
                require: { type: "FETCH", id: "b" },
              },
            }
          : {}),
      },
      resolvers: {
        fetch: {
          requirement: "FETCH",
          key: (req: { id: string }) => req.id,
          batch: { enabled: true, windowMs: 10 },
          resolveBatch: async (_reqs: unknown, ctx: any) => {
            signal = ctx.signal;
            await g.promise;
            ctx.facts.result = 1;
            ctx.facts.mark = 7;
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "rec",
          onResolverWriteRejected: (event: Record<string, unknown>) => {
            rejections.push(event);
          },
        },
      ],
    } as never) as any;
    system.start();

    return { system, g, rejections, signal: () => signal };
  }

  it("rejects the batch's later writes to an abortOn fact that changed meanwhile", async () => {
    const { system, g, rejections, signal } = buildBound("one");
    system.facts.go = true;
    await advance(20);
    system.facts.mark = 50;
    await advance(10);
    g.open();
    await advance(10);

    expect(signal()?.aborted).toBe(true);
    expect(system.facts.mark).toBe(50);
    expect(system.facts.result).toBe(1);
    expect(rejections.filter((e) => e.kind === "rejection")).toHaveLength(1);
    system.destroy();
  });

  it("does not bind a batch that mixes requirements from different constraints", async () => {
    const { system, g, rejections, signal } = buildBound("mixed");
    system.facts.go = true;
    await advance(20);
    system.facts.mark = 50;
    await advance(10);
    g.open();
    await advance(10);

    expect(signal()?.aborted).toBe(false);
    expect(system.facts.mark).toBe(7);
    expect(rejections).toEqual([]);
    system.destroy();
  });
});
