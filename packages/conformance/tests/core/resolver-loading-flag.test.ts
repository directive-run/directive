// Ported from packages/core/src/core/__tests__/resolver-loading-flag.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

/**
 * The common loading-flag pattern must never deadlock: a resolver sets
 * `loading = true`, and its `finally` sets it back. If that run times out or
 * fails after its own write satisfied its requirement, the `finally` still
 * lands, and the constraint can fire again. (Only a superseded run's writes
 * are dropped.) Also: a `require()` that throws keeps what it read, and
 * `retry-later` retries without a `retryLater` config.
 */

import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function loadSystem(
  resolver: Record<string, unknown>,
  options: { batch?: boolean; when?: (facts: any) => boolean } = {},
) {
  const mod = createModule("m", {
    schema: {
      facts: {
        go: t.boolean(),
        done: t.boolean(),
        loading: t.boolean(),
        data: t.string(),
      },
      derivations: {},
      events: {},
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.go = false;
      facts.done = false;
      facts.loading = false;
      facts.data = "";
    },
    constraints: {
      load: {
        when: options.when ?? ((facts: any) => facts.go && !facts.done),
        require: { type: "LOAD" },
      },
    },
    resolvers: {
      load: {
        requirement: "LOAD",
        ...(options.batch ? { batch: { enabled: true, windowMs: 0 } } : {}),
        ...resolver,
      },
    },
  } as never);
  const system: any = createSystem({ module: mod });
  system.start();

  return system;
}

describe("a loading flag survives a failure after satisfying", () => {
  it("satisfied, then timed out: the finally lands (L4)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = loadSystem({
      timeout: 10,
      resolve: async (_req: unknown, context: any) => {
        try {
          context.facts.loading = true;
          context.facts.done = true;
          await sleep(30);
          context.facts.data = "x";
        } finally {
          context.facts.loading = false;
        }
      },
    });
    system.facts.go = true;
    await sleep(80);
    expect(system.facts.loading).toBe(false);
    system.destroy();
    vi.restoreAllMocks();
  });

  it("a loading guard in when: timeout plus retry does not deadlock (L3)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    const system = loadSystem(
      {
        timeout: 10,
        retry: { attempts: 2, backoff: "none" },
        resolve: async (_req: unknown, context: any) => {
          runs++;
          try {
            context.facts.loading = true;
            await sleep(30);
            context.facts.data = "x";
          } finally {
            context.facts.loading = false;
          }
        },
      },
      {
        when: (facts: any) => facts.go && !facts.loading && facts.data === "",
      },
    );
    system.facts.go = true;
    await sleep(200);
    // Not stuck: the timed-out run's late writes land, so loading clears
    // and its data arrives; nothing is left waiting on a flag.
    expect(system.facts.loading).toBe(false);
    expect(system.facts.data).toBe("x");
    expect(runs).toBe(1);
    system.destroy();
    vi.restoreAllMocks();
  });

  it("a satisfied batch that times out: the finally lands (L10)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const system = loadSystem(
      {
        batch: { enabled: true, windowMs: 0, timeoutMs: 10 },
        resolveBatch: async (_reqs: unknown, context: any) => {
          try {
            context.facts.loading = true;
            context.facts.done = true;
            await sleep(30);
          } finally {
            context.facts.loading = false;
          }
        },
      },
      { batch: true },
    );
    system.facts.go = true;
    await sleep(80);
    expect(system.facts.loading).toBe(false);
    system.destroy();
    vi.restoreAllMocks();
  });
});

describe("constraint errors", () => {
  function extModule(constraint: Record<string, unknown>, onRun: () => void) {
    return createModule("m", {
      schema: {
        facts: { b: t.number(), cfg: t.any() },
        derivations: {},
        events: {},
        requirements: { EXT: { v: t.number() } },
      },
      init: (facts: any) => {
        facts.b = 0;
        facts.cfg = null;
      },
      constraints: { c: constraint },
      resolvers: {
        ext: {
          requirement: "EXT",
          resolve: async () => {
            onRun();
          },
        },
      },
    } as never);
  }

  it("a require() that throws keeps what it read (H1)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let runs = 0;
    const system: any = createSystem({
      module: extModule(
        {
          when: (facts: any) => facts.b > 0,
          require: (facts: any) => ({ type: "EXT", v: facts.cfg.x }),
        },
        () => {
          runs++;
        },
      ),
    });
    system.start();
    await sleep(5);
    system.facts.b = 1;
    await sleep(10);
    expect(runs).toBe(0);
    system.facts.cfg = { x: 1 };
    await sleep(10);
    expect(runs).toBe(1);
    system.destroy();
    vi.restoreAllMocks();
  });

  it("retry-later retries with no retryLater config (H4)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    let runs = 0;
    const system: any = createSystem({
      module: extModule(
        {
          when: () => {
            calls++;
            if (calls === 1) {
              throw new Error("transient");
            }

            return true;
          },
          require: { type: "EXT", v: 1 },
        },
        () => {
          runs++;
        },
      ),
      errorBoundary: { onConstraintError: "retry-later" },
    } as never);
    system.start();
    // Default delay 1000 ms, polled every 500 ms.
    await sleep(1700);
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(runs).toBe(1);
    system.destroy();
    vi.restoreAllMocks();
  });
});
