/**
 * stop() and destroy() abort a detached batch run (owner decision (bg),
 * api/resolvers.ts `abortAll_()`).
 *
 * A bound (`abortOn`) requirement retracted while its batch runs detaches
 * the batch: it goes on, its writes still bound. 1.35's detach only takes
 * single runs out of flight, so its abortAll() aborts the batch at stop()
 * and reports the cancel. Before the fix 2.0 let it finish. A detached
 * single run goes on in both engines.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModule } from "../api/module.js";
import { t } from "../api/schema-builders.js";
import { createSystem } from "../api/system.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const run = async (batched: boolean, end: "stop" | "destroy") => {
  const log: string[] = [];
  const work = async (ctx: any) => {
    ctx.signal.addEventListener("abort", () => log.push("aborted"));
    await new Promise((r) => setTimeout(r, 50));
    log.push("done");
  };
  const mod = createModule("load", {
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
      load: batched
        ? {
            requirement: "LOAD",
            batch: { enabled: true, windowMs: 0, maxSize: 1 },
            resolveBatch: (_reqs: unknown[], ctx: any) => work(ctx),
          }
        : {
            requirement: "LOAD",
            resolve: (_req: unknown, ctx: any) => work(ctx),
          },
    },
  } as never);
  const system = createSystem({
    module: mod,
    plugins: [
      {
        name: "rec",
        onResolverCancel: (resolver: string) => log.push(`cancel ${resolver}`),
        onRequirementCanceled: (req: any) => log.push(`canceled ${req.id}`),
      },
    ],
  });
  system.start();
  const facts = system.facts as any;
  facts.go = true;
  await vi.advanceTimersByTimeAsync(5); // the run starts
  facts.go = false; // retracted; bound, so the run is detached
  await vi.advanceTimersByTimeAsync(1);
  log.push(end);
  system[end]();
  log.push(`after ${end}`);
  await vi.advanceTimersByTimeAsync(100);

  return log;
};

describe("stop() and destroy() with a detached run", () => {
  for (const end of ["stop", "destroy"] as const) {
    it(`${end}() aborts a detached batch run and reports its cancel (1.35)`, async () => {
      const log = await run(true, end);

      expect(log.slice(0, 5)).toEqual([
        end,
        "aborted",
        "cancel load",
        "canceled LOAD:{}",
        `after ${end}`,
      ]);
    });

    it(`${end}() lets a detached single run go on (1.35)`, async () => {
      const log = await run(false, end);

      expect(log).not.toContain("aborted");
      expect(log.slice(0, 3)).toEqual([end, `after ${end}`, "done"]);
    });
  }
});
