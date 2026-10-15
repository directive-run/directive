/** L3: lifecycle, the error boundary strategies and plugins. */

import { type BuildContext, scenario, suite } from "../scenario.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A resolver that throws `failures` times, then writes `done`. */
function flaky(
  { core: { createModule, t }, external }: BuildContext,
  failures: number,
) {
  let attempt = 0;

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
    constraints: {
      work: {
        when: (facts: any) => facts.go && !facts.done,
        require: { type: "WORK" },
      },
    },
    resolvers: {
      work: {
        requirement: "WORK",
        resolve: async (_req: unknown, context: any) => {
          attempt += 1;
          external(["attempt", attempt]);
          await wait(2);
          if (attempt <= failures) {
            throw new Error(`failure ${attempt}`);
          }
          context.facts.done = true;
        },
      },
    },
  } as any);
}

const goAndSettle = [
  { op: "start" },
  { op: "set", key: "go", value: true },
  { op: "settle" },
  { op: "advance", ms: 3000 },
  { op: "settle" },
] as const;

/** A resolver that fails once, under one boundary strategy. */
const underBoundary = (strategy: string) => (ctx: BuildContext) => ({
  module: flaky(ctx, 1),
  errorBoundary: {
    onResolverError: strategy,
    retryLater: { delayMs: 100, maxRetries: 2 },
    onError: (error: unknown) => ctx.external(["onError", error]),
  },
});

// Each scenario is written out (not looped) so the census can count them.
suite("L3 lifecycle and the error boundary", () => {
  scenario('error boundary: onResolverError "retry"', underBoundary("retry"), [
    ...goAndSettle,
  ]);

  scenario(
    'error boundary: onResolverError "retry-later"',
    underBoundary("retry-later"),
    [...goAndSettle],
  );

  scenario(
    'error boundary: onResolverError "disable"',
    underBoundary("disable"),
    [...goAndSettle],
  );

  scenario('error boundary: onResolverError "throw"', underBoundary("throw"), [
    ...goAndSettle,
  ]);

  scenario(
    "error boundary: a function chooses the strategy per error",
    (ctx) => ({
      module: flaky(ctx, 2),
      errorBoundary: {
        onResolverError: (error: Error, resolver: string) => {
          ctx.external(["choose", error.message, resolver]);

          return error.message === "failure 1" ? "retry" : "skip";
        },
      },
    }),
    [...goAndSettle],
  );

  scenario(
    "start, stop, start again and destroy: hooks and in-flight runs",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { go: t.boolean(), done: t.boolean() },
          derivations: {},
          events: {},
          requirements: { SLOW: {} },
        },
        init: (facts: any) => {
          facts.go = false;
          facts.done = false;
        },
        constraints: {
          slow: {
            when: (facts: any) => facts.go && !facts.done,
            require: { type: "SLOW" },
          },
        },
        resolvers: {
          slow: {
            requirement: "SLOW",
            resolve: async (_req: unknown, context: any) => {
              external(["run", context.signal?.aborted ?? null]);
              await wait(100);
              external(["finished", context.signal?.aborted ?? null]);
              context.facts.done = true;
            },
          },
        },
      } as any),
      plugins: [
        {
          name: "async-init",
          onInit: async () => {
            await Promise.resolve();
            external("init done");
          },
        },
      ],
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 10 },
      { op: "checkpoint", label: "running" },
      { op: "stop" },
      { op: "advance", ms: 200 },
      { op: "checkpoint", label: "stopped" },
      { op: "start" },
      { op: "settle" },
      { op: "destroy" },
    ],
  );

  scenario(
    "settle waits for chained resolvers",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { step: t.number() },
          derivations: {},
          events: {},
          requirements: { NEXT: { from: t.number() } },
        },
        init: (facts: any) => {
          facts.step = 0;
        },
        constraints: {
          next: {
            when: (facts: any) => facts.step > 0 && facts.step < 4,
            require: (facts: any) => ({ type: "NEXT", from: facts.step }),
          },
        },
        resolvers: {
          next: {
            requirement: "NEXT",
            resolve: async (req: any, context: any) => {
              await wait(req.from * 3);
              context.facts.step = req.from + 1;
            },
          },
        },
      } as any),
    }),
    [{ op: "start" }, { op: "set", key: "step", value: 1 }, { op: "settle" }],
  );
});
