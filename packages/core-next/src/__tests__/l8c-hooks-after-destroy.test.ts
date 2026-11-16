/**
 * L8c: a pass still running when destroy() is called reports to plugins.
 *
 * 1.35's destroy() never detaches its plugins, so every hook a pass in flight
 * fires afterwards still reaches them. core-next's destroy() removes the
 * kernel's listeners; the core's own records then go straight to the plugins
 * (its tail), and the reconcile and effects parts now use that same path. The
 * fuzz case 24301 (up to L8, #1097) found the reconcile part dropping
 * `requirement.created` while `reconcile.end` still arrived.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModule, createSystemCore } from "../api/core.js";
import { withEffects } from "../api/effects.js";
import { withObserve } from "../api/observe.js";
import { withPlugins } from "../api/plugins.js";
import { withReconcile } from "../api/reconcile.js";
import { t } from "../api/schema-builders.js";
import { createVirtualClock } from "../clock.js";
import { createScheduler } from "../scheduler.js";

afterEach(() => vi.restoreAllMocks());

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
            // 1.35 dispatches R's resolver here and core-next leaves it for
            // start() (reconcile.ts); only the hooks' order is compared.
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
});
