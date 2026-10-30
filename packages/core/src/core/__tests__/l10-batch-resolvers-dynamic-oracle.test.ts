import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

// Black-box tests for batched resolvers that are registered, replaced and
// unregistered while a system runs (L10): what unregistering a batched
// resolver does to a batch that is queued or already running, and how long
// unregistering a module waits for a batch it aborted. Public API only; a
// plugin observes the resolver hooks.

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const sorted = (xs: string[]) => [...xs].sort();

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { promise, open };
}

interface Log {
  completes: string[];
  cancels: string[];
}

function recorder() {
  const log: Log = { completes: [], cancels: [] };
  const plugin = {
    name: "rec",
    onResolverComplete: (_resolver: string, req: { id: string }) => {
      log.completes.push(req.id);
    },
    onResolverCancel: (_resolver: string, req: { id: string }) => {
      log.cancels.push(req.id);
    },
  };

  return { log, plugin };
}

/** A module whose `want` fact lists the ids to fetch, with no FETCH resolver. */
function fetcher() {
  return createModule("m", {
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
  } as never);
}

function batchHandler(
  impl?: (ids: string[], ctx: any) => Promise<unknown> | unknown,
) {
  const calls: string[][] = [];
  const contexts: any[] = [];
  const fn = async (reqs: Array<{ id: string }>, ctx: any) => {
    calls.push(reqs.map((r) => r.id));
    contexts.push(ctx);

    return impl?.(
      reqs.map((r) => r.id),
      ctx,
    );
  };

  return { calls, contexts, fn };
}

describe("unregistering a batched resolver", () => {
  function build(resolveBatch: unknown) {
    const { log, plugin } = recorder();
    const system = createSystem({
      module: fetcher(),
      plugins: [plugin],
    } as never) as any;
    system.start();
    system.resolvers.register("fetch", {
      requirement: "FETCH",
      key: (req: { id: string }) => req.id,
      batch: { enabled: true, windowMs: 100 },
      resolveBatch,
    });

    return { system, log };
  }

  it("cancels the requirements still queued, and the handler never runs", async () => {
    const h = batchHandler();
    const { system, log } = build(h.fn);
    system.facts.want = ["a", "b"];
    await advance(10);
    expect(h.calls).toEqual([]);

    system.resolvers.unregister("fetch");
    expect(sorted(log.cancels)).toEqual(["a", "b"]);

    await advance(1000);
    expect(h.calls).toEqual([]);
    expect(log.completes).toEqual([]);
    system.destroy();
  });

  it("is a clean slate for a resolver registered under the same id afterwards", async () => {
    const first = batchHandler();
    const { system, log } = build(first.fn);
    system.facts.want = ["a", "b"];
    await advance(10);
    system.resolvers.unregister("fetch");

    const second = batchHandler();
    system.resolvers.register("fetch", {
      requirement: "FETCH",
      key: (req: { id: string }) => req.id,
      batch: { enabled: true, windowMs: 100 },
      resolveBatch: second.fn,
    });
    system.facts.want = [];
    await advance(10);
    system.facts.want = ["c"];
    await advance(1000);

    // Nothing queued under the old resolver reaches the new one.
    expect(first.calls).toEqual([]);
    expect(second.calls).toEqual([["c"]]);
    expect(log.completes).toEqual(["c"]);
    system.destroy();
  });

  it("aborts a batch that is running, and what it returns afterwards completes nothing", async () => {
    const g = gate();
    const h = batchHandler(async () => {
      await g.promise;
    });
    const { system, log } = build(h.fn);
    system.facts.want = ["a", "b"];
    await advance(150);
    expect(h.calls).toEqual([["a", "b"]]);
    expect(h.contexts[0].signal.aborted).toBe(false);

    system.resolvers.unregister("fetch");
    expect(h.contexts[0].signal.aborted).toBe(true);

    g.open();
    await advance(100);
    expect(log.completes).toEqual([]);
    system.destroy();
  });

  it("leaves another batched resolver's queue and running batch alone", async () => {
    const { log, plugin } = recorder();
    const mod = createModule("two", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { ONE: {}, TWO: {} },
      },
      init: (f: any) => {
        f.go = false;
      },
      constraints: {
        one: { when: (f: any) => f.go, require: { type: "ONE" } },
        two: { when: (f: any) => f.go, require: { type: "TWO" } },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [plugin],
    } as never) as any;
    system.start();
    const kept = batchHandler();
    system.resolvers.register("one", {
      requirement: "ONE",
      batch: { enabled: true, windowMs: 100 },
      resolveBatch: kept.fn,
    });
    system.resolvers.register("two", {
      requirement: "TWO",
      batch: { enabled: true, windowMs: 100 },
      resolveBatch: async () => {},
    });
    system.facts.go = true;
    await advance(10);
    system.resolvers.unregister("two");
    await advance(1000);

    expect(kept.calls).toHaveLength(1);
    expect(log.completes).toHaveLength(1);
    expect(log.cancels).toHaveLength(1);
    system.destroy();
  });
});

describe("unregistering a module that owns a batched resolver", () => {
  function build(resolveBatch: unknown) {
    const keep = createModule("keep", {
      schema: { facts: { k: t.number() } },
      init: () => {},
    });
    const gone = createModule("gone", {
      schema: {
        facts: { go: t.boolean() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (f: any) => {
        f.go = false;
      },
      constraints: {
        load: { when: (f: any) => f.go, require: { type: "LOAD" } },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          batch: { enabled: true, windowMs: 10 },
          resolveBatch,
        },
      },
    } as never);
    const system = createSystem({ module: keep } as never) as any;
    system.start();
    system.registerModule(gone as never);

    return system;
  }

  it("waits for the batch it aborted to finish before it resolves", async () => {
    const g = gate();
    const h = batchHandler(async () => {
      await g.promise;
    });
    const system = build(h.fn);
    system.facts.go = true;
    await advance(50);
    expect(h.calls).toHaveLength(1);

    let done = false;
    const unregistered = system.unregisterModule("gone").then(() => {
      done = true;
    });
    expect(h.contexts[0].signal.aborted).toBe(true);
    await advance(1000);
    expect(done).toBe(false);

    g.open();
    await advance(10);
    await unregistered;
    expect(done).toBe(true);
    await system.stop();
  });

  it("gives up waiting on a batch that ignores its signal and never settles, and names the resolver in a warning", async () => {
    const h = batchHandler(() => new Promise(() => {}));
    const system = build(h.fn);
    system.facts.go = true;
    await advance(50);
    expect(h.calls).toHaveLength(1);

    let done = false;
    const unregistered = system.unregisterModule("gone").then(() => {
      done = true;
    });
    await advance(1000);
    expect(done).toBe(false);

    await advance(120_000);
    await unregistered;
    expect(done).toBe(true);
    expect(
      warn.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes("load"),
      ),
    ).toBe(true);
    await system.stop();
  });
});
