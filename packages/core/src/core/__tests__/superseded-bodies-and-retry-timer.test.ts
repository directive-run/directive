/**
 * A run that timed out has left the in-flight set, but its body may still
 * be running and writing. If its requirement is dispatched again, that body
 * is superseded: its later writes are dropped, so it cannot overwrite the
 * new run's result.
 *
 * The retry-later poller stops when nothing is left to retry, and never
 * keeps a Node process alive on its own.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { createModule, createSystem, t } from "../../index.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const here = dirname(fileURLToPath(import.meta.url));

describe("a timed-out run whose requirement is dispatched again", () => {
  it("cannot overwrite the new run's result (K2)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const mod = createModule("m", {
      schema: {
        facts: { go: t.boolean(), done: t.boolean(), data: t.string() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (facts: any) => {
        facts.go = false;
        facts.done = false;
        facts.data = "";
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
          timeout: 10,
          resolve: async (_req: unknown, context: any) => {
            const k = ++n;
            context.facts.done = true;
            await sleep(k === 1 ? 60 : 5);
            context.facts.data = `r${k}`;
          },
        },
      },
    } as never);
    const system: any = createSystem({ module: mod });
    system.start();
    system.facts.go = true;
    await sleep(20); // run 1 satisfied, then timed out; its body still runs
    system.facts.done = false; // the requirement returns: run 2
    await sleep(20);
    expect(system.facts.data).toBe("r2");
    await sleep(60); // run 1's body finishes and tries to write
    expect(system.facts.data).toBe("r2");
    expect(n).toBe(2);
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
    const dist = join(here, "../../../dist/index.js");
    if (!existsSync(dist)) {
      return;
    }
    const script = `
      const { createModule, createSystem, t } = await import(${JSON.stringify(dist)});
      const mod = createModule("m", {
        schema: { facts: { x: t.number() }, derivations: {}, events: {}, requirements: { R: {} } },
        init: (f) => { f.x = 0; },
        constraints: { c: { when: () => { throw new Error("always"); }, require: { type: "R" } } },
        resolvers: { r: { requirement: "R", resolve: async () => {} } },
      });
      const s = createSystem({ module: mod, errorBoundary: { onConstraintError: "retry-later" } });
      s.start();
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
