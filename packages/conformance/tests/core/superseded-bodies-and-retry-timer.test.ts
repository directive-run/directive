// Ported from packages/core/src/core/__tests__/superseded-bodies-and-retry-timer.test.ts by packages/conformance/scripts/port.ts.
// Do not edit by hand: change the original and re-run the port.

import { engineDistEntry } from "../../helpers/engine.js";
/**
 * Late writes from runs that left the in-flight set keep landing (RFC 0003):
 * timed out, canceled or detached, their writes — `finally` blocks
 * included — are theirs to make. Only a run superseded while still in
 * flight has its later writes dropped. Results here match 78d2d131.
 *
 * The retry-later poller stops when nothing is left to retry, and never
 * keeps a Node process alive on its own.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createModule, createSystem, t } from "@directive-run/core";
import { describe, expect, it, vi } from "vitest";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const here = dirname(fileURLToPath(import.meta.url));

function loadSystem(
  resolver: Record<string, unknown>,
  constraint: Record<string, unknown> = {},
) {
  const mod = createModule("m", {
    schema: {
      facts: {
        go: t.boolean(),
        done: t.boolean(),
        status: t.string(),
        loading: t.boolean(),
        log: t.array<number>(),
        data: t.string(),
      },
      derivations: {},
      events: {},
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.go = false;
      facts.done = false;
      facts.status = "idle";
      facts.loading = false;
      facts.log = [];
      facts.data = "";
    },
    constraints: {
      load: {
        when: (facts: any) => facts.go && !facts.done,
        require: { type: "LOAD" },
        ...constraint,
      },
    },
    resolvers: { load: { requirement: "LOAD", ...resolver } },
  } as never);
  const system: any = createSystem({ module: mod });
  system.start();

  return system;
}

describe("late writes from runs no longer in flight still land", () => {
  it("a timed-out run's late write lands after its replacement (K2, resolver's job to guard)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const system = loadSystem({
      timeout: 10,
      resolve: async (_req: unknown, context: any) => {
        const k = ++n;
        context.facts.done = true;
        await sleep(k === 1 ? 60 : 5);
        context.facts.data = `r${k}`;
      },
    });
    system.facts.go = true;
    await sleep(20);
    system.facts.done = false;
    await sleep(20);
    expect(system.facts.data).toBe("r2");
    await sleep(60);
    // Run 1 timed out and left; its late write lands. Guard with
    // context.signal.aborted (it is aborted) or abortOn.
    expect(system.facts.data).toBe("r1");
    system.destroy();
    vi.restoreAllMocks();
  });

  it("a detached bound run's writes land (M1)", async () => {
    let n = 0;
    const system = loadSystem(
      {
        resolve: async (_req: unknown, context: any) => {
          const k = ++n;
          await sleep(k === 1 ? 30 : 5);
          context.facts.log = [...context.facts.log, k];
        },
      },
      { when: (facts: any) => facts.go, abortOn: ["status"] },
    );
    system.facts.go = true;
    await sleep(5);
    system.facts.go = false;
    await sleep(5);
    system.facts.go = true;
    await sleep(60);
    expect(system.facts.log).toEqual([2, 1]);
    expect(n).toBe(2);
    system.destroy();
  });

  it("a detached bound run that checks its signal still writes (M1b)", async () => {
    let n = 0;
    const system = loadSystem(
      {
        resolve: async (_req: unknown, context: any) => {
          const k = ++n;
          await sleep(k === 1 ? 30 : 5);
          if (context.signal.aborted) {
            return;
          }
          context.facts.data = `won-by-${k}`;
        },
      },
      { when: (facts: any) => facts.go, abortOn: ["status"] },
    );
    system.facts.go = true;
    await sleep(5);
    system.facts.go = false;
    await sleep(5);
    system.facts.go = true;
    await sleep(60);
    expect(system.facts.data).toBe("won-by-1");
    system.destroy();
  });

  function guardedOnLoading(extra: Record<string, unknown> = {}) {
    let n = 0;
    const system = loadSystem(
      {
        ...extra,
        resolve: async (_req: unknown, context: any) => {
          const k = ++n;
          if (context.facts.loading) {
            return;
          }
          try {
            context.facts.loading = true;
            await sleep(20);
            context.facts.data = `d${k}`;
          } finally {
            context.facts.loading = false;
          }
        },
      },
      { when: (facts: any) => facts.go },
    );

    return { system, runs: () => n };
  }

  it("canceled, re-dispatched, new run guarded on loading: the old finally lands (M2)", async () => {
    const { system, runs } = guardedOnLoading();
    system.facts.go = true;
    await sleep(2);
    system.facts.go = false;
    await sleep(2);
    system.facts.go = true;
    await sleep(60);
    expect(system.facts.loading).toBe(false);
    expect(system.facts.data).toBe("d1");
    expect(runs()).toBe(2);
    system.destroy();
  });

  it("timed out, re-dispatched, new run guarded on loading: the old finally lands (M3)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { system, runs } = guardedOnLoading({ timeout: 5 });
    system.facts.go = true;
    await sleep(10);
    system.facts.go = false;
    await sleep(0);
    system.facts.go = true;
    await sleep(60);
    expect(system.facts.loading).toBe(false);
    expect(system.facts.data).toBe("d1");
    expect(runs()).toBe(2);
    system.destroy();
    vi.restoreAllMocks();
  });
});

describe("the retry-later poller", () => {
  it("stops polling once nothing is left to retry (K5)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const realSetInterval = globalThis.setInterval;
    let wakes = 0;
    (globalThis as any).setInterval = (fn: () => void, ms: number) =>
      realSetInterval(() => {
        wakes++;
        fn();
      }, ms);
    let calls = 0;
    const mod = createModule("m", {
      schema: {
        facts: { x: t.number() },
        derivations: {},
        events: {},
        requirements: { R: {} },
      },
      init: (facts: any) => {
        facts.x = 0;
      },
      constraints: {
        c: {
          when: () => {
            calls++;
            if (calls === 1) {
              throw new Error("transient");
            }

            return true;
          },
          require: { type: "R" },
        },
      },
      resolvers: {
        r: {
          requirement: "R",
          resolve: async (_req: unknown, context: any) => {
            context.facts.x = 1;
          },
        },
      },
    } as never);
    const system: any = createSystem({
      module: mod,
      errorBoundary: { onConstraintError: "retry-later" },
    } as never);
    try {
      system.start();
      await sleep(1700);
      expect(system.facts.x).toBe(1);
      const afterRetry = wakes;
      await sleep(1200);
      expect(wakes).toBe(afterRetry);
    } finally {
      (globalThis as any).setInterval = realSetInterval;
      system.destroy();
      vi.restoreAllMocks();
    }
  });

  it("does not keep the process alive", () => {
    // CI builds every package before running tests. Fail loudly rather than
    // pass by skipping if that order ever changes.
    const dist = engineDistEntry();
    expect(
      existsSync(dist),
      "packages/core/dist is missing: run `pnpm --filter @directive-run/core build` before this test",
    ).toBe(true);
    // A constraint that throws on every evaluation keeps a retry pending,
    // so the poller is running for the whole life of the process.
    const script = `
      const { createModule, createSystem, t } = await import(${JSON.stringify(dist)});
      const mod = createModule("m", {
        schema: { facts: { x: t.number() }, derivations: {}, events: {}, requirements: { R: {} } },
        init: (f) => { f.x = 0; },
        constraints: { c: { when: () => { throw new Error("always"); }, require: { type: "R" } } },
        resolvers: { r: { requirement: "R", resolve: async () => {} } },
      });
      const s = createSystem({ module: mod, errorBoundary: { onConstraintError: "retry-later", retryLater: { delayMs: 250, maxRetries: 1000 } } });
      s.start();
      setTimeout(() => { globalThis.__polling = true; }, 600);
    `;
    const started = Date.now();
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        timeout: 4000,
        env: { ...process.env, NODE_ENV: "production" },
      },
    );
    expect(result.signal).toBeNull();
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
