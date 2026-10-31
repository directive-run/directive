/**
 * L2: the resolver rules at their edges — exact backoff and timeout
 * boundaries, the loading flag, jitter, requeue, abort reasons in
 * shouldRetry, clobber rejection (abortOn) and its async-constraint
 * disablement, DirectiveError fields at the boundary, crossModuleDeps.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** go → LOAD → `body`; the resolver options are spread in. */
function loader(
  { core: { createModule, t }, external }: BuildContext,
  resolver: Record<string, unknown>,
  body: (context: any, attempt: number) => Promise<void>,
  constraint: Record<string, unknown> = {},
) {
  let attempt = 0;

  return createModule("load", {
    schema: {
      facts: {
        go: t.boolean(),
        done: t.boolean(),
        loading: t.boolean(),
        value: t.number(),
      },
      derivations: {},
      events: { bump: {} },
      requirements: { LOAD: {} },
    },
    init: (facts: any) => {
      facts.go = false;
      facts.done = false;
      facts.loading = false;
      facts.value = 0;
    },
    events: {
      bump: (facts: any) => {
        facts.value += 100;
      },
    },
    constraints: {
      load: {
        when: (facts: any) => facts.go && !facts.done,
        require: { type: "LOAD" },
        ...constraint,
      },
    },
    resolvers: {
      load: {
        requirement: "LOAD",
        ...resolver,
        resolve: async (_req: unknown, context: any) => {
          attempt += 1;
          external(["resolve", attempt, Date.now()]);
          context.signal?.addEventListener?.("abort", () =>
            external(["aborted", attempt, String(context.signal.reason ?? "")]),
          );
          await body(context, attempt);
        },
      },
    },
  } as any);
}

