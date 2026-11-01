/**
 * L3: three places where 1.35 does something its own docs do not promise and
 * 2.0 is expected to do differently. Each scenario records only what a user
 * can see through the public API, so the L3 gate's divergence entries have an
 * exact scenario to cover:
 *
 * - a timer completed while paused: 1.35 freezes elapsed time only while the
 *   status is "paused", so it grows again once the status is "completed";
 * - a second `start()`: 1.35 arms a new tick interval on every call (while
 *   running and after `destroy()` too) and keeps only the newest handle;
 * - `stop()` called from a hook that reports a run's outcome: 1.35 reports the
 *   outcome and then a cancel for the same run.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One resolver that waits, then writes `done` or throws. */
function worker(
  { core: { createModule, t }, external, handles }: BuildContext,
  fail: boolean,
  hooks: Record<string, unknown> = {},
) {
  return createModule("m", {
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
    hooks: {
      onInit: (system: any) => {
        handles.system = system;
      },
      ...hooks,
    },
    constraints: {
      work: {
        when: (facts: any) => facts.go && !facts.done,
        require: { type: "WORK" },
      },
    },
    resolvers: {
      work: {
        requirement: "WORK",
        retry: { attempts: 1 },
        resolve: async (_req: unknown, context: any) => {
          external(["resolver running"]);
          await wait(2);
          if (fail) {
            throw new Error("work failed");
          }
          context.facts.done = true;
        },
      },
    },
  } as any);
}

const runThenLook = [
  { op: "start" },
  { op: "set", key: "go", value: true },
  { op: "advance", ms: 10 },
  { op: "checkpoint", label: "after the run" },
  { op: "advance", ms: 200 },
  { op: "checkpoint", label: "later" },
] as const;

