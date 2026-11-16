/**
 * L8c: a pass still running when destroy() is called reports to plugins.
 *
 * 1.35's destroy() never detaches its plugins, so every hook a pass in flight
 * fires afterwards still reaches them. core-next's destroy() removes the
 * kernel's listeners; the core's own records then go straight to the plugins
 * (its tail), and the reconcile and effects parts now use that same path. The
 * fuzz case 24301 (up to L8, #1097) found the reconcile part dropping
 * `requirement.created` while `reconcile.end` still arrived.
 *
 * A resolver run's own records stay on the kernel's stream, which destroy()
 * closes: two owner rows say 2.0 reports nothing of a run after destroy().
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { withEffects } from "../api/effects.js";
import { createModule as createFullModule } from "../api/module.js";
import { withObserve } from "../api/observe.js";
import { withPlugins } from "../api/plugins.js";
import { withReconcile } from "../api/reconcile.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";
import { createVirtualClock } from "../clock.js";
import { createScheduler } from "../scheduler.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Let microtasks and the scheduler's flushes run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => {
    open = r;
  });

  return { promise, open };
}

describe("hooks after destroy() (1.35 parity)", () => {
  it("a pass suspended in constraint evaluation reports its requirements, then its end", async () => {
    const g = gate();
    const seen: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { want: t.boolean() } },
      init: (f: any) => {
        f.want = true;
      },
      constraints: {
        c: {
          async: true,
          deps: ["want"],
          when: async (f: any) => {
            await g.promise;

            return f.want;
          },
          require: { type: "R" },
        },
      },
      resolvers: { r: { requirement: "R", resolve: async () => {} } },
    } as never);
    const system = createSystemCore(
      { module: mod } as never,
      [
        withObserve,
        withReconcile,
        withPlugins([
          {
            name: "p",
            onRequirementCreated: (req: { id: string }) =>
              seen.push(`created ${req.id}`),
            // 1.35 also dispatches R's resolver here; core-next leaves it for
            // start() (reconcile.ts). No row signs that difference yet (a
            // follow-up), so this test compares only the hooks it lists.
            onReconcileEnd: () => seen.push("end"),
          } as never,
        ]),
      ],
      { clock: createVirtualClock(), scheduler: createScheduler() },
    ) as any;
    system.observe((e: { type: string; id?: string }) => {
      if (e.type === "requirement.created") {
        seen.push(`observed ${e.id}`);
      }
    });
    system.start();
    await flush();
    // The first pass waits in `c`'s evaluation.
    expect(seen).toEqual([]);
    system.destroy();
    g.open();
    await flush();
    await flush();
    expect(seen).toEqual(["created R:{}", "observed R:{}", "end"]);
  });

  it("an async effect that fails after destroy() reports onEffectError", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const g = gate();
    const seen: string[] = [];
    const mod = createModule("m", {
      schema: { facts: { x: t.number() } },
      init: (f: any) => {
        f.x = 0;
      },
      effects: {
        e: {
          deps: ["x"],
          run: async () => {
            await g.promise;
            throw new Error("late");
          },
        },
      },
    } as never);
    const system = createSystemCore(
      { module: mod } as never,
      [
        withEffects,
        withPlugins([
          {
            name: "p",
            onEffectRun: (id: string) => seen.push(`run ${id}`),
            onEffectError: (id: string, error: Error) =>
              seen.push(`error ${id} ${error.message}`),
          } as never,
        ]),
      ],
      { clock: createVirtualClock(), scheduler: createScheduler() },
    ) as any;
    system.start();
    await flush();
    expect(seen).toEqual(["run e"]);
    system.destroy();
    g.open();
    await flush();
    await flush();
    expect(seen).toEqual(["run e", "error e late"]);
  });
  // Owner row, the let-go row (Jason, 2026-11-11): "Approve 2.0's
  // (Recommended)". After destroy(), a let-go single run that later
  // finishes reports nothing on 2.0; 1.35 reports it complete and its
  // requirement met.
  it("a let-go run that finishes after destroy() reports no complete or met", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const mod = createFullModule("m", {
      schema: {
        facts: { go: t.boolean(), value: t.number() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (f: any) => {
        f.go = false;
        f.value = 0;
      },
      constraints: {
        load: {
          when: (f: any) => f.go,
          require: { type: "LOAD" },
          // Bound: retracting the requirement detaches the run (let go).
          abortOn: ["value"],
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          resolve: async (_req: unknown, ctx: any) => {
            await new Promise((r) => setTimeout(r, 50));
            ctx.facts.value = 1;
            seen.push("done");
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "p",
          onResolverStart: (resolver: string) => seen.push(`start ${resolver}`),
          onResolverComplete: (resolver: string) =>
            seen.push(`complete ${resolver}`),
          onRequirementMet: (req: { id: string }) => seen.push(`met ${req.id}`),
        } as never,
      ],
    });
    system.start();
    (system.facts as any).go = true;
    await vi.advanceTimersByTimeAsync(5);
    (system.facts as any).go = false; // retracted: the run is let go
    await vi.advanceTimersByTimeAsync(1);
    system.destroy();
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(["start load", "done"]);
  });

  // Owner row 352 (Jason, 2026-11-10): "Approve 2.0's (Recommended)". After
  // destroy(), an aborted batch's late write produces no hook on 2.0; 1.35
  // reports it as clobbered.
  it("an aborted batch's late write after destroy() reports no onResolverWriteRejected", async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const mod = createFullModule("m", {
      schema: {
        facts: { go: t.boolean(), value: t.number() },
        derivations: {},
        events: {},
        requirements: { LOAD: {} },
      },
      init: (f: any) => {
        f.go = false;
        f.value = 0;
      },
      constraints: {
        load: {
          when: (f: any) => f.go,
          require: { type: "LOAD" },
          abortOn: ["value"],
        },
      },
      resolvers: {
        load: {
          requirement: "LOAD",
          batch: { enabled: true, windowMs: 0, maxSize: 1 },
          // Ignores its abort: writes late, after destroy() aborted it.
          resolveBatch: async (_reqs: unknown[], ctx: any) => {
            await new Promise((r) => setTimeout(r, 50));
            ctx.facts.value = 1;
            seen.push("wrote");
          },
        },
      },
    } as never);
    const system = createSystem({
      module: mod,
      plugins: [
        {
          name: "p",
          onResolverCancel: (resolver: string) =>
            seen.push(`cancel ${resolver}`),
          onResolverWriteRejected: (e: { reason: string }) =>
            seen.push(`rejected ${e.reason}`),
        } as never,
      ],
    });
    system.start();
    (system.facts as any).go = true;
    await vi.advanceTimersByTimeAsync(5);
    // Another writer changes the bound key: the batch's write is clobbered.
    (system.facts as any).value = 5;
    await vi.advanceTimersByTimeAsync(1);
    system.destroy();
    await vi.advanceTimersByTimeAsync(100);
    expect(seen).toEqual(["cancel load", "wrote"]);
  });
});