suite("L2 resolver rules at their edges", () => {
  scenario(
    "a retry fires exactly when its backoff ends",
    (ctx) => ({
      module: loader(
        ctx,
        { retry: { attempts: 3, backoff: "linear", initialDelay: 10 } },
        async (context, attempt) => {
          if (attempt < 3) {
            throw new Error(`fail ${attempt}`);
          }
          context.facts.done = true;
        },
      ),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "tick" },
      { op: "advance", ms: 9 },
      { op: "checkpoint", label: "1 ms before the first retry" },
      { op: "advance", ms: 1 },
      { op: "checkpoint", label: "at the first retry" },
      { op: "advance", ms: 19 },
      { op: "checkpoint", label: "1 ms before the second retry" },
      { op: "advance", ms: 1 },
      { op: "settle" },
    ],
  );

  scenario(
    "a timeout fires exactly at its deadline",
    (ctx) => ({
      module: loader(ctx, { timeout: 20 }, async (context) => {
        await wait(100);
        context.facts.done = true;
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "tick" },
      { op: "advance", ms: 19 },
      { op: "checkpoint", label: "1 ms before the deadline" },
      { op: "advance", ms: 1 },
      { op: "checkpoint", label: "at the deadline" },
      { op: "settle" },
    ],
  );

  scenario(
    "a loading flag set and cleared around a satisfied, timed-out run",
    (ctx) => ({
      module: loader(ctx, { timeout: 10 }, async (context) => {
        try {
          context.facts.loading = true;
          context.facts.done = true;
          await wait(30);
          context.facts.value = 7;
        } finally {
          context.facts.loading = false;
        }
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 5 },
      { op: "checkpoint", label: "loading" },
      { op: "advance", ms: 100 },
      { op: "settle" },
    ],
  );

  // The three jitter forms run one after another, each started by a step at
  // a fixed time (after the one before has finished, at any draw), so neither
  // the order of events nor a start time depends on a draw. What a
  // retry waited is the time between two attempts; it is recorded as a
  // `$draw` with its bounds, so the exact random draw is incidental (two
  // valid engines draw differently from the same seed: README "What the
  // trace freezes") while the delay must still lie in [min, max] on every
  // engine. `base` is the backoff delay before jitter, clamped to the
  // default maxDelay (30000).
  scenario(
    "full and equal jitter draw from the seeded random",
    ({ core: { createModule, t }, external }) => {
      const attempts: Record<string, number> = {};
      const lastAt: Record<string, number> = {};
      const MAX_DELAY = 30000;
      const exponential = (initial: number) => (failed: number) =>
        Math.min(initial * 2 ** (failed - 1), MAX_DELAY);
      const linear = (initial: number) => (failed: number) =>
        Math.min(initial * failed, MAX_DELAY);
      // [min, max] of the wait after `base`, per jitter form.
      const full = (base: number): [number, number] => [0, base];
      const equal = (base: number): [number, number] => [base / 2, base];
      const additive =
        (maxMs: number) =>
        (base: number): [number, number] => [base, base + maxMs];

      const attempt = (
        name: string,
        baseOf: (failed: number) => number,
        bounds: (base: number) => [number, number],
      ) => {
        attempts[name] = (attempts[name] ?? 0) + 1;
        const now = Date.now();
        if (attempts[name] === 1) {
          external([name, 1]);
        } else {
          const [min, max] = bounds(baseOf(attempts[name] - 1));
          external([
            name,
            attempts[name],
            { $draw: now - (lastAt[name] as number), min, max },
          ]);
        }
        lastAt[name] = now;

        return attempts[name] as number;
      };

      return {
        module: createModule("m", {
          schema: {
            facts: {
              full: t.boolean(),
              equal: t.boolean(),
              half: t.boolean(),
              go2: t.boolean(),
              go3: t.boolean(),
            },
            derivations: {},
            events: {},
            requirements: { FULL: {}, EQUAL: {}, HALF: {} },
          },
          init: (facts: any) => {
            facts.full = false;
            facts.equal = false;
            facts.half = false;
            facts.go2 = false;
            facts.go3 = false;
          },
          constraints: {
            full: { when: (f: any) => !f.full, require: { type: "FULL" } },
            equal: {
              when: (f: any) => f.go2 && !f.equal,
              require: { type: "EQUAL" },
            },
            half: {
              when: (f: any) => f.go3 && !f.half,
              require: { type: "HALF" },
            },
          },
          resolvers: {
            full: {
              requirement: "FULL",
              retry: {
                attempts: 4,
                backoff: "exponential",
                initialDelay: 40,
                jitter: "full",
              },
              resolve: async (_req: unknown, context: any) => {
                if (attempt("full", exponential(40), full) < 4) {
                  throw new Error("again");
                }
                context.facts.full = true;
              },
            },
            // jitter { maxMs }: the draw is added on top of the delay.
            equal: {
              requirement: "EQUAL",
              retry: {
                attempts: 3,
                backoff: "linear",
                initialDelay: 30,
                jitter: { maxMs: 25 },
              },
              resolve: async (_req: unknown, context: any) => {
                if (attempt("equal", linear(30), additive(25)) < 3) {
                  throw new Error("again");
                }
                context.facts.equal = true;
              },
            },
            half: {
              requirement: "HALF",
              retry: {
                attempts: 4,
                backoff: "exponential",
                initialDelay: 20,
                jitter: "equal",
              },
              resolve: async (_req: unknown, context: any) => {
                if (attempt("half", exponential(20), equal) < 4) {
                  throw new Error("again");
                }
                context.facts.half = true;
              },
            },
          },
        } as any),
      };
    },
    [
      { op: "start" },
      // full finishes by 280 ms, equal by 140 ms, at any draw.
      { op: "advance", ms: 300 },
      { op: "set", key: "go2", value: true },
      { op: "advance", ms: 300 },
      { op: "set", key: "go3", value: true },
      { op: "settle" },
    ],
  );

  scenario(
    "requeue runs a resolver again for the same requirement",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { pages: t.number(), total: t.number() },
          derivations: {},
          events: {},
          requirements: { PAGE: {} },
        },
        init: (facts: any) => {
          facts.pages = 0;
          facts.total = 3;
        },
        constraints: {
          more: {
            when: (facts: any) => facts.pages < facts.total,
            require: { type: "PAGE" },
          },
        },
        resolvers: {
          page: {
            requirement: "PAGE",
            resolve: async (_req: unknown, context: any) => {
              await wait(2);
              context.facts.pages += 1;
              external(["page", context.facts.pages]);
              if (context.facts.pages < 2) {
                context.requeue();
              }
            },
          },
        },
      } as any),
    }),
    [{ op: "start" }, { op: "settle" }],
  );

  scenario(
    "shouldRetry sees why each attempt aborted",
    (ctx) => ({
      module: loader(
        ctx,
        {
          timeout: 15,
          retry: {
            attempts: 3,
            backoff: "none",
            shouldRetry: (error: unknown, attempt: number, info: any) => {
              ctx.external([
                "shouldRetry",
                attempt,
                info?.reason ?? null,
                info?.clobber ?? null,
                error instanceof Error ? error.message : String(error),
              ]);

              return attempt < 3;
            },
          },
        },
        async (context, attempt) => {
          if (attempt === 1) {
            await wait(50);
          } else if (attempt === 2) {
            throw new Error("plain error");
          }
          context.facts.done = true;
        },
      ),
    }),
    [{ op: "start" }, { op: "set", key: "go", value: true }, { op: "settle" }],
  );

  scenario(
    "a write to an abortOn fact changed meanwhile is rejected (clobber)",
    (ctx) => ({
      module: loader(
        ctx,
        {},
        async (context) => {
          await wait(10);
          context.facts.value = 1;
          context.facts.done = true;
        },
        { abortOn: ["value"] },
      ),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 3 },
      { op: "dispatch", event: { type: "bump" } },
      { op: "settle" },
      { op: "advance", ms: 50 },
      { op: "checkpoint", label: "after" },
    ],
  );

  scenario(
    "abortOn on an async constraint is disabled, with a signal",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: {
          facts: { go: t.boolean(), done: t.boolean(), amount: t.number() },
          derivations: {},
          events: {},
          requirements: { A: {}, B: {} },
        },
        init: (facts: any) => {
          facts.go = false;
          facts.done = false;
          facts.amount = 1;
        },
        constraints: {
          declared: {
            async: true,
            when: async (facts: any) => facts.go && !facts.done,
            require: { type: "A" },
            abortOn: ["amount"],
          },
          promoted: {
            when: (facts: any) =>
              Promise.resolve(facts.go && facts.amount > 5) as any,
            require: { type: "B" },
            abortOn: ["amount"],
          },
        },
        resolvers: {
          a: {
            requirement: "A",
            resolve: async (_req: unknown, context: any) => {
              context.facts.done = true;
            },
          },
          b: {
            requirement: "B",
            resolve: async (_req: unknown, context: any) => {
              context.facts.amount = 0;
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "settle" },
      { op: "set", key: "amount", value: 9 },
      { op: "settle" },
    ],
  );

  scenario(
    "the boundary receives a DirectiveError with source, context and cause",
    (ctx) => ({
      module: loader(ctx, {}, async () => {
        await wait(1);
        throw new Error("boom", { cause: new Error("root cause") });
      }),
      errorBoundary: {
        onResolverError: (error: any, resolver: string) => {
          ctx.external(["onResolverError", resolver, error]);

          return "skip";
        },
        onError: (error: any) =>
          ctx.external([
            "onError",
            error.source,
            error.sourceId,
            error.recoverable,
            error.context ?? null,
            error,
          ]),
      },
    }),
    [{ op: "start" }, { op: "set", key: "go", value: true }, { op: "settle" }],
  );

  scenario(
    "explain() and inspect() describe an unmet requirement",
    (ctx) => ({
      module: loader(ctx, {}, async (context) => {
        await wait(50);
        context.facts.done = true;
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 5 },
      {
        op: "run",
        label: "explain",
        fn: (system, { external }) => {
          const unmet = system.inspect().inflight[0]?.id ?? "LOAD:{}";
          external(["explain", system.explain(unmet)]);
          external(["explain missing", system.explain("nope")]);
        },
      },
      { op: "settle" },
    ],
  );
});

suite("L2 across modules", () => {
  scenario(
    "crossModuleDeps: a constraint reads another module's facts",
    ({ core: { createModule, t } }) => {
      const authSchema = {
        facts: { token: t.string() },
        derivations: {},
        events: {},
      };
      const auth = createModule("auth", {
        schema: authSchema,
        init: (facts: any) => {
          facts.token = "";
        },
      } as any);
      const notes = createModule("notes", {
        schema: {
          facts: { draft: t.string(), saved: t.string() },
          derivations: {},
          events: { submit: { text: t.string() } },
          requirements: { SAVE: {} },
        },
        crossModuleDeps: { auth: authSchema },
        init: (facts: any) => {
          facts.draft = "";
          facts.saved = "";
        },
        events: {
          submit: (facts: any, event: any) => {
            facts.draft = event.text;
          },
        },
        constraints: {
          save: {
            when: (facts: any) =>
              facts.self.draft !== "" && facts.auth.token !== "",
            require: { type: "SAVE" },
          },
        },
        resolvers: {
          save: {
            requirement: "SAVE",
            resolve: async (_req: unknown, context: any) => {
              context.facts.saved = context.facts.draft;
              context.facts.draft = "";
            },
          },
        },
      } as any);

      return { modules: { auth, notes } };
    },
    [
      { op: "start" },
      {
        op: "run",
        label: "submit",
        fn: (system) => system.events.notes.submit({ text: "hello" }),
      },
      { op: "settle" },
      { op: "set", key: "auth.token", value: "tok" },
      { op: "settle" },
    ],
  );
});
