/**
 * L2: constraints → requirements → resolvers, with the 1.35 rules: own-write
 * satisfaction, supersede, retry/backoff, timeout, cancel, priority/after,
 * keyed runs, exhausted retries.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** go → LOAD → resolver writes `done` (its own write retracts the requirement). */
function loader(
  { core: { createModule, t }, external }: BuildContext,
  resolver: Record<string, unknown> = {},
  body: (context: any, attempt: number) => Promise<void> = async (context) => {
    await wait(10);
    context.facts.done = true;
  },
) {
  let attempt = 0;

  return createModule("load", {
    schema: {
      facts: { go: t.boolean(), done: t.boolean(), value: t.number() },
      derivations: {},
      events: {},
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.go = false;
      facts.done = false;
      facts.value = 0;
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
        ...resolver,
        resolve: async (_req: unknown, context: any) => {
          attempt += 1;
          external(["resolve", attempt]);
          context.signal?.addEventListener?.("abort", () =>
            external(["aborted", attempt, String(context.signal.reason ?? "")]),
          );
          await body(context, attempt);
        },
      },
    },
  } as any);
}

suite("L2 constraints, requirements and resolvers", () => {
  scenario(
    "a constraint requires, a resolver satisfies",
    (ctx) => ({ module: loader(ctx) }),
    [{ op: "start" }, { op: "set", key: "go", value: true }, { op: "settle" }],
  );

  scenario(
    "a resolver's own write satisfies its requirement (not a cancel)",
    (ctx) => ({
      module: loader(ctx, {}, async (context) => {
        context.facts.done = true;
        await wait(20);
        context.facts.value = 42;
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 5 },
      { op: "checkpoint", label: "mid-run" },
      { op: "settle" },
    ],
  );

  scenario(
    "an outside retraction cancels the run and drops nothing it already wrote",
    (ctx) => ({
      module: loader(ctx, {}, async (context) => {
        context.facts.value = 1;
        await wait(50);
        context.facts.value = 2;
        context.facts.done = true;
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 10 },
      { op: "set", key: "go", value: false },
      { op: "settle" },
      { op: "advance", ms: 100 },
      { op: "checkpoint", label: "after" },
    ],
  );

  scenario(
    "a requirement that returns supersedes the old run; its late writes drop",
    (ctx) => ({
      module: loader(ctx, {}, async (context, attempt) => {
        await wait(attempt === 1 ? 50 : 10);
        context.facts.value = attempt;
        context.facts.done = true;
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 5 },
      { op: "set", key: "go", value: false },
      { op: "tick" },
      { op: "set", key: "go", value: true },
      { op: "settle" },
      { op: "advance", ms: 100 },
      { op: "checkpoint", label: "late" },
    ],
  );

  scenario(
    "retry with exponential backoff, then success",
    (ctx) => ({
      module: loader(
        ctx,
        { retry: { attempts: 3, backoff: "exponential", initialDelay: 10 } },
        async (context, attempt) => {
          await wait(1);
          if (attempt < 3) {
            throw new Error(`fail ${attempt}`);
          }
          context.facts.done = true;
        },
      ),
    }),
    [{ op: "start" }, { op: "set", key: "go", value: true }, { op: "settle" }],
  );

  scenario(
    "retries exhausted: the error reaches the boundary",
    (ctx) => ({
      module: loader(
        ctx,
        { retry: { attempts: 2, backoff: "linear", initialDelay: 5 } },
        async (_context, attempt) => {
          await wait(1);
          throw new Error(`always ${attempt}`);
        },
      ),
    }),
    [{ op: "start" }, { op: "set", key: "go", value: true }, { op: "settle" }],
  );

  scenario(
    "a timeout aborts the run but keeps its cleanup write",
    (ctx) => ({
      module: loader(ctx, { timeout: 20 }, async (context) => {
        try {
          await wait(100);
          context.facts.done = true;
        } finally {
          context.facts.value = -1;
        }
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 25 },
      { op: "checkpoint", label: "timed-out" },
      { op: "settle" },
      { op: "advance", ms: 200 },
      { op: "checkpoint", label: "late" },
    ],
  );

  scenario(
    "priority and after order dependent constraints",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: {
            go: t.boolean(),
            a: t.boolean(),
            b: t.boolean(),
            c: t.boolean(),
          },
          derivations: {},
          events: {},
          requirements: { A: {}, B: {}, C: {} },
        },
        init: (facts: any) => {
          facts.go = false;
          facts.a = false;
          facts.b = false;
          facts.c = false;
        },
        constraints: {
          low: {
            priority: 1,
            when: (facts: any) => facts.go && !facts.c,
            require: { type: "C" },
          },
          high: {
            priority: 100,
            when: (facts: any) => facts.go && !facts.a,
            require: { type: "A" },
          },
          later: {
            after: ["high"],
            when: (facts: any) => facts.go && !facts.b,
            require: { type: "B" },
          },
        },
        resolvers: {
          a: {
            requirement: "A",
            resolve: async (_req: unknown, context: any) => {
              await wait(10);
              external("A");
              context.facts.a = true;
            },
          },
          b: {
            requirement: "B",
            resolve: async (_req: unknown, context: any) => {
              external("B");
              context.facts.b = true;
            },
          },
          c: {
            requirement: "C",
            resolve: async (_req: unknown, context: any) => {
              await wait(5);
              external("C");
              context.facts.c = true;
            },
          },
        },
      } as any),
    }),
    [{ op: "start" }, { op: "set", key: "go", value: true }, { op: "settle" }],
  );

  scenario(
    "keyed requirements run concurrently and complete independently",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: {
            wanted: t.array<string>(),
            have: t.object<Record<string, number>>(),
          },
          derivations: {},
          events: {},
          requirements: { FETCH: { id: t.string() } },
        },
        init: (facts: any) => {
          facts.wanted = [];
          facts.have = {};
        },
        constraints: {
          fetch: {
            when: (facts: any) =>
              facts.wanted.some((id: string) => !(id in facts.have)),
            require: (facts: any) =>
              facts.wanted
                .filter((id: string) => !(id in facts.have))
                .map((id: string) => ({ type: "FETCH", id })),
          },
        },
        resolvers: {
          fetch: {
            requirement: "FETCH",
            key: (req: any) => `fetch-${req.id}`,
            resolve: async (req: any, context: any) => {
              await wait(req.id.length * 7);
              external(["fetched", req.id]);
              context.facts.have = {
                ...context.facts.have,
                [req.id]: req.id.length,
              };
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "wanted", value: ["aaa", "b", "cc"] },
      { op: "settle" },
      { op: "set", key: "wanted", value: ["aaa", "dddd"] },
      { op: "settle" },
    ],
  );

  scenario(
    "a throwing when() keeps its deps and recovers",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), done: t.boolean() },
          derivations: {},
          events: {},
          requirements: { R: {} },
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.done = false;
        },
        constraints: {
          risky: {
            when: (facts: any) => {
              if (facts.n === 1) {
                throw new Error("bad n");
              }

              return facts.n > 1 && !facts.done;
            },
            require: { type: "R" },
          },
        },
        resolvers: {
          r: {
            requirement: "R",
            resolve: async (_req: unknown, context: any) => {
              context.facts.done = true;
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "n", value: 1 },
      { op: "settle" },
      { op: "set", key: "n", value: 2 },
      { op: "settle" },
    ],
  );
});
