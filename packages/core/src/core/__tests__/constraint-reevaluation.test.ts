/**
 * When a constraint is asked again. A pass that changed no fact a
 * constraint reads carries its last answer forward, so every other reason
 * to re-ask has to be explicit:
 *
 * - a `when` that threw keeps the dependencies it read before throwing, so
 *   the write that fixes it wakes it;
 * - an async `when` with no `deps` is evaluated on every pass, since its
 *   reads past the first `await` cannot be tracked;
 * - a constraint retried by the `retry-later` error strategy is re-asked by
 *   name;
 * - `start()` re-asks every constraint.
 *
 * A `when` must otherwise be a pure function of facts and derivations: time
 * and outside state belong in a fact or a source.
 */

import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function module(extra: {
  facts?: Record<string, unknown>;
  init?: (facts: any) => void;
  constraints: Record<string, unknown>;
  resolve: () => void;
}) {
  return createModule("m", {
    schema: {
      facts: { n: t.number(), ...(extra.facts ?? {}) },
      derivations: {},
      events: {},
      requirements: { EXT: {} },
    },
    init: (facts: any) => {
      facts.n = 0;
      extra.init?.(facts);
    },
    constraints: extra.constraints,
    resolvers: {
      ext: {
        requirement: "EXT",
        resolve: async () => {
          extra.resolve();
        },
      },
    },
  } as never);
}

describe("constraint re-evaluation", () => {
  it("a when that threw is woken by the write that fixes it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    let runs = 0;
    const system: any = createSystem({
      module: module({
        facts: { items: t.array<any>() },
        init: (facts) => {
          facts.items = [];
        },
        constraints: {
          greet: {
            when: (facts: any) => facts.items[0].name.length > 0,
            require: { type: "EXT" },
          },
        },
        resolve: () => {
          runs++;
        },
      }),
    });
    system.start();
    await sleep(5);
    system.facts.items = [{ name: "x" }];
    await sleep(10);
    expect(runs).toBe(1);
    system.destroy();
    vi.restoreAllMocks();
  });

  it("an async when without deps is evaluated on every pass", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    const system: any = createSystem({
      module: module({
        facts: { ready: t.boolean() },
        init: (facts) => {
          facts.ready = false;
        },
        constraints: {
          ext: {
            async: true,
            when: async (facts: any) => facts.ready,
            require: { type: "EXT" },
          },
        },
        resolve: () => {
          runs++;
        },
      }),
    });
    system.start();
    await sleep(5);
    system.facts.ready = true;
    await sleep(10);
    expect(runs).toBe(1);
    system.destroy();
    vi.restoreAllMocks();
  });

  it("retry-later re-evaluates the constraint that threw", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    let calls = 0;
    let runs = 0;
    const system: any = createSystem({
      module: module({
        constraints: {
          ext: {
            when: () => {
              calls++;
              if (calls === 1) {
                throw new Error("transient");
              }

              return true;
            },
            require: { type: "EXT" },
          },
        },
        resolve: () => {
          runs++;
        },
      }),
      errorBoundary: {
        onConstraintError: "retry-later",
        retryLater: { delayMs: 250 },
      },
    } as never);
    system.start();
    await sleep(900);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(runs).toBe(1);
    system.destroy();
    vi.restoreAllMocks();
  });

  it("start() re-evaluates every constraint", async () => {
    let external = false;
    let runs = 0;
    const system: any = createSystem({
      module: module({
        constraints: {
          ext: { when: () => external, require: { type: "EXT" } },
        },
        resolve: () => {
          runs++;
        },
      }),
    });
    system.start();
    await sleep(10);
    system.stop();
    external = true;
    system.start();
    await sleep(20);
    expect(runs).toBe(1);
    system.destroy();
  });
});

describe("a resolver that fails after satisfying its requirement", () => {
  it("passes on the original error", async () => {
    class LoadError extends Error {}
    const seen: unknown[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
            context.facts.done = true;
            await sleep(20);
            throw new LoadError("upstream 503");
          },
        },
      },
    });
    const system: any = createSystem({
      module: mod,
      plugins: [
        {
          name: "watch",
          onResolverError: (_id: string, _req: unknown, error: unknown) => {
            seen.push(error);
          },
        },
      ],
    });
    system.start();
    system.facts.go = true;
    await sleep(100);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(LoadError);
    expect((seen[0] as Error).message).toBe("upstream 503");
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("stays unmet")),
    ).toBe(false);
    system.destroy();
    vi.restoreAllMocks();
  });
});