suite("L3 lifecycle quirks of 1.35", () => {
  scenario(
    "a timer completed while paused: elapsed time after the clock moves",
    ({ core, external }) => {
      const c = core as any;

      return {
        module: c.createModule("game", {
          schema: {
            facts: { round: c.t.object() },
            derivations: {},
            events: { start: {}, pause: {}, done: {} },
          },
          init: (facts: any) => {
            facts.round = c.initialTimerState();
          },
          events: {
            start: (facts: any) => {
              facts.round = c.startTimer(facts.round, Date.now());
            },
            pause: (facts: any) => {
              facts.round = c.pauseTimer(facts.round, Date.now());
            },
            done: (facts: any) => {
              external(["completing", facts.round.status]);
              facts.round = c.completeTimer(facts.round);
            },
          },
        }),
      };
    },
    [
      { op: "start" },
      { op: "dispatch", event: { type: "start" } },
      { op: "advance", ms: 300 },
      { op: "dispatch", event: { type: "pause" } },
      { op: "advance", ms: 200 },
      { op: "dispatch", event: { type: "done" } },
      {
        op: "run",
        label: "elapsed straight after completing",
        fn: (system, { core, external }) =>
          external([
            "elapsed after completing",
            (core as any).elapsedMs(system.facts.round, Date.now()),
            system.facts.round.status,
          ]),
      },
      { op: "advance", ms: 700 },
      {
        op: "run",
        label: "elapsed after the clock moved",
        fn: (system, { core, external }) =>
          external([
            "elapsed after advancing",
            (core as any).elapsedMs(system.facts.round, Date.now()),
            system.facts.round.status,
          ]),
      },
      { op: "checkpoint", label: "completed" },
    ],
  );

  scenario(
    "a second start() arms a second tick interval, and stop() leaves one running",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("clock", {
        schema: {
          facts: { ticks: t.number() },
          derivations: {},
          events: { tick: {} },
        },
        init: (facts: any) => {
          facts.ticks = 0;
        },
        events: {
          tick: (facts: any) => {
            facts.ticks += 1;
            external(["tick", facts.ticks, Date.now()]);
          },
        },
      } as any),
      tickMs: 100,
    }),
    [
      { op: "start" },
      { op: "start" },
      { op: "advance", ms: 300 },
      { op: "checkpoint", label: "running after two start() calls" },
      { op: "stop" },
      { op: "advance", ms: 300 },
      { op: "checkpoint", label: "300 ms after stop()" },
      { op: "destroy" },
      { op: "advance", ms: 300 },
      { op: "checkpoint", label: "300 ms after destroy()" },
      { op: "start" },
      { op: "advance", ms: 300 },
      { op: "checkpoint", label: "300 ms after start() following destroy()" },
      { op: "destroy" },
    ],
  );

  // One start() before the destroy, so no earlier interval is left running:
  // what ticks afterwards is the interval the start() after destroy() armed.
  scenario(
    "start() after destroy() arms a tick interval on its own",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("clock", {
        schema: {
          facts: { ticks: t.number() },
          derivations: {},
          events: { tick: {} },
        },
        init: (facts: any) => {
          facts.ticks = 0;
        },
        events: {
          tick: (facts: any) => {
            facts.ticks += 1;
            external(["tick", facts.ticks, Date.now()]);
          },
        },
      } as any),
      tickMs: 100,
    }),
    [
      { op: "start" },
      { op: "advance", ms: 300 },
      { op: "checkpoint", label: "one start(): three periods" },
      { op: "destroy" },
      { op: "advance", ms: 300 },
      { op: "checkpoint", label: "300 ms after destroy()" },
      { op: "start" },
      { op: "advance", ms: 300 },
      { op: "checkpoint", label: "300 ms after start() following destroy()" },
      { op: "destroy" },
    ],
  );

  scenario(
    "stop() from a plugin's onResolverComplete: complete, then cancel",
    (ctx) => ({
      module: worker(ctx, false),
      plugins: [
        {
          name: "stopper",
          onResolverComplete: () => {
            ctx.external("stopping from onResolverComplete");
            ctx.handles.system.stop();
          },
        },
      ],
    }),
    [...runThenLook],
  );

  scenario(
    "stop() from a module's onResolverError: error, then cancel",
    (ctx) => ({
      module: worker(ctx, true, {
        onResolverError: () => {
          ctx.external("stopping from onResolverError");
          ctx.handles.system.stop();
        },
      }),
    }),
    [...runThenLook],
  );

  // Row t, third path (found by the fuzz at L3; diff/fuzz/pinned.json): a
  // reconcile pass retracts a run after the run reported complete but before
  // it left flight. r0's own write (f0 = 0) retracts c0, while r1 completes
  // in the same tick. 1.35 then also reports a cancel for r0; 2.0 reports
  // the completion only. No stop() is involved: constraints and resolvers.
  scenario(
    "a run retracted after it reported complete: complete, then cancel",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { f0: t.number(), f1: t.number() },
          derivations: {},
          events: { e0: { v: t.number() } },
          requirements: { A0: {}, A1: {} },
        },
        init: (facts: any) => {
          facts.f0 = 0;
          facts.f1 = 0;
        },
        events: {
          e0: (facts: any, payload: any) => {
            facts.f0 = payload.v;
          },
        },
        constraints: {
          c0: { when: (facts: any) => facts.f0 >= 1, require: { type: "A0" } },
          c1: { when: (facts: any) => facts.f0 >= 0, require: { type: "A1" } },
        },
        resolvers: {
          r0: {
            requirement: "A0",
            resolve: async (_req: unknown, context: any) => {
              external(["start", "r0"]);
              await wait(1);
              context.facts.f0 = 0;
              external(["wrote", "r0"]);
            },
          },
          r1: {
            requirement: "A1",
            resolve: async (_req: unknown, context: any) => {
              external(["start", "r1"]);
              await wait(1);
              context.facts.f1 = 5;
              external(["wrote", "r1"]);
            },
          },
        },
      }),
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "f0 = 1",
        fn: (system) => {
          system.facts.f0 = 1;
        },
      },
      {
        op: "run",
        label: "f0 = 0",
        fn: (system) => {
          system.facts.f0 = 0;
        },
      },
      {
        op: "run",
        label: "dispatch e0 { v: 1 }",
        fn: (system) => system.dispatch({ type: "e0", v: 1 }),
      },
      { op: "settle" },
      { op: "checkpoint", label: "settled" },
      { op: "destroy" },
    ],
  );
});
