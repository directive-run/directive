/**
 * L7 pins: what 1.35 does with a batch window, a running batch, a
 * with-results batch, a batch's binding and the resolve() fallback (the L7
 * RFC, "Untested behaviours" U1, U2, U4 to U6, U8 and U11). Each handler
 * reports when it ran (fake time, from 0) and what it saw, so an approved
 * difference shows as exact records, not as a different trace somewhere.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

type Ids = Array<{ id: string }>;

/**
 * One module: `want` and `want2` list ids, and each id is one FETCH
 * requirement keyed by that id. By default the constraint `fetch` raises
 * `want`'s ids; `status` is a fact the handlers write and nothing requires.
 */
function fetches(
  { core: { createModule, t } }: BuildContext,
  resolver: Record<string, unknown>,
  constraints?: Record<string, unknown>,
) {
  return createModule("m", {
    schema: {
      facts: {
        want: t.array<string>(),
        want2: t.array<string>(),
        status: t.string(),
      },
      derivations: {},
      events: {},
      requirements: { FETCH: { id: t.string() } },
    },
    init: (facts: any) => {
      facts.want = [];
      facts.want2 = [];
      facts.status = "idle";
    },
    constraints: constraints ?? {
      fetch: {
        when: (facts: any) => facts.want.length > 0,
        require: (facts: any) =>
          facts.want.map((id: string) => ({ type: "FETCH", id })),
      },
    },
    resolvers: {
      fetch: {
        requirement: "FETCH",
        key: (req: { id: string }) => req.id,
        ...resolver,
      },
    },
  } as any);
}

const idsOf = (reqs: Ids) => reqs.map((r) => r.id);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A resolveBatch that reports its start, waits `ms`, and records any abort. */
function slowBatch(ctx: BuildContext, ms: number, write?: string) {
  return async (reqs: Ids, context: any) => {
    const ids = idsOf(reqs);
    ctx.external(["start", ids, Date.now()]);
    context.signal.addEventListener("abort", () =>
      ctx.external(["aborted", ids, Date.now()]),
    );
    await wait(ms);
    if (write !== undefined) {
      context.facts.status = write;
    }
    ctx.external(["end", ids, Date.now(), context.signal.aborted]);
  };
}

/** Both constraints raise FETCH requirements and bind to `status`. */
const twoSources = {
  c1: {
    when: (facts: any) => facts.want.length > 0,
    require: (facts: any) =>
      facts.want.map((id: string) => ({ type: "FETCH", id })),
    abortOn: ["status"],
  },
  c2: {
    when: (facts: any) => facts.want2.length > 0,
    require: (facts: any) =>
      facts.want2.map((id: string) => ({ type: "FETCH", id })),
    abortOn: ["status"],
  },
};

suite("L7 batch pins", () => {
  scenario(
    "the window restarts on every add: adds 40 ms apart with a 50 ms window run as one call (U1)",
    (ctx) => ({
      module: fetches(ctx, {
        batch: { enabled: true, windowMs: 50 },
        resolveBatch: async (reqs: Ids) => {
          ctx.external(["call", idsOf(reqs), Date.now()]);
        },
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "want", value: ["a"] },
      { op: "advance", ms: 40 },
      { op: "set", key: "want", value: ["a", "b"] },
      { op: "advance", ms: 40 },
      { op: "set", key: "want", value: ["a", "b", "c"] },
      { op: "advance", ms: 49 },
      { op: "checkpoint", label: "one ms before the last add's window" },
      { op: "advance", ms: 1 },
      { op: "checkpoint", label: "the last add's window" },
    ],
  );

  scenario(
    "a steady trickle never flushes until it stops: eight adds 20 ms apart (U1)",
    (ctx) => ({
      module: fetches(ctx, {
        batch: { enabled: true, windowMs: 50 },
        resolveBatch: async (reqs: Ids) => {
          ctx.external(["call", idsOf(reqs), Date.now()]);
        },
      }),
    }),
    [
      { op: "start" },
      ...["a", "b", "c", "d", "e", "f", "g", "h"].flatMap((_, i, all) => [
        { op: "set" as const, key: "want", value: all.slice(0, i + 1) },
        { op: "advance" as const, ms: 20 },
      ]),
      {
        op: "checkpoint",
        label: "160 ms in, 20 ms after the last add: nothing has run",
      },
      { op: "advance", ms: 30 },
      { op: "checkpoint", label: "the last add's window" },
    ],
  );

  scenario(
    "retracting one requirement of a running batch cancels all of it, and the still-wanted ones never run again (U2)",
    (ctx) => ({
      module: fetches(ctx, {
        batch: { enabled: true, windowMs: 10 },
        resolveBatch: slowBatch(ctx, 60, "from-batch"),
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "want", value: ["a", "b", "c"] },
      { op: "advance", ms: 10 },
      { op: "checkpoint", label: "running" },
      { op: "advance", ms: 20 },
      { op: "set", key: "want", value: ["a", "c"] },
      { op: "advance", ms: 100 },
      { op: "checkpoint", label: "after the abort" },
      { op: "set", key: "status", value: "poke" },
      { op: "advance", ms: 300 },
      { op: "checkpoint", label: "a later pass" },
    ],
  );

  scenario(
    "an all-failed with-results batch reruns at once, with no backoff or shouldRetry, and errors each item on every attempt (U4)",
    (ctx) => ({
      module: fetches(ctx, {
        batch: { enabled: true, windowMs: 10 },
        retry: {
          attempts: 3,
          backoff: "exponential",
          initialDelay: 100,
          shouldRetry: (error: Error, attempt: number) => {
            ctx.external(["shouldRetry", error.message, attempt]);

            return true;
          },
        },
        resolveBatchWithResults: async (reqs: Ids) => {
          ctx.external(["call", idsOf(reqs), Date.now()]);

          return reqs.map((r) => ({
            success: false,
            error: new Error(`nope ${r.id}`),
          }));
        },
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "want", value: ["a", "b"] },
      { op: "advance", ms: 10 },
      { op: "checkpoint", label: "the window" },
      { op: "advance", ms: 700 },
      { op: "checkpoint", label: "every backoff has passed" },
    ],
  );

  scenario(
    "a partly failed with-results batch is never retried, not even by a later pass (U5)",
    (ctx) => ({
      module: fetches(ctx, {
        batch: { enabled: true, windowMs: 10 },
        retry: { attempts: 3, backoff: "none", initialDelay: 50 },
        resolveBatchWithResults: async (reqs: Ids) => {
          ctx.external(["call", idsOf(reqs), Date.now()]);

          return reqs.map((r) =>
            r.id === "a"
              ? { success: true }
              : { success: false, error: new Error(`${r.id} failed`) },
          );
        },
      }),
    }),
    [
      { op: "start" },
      { op: "set", key: "want", value: ["a", "b"] },
      { op: "advance", ms: 10 },
      { op: "advance", ms: 500 },
      { op: "checkpoint", label: "every retry wait has passed" },
      { op: "set", key: "status", value: "poke" },
      { op: "advance", ms: 200 },
      { op: "checkpoint", label: "a later pass" },
    ],
  );

  scenario(
    "a single-source batch is bound to its constraint's abortOn keys: a changed key drops its write (U6)",
    (ctx) => ({
      module: fetches(
        ctx,
        {
          batch: { enabled: true, windowMs: 20 },
          resolveBatch: slowBatch(ctx, 60, "from-batch"),
        },
        twoSources,
      ),
    }),
    [
      { op: "start" },
      { op: "set", key: "want", value: ["a", "b"] },
      { op: "advance", ms: 40 },
      { op: "set", key: "status", value: "external" },
      { op: "advance", ms: 150 },
      { op: "checkpoint", label: "after the batch" },
    ],
  );

  scenario(
    "a mixed-source batch is not bound: its write replaces a changed abortOn key, and both complete (U6)",
    (ctx) => ({
      module: fetches(
        ctx,
        {
          batch: { enabled: true, windowMs: 20 },
          resolveBatch: slowBatch(ctx, 60, "from-batch"),
        },
        twoSources,
      ),
    }),
    [
      { op: "start" },
      {
        op: "batch",
        writes: [
          ["want", ["a"]],
          ["want2", ["b"]],
        ],
      },
      { op: "advance", ms: 40 },
      { op: "set", key: "status", value: "external" },
      { op: "advance", ms: 150 },
      { op: "checkpoint", label: "after the batch" },
    ],
  );

  /** The fallback: batch.enabled with only resolve(), 60 ms a run. */
  const fallback = (ctx: BuildContext) =>
    fetches(ctx, {
      batch: { enabled: true, windowMs: 50 },
      resolve: async (req: { id: string }, context: any) => {
        ctx.external(["start", req.id, Date.now()]);
        context.signal.addEventListener("abort", () =>
          ctx.external(["aborted", req.id, Date.now()]),
        );
        await wait(60);
        ctx.external(["end", req.id, Date.now(), context.signal.aborted]);
      },
    });

  scenario(
    "the resolve() fallback's runs ignore a retraction: nothing is canceled and all three complete (U8)",
    (ctx) => ({ module: fallback(ctx) }),
    [
      { op: "start" },
      { op: "set", key: "want", value: ["a", "b", "c"] },
      { op: "advance", ms: 75 },
      { op: "set", key: "want", value: ["a", "c"] },
      { op: "advance", ms: 200 },
      { op: "checkpoint", label: "after the runs" },
    ],
  );

  scenario(
    "the resolve() fallback's runs outlive stop(): nothing is canceled and both complete after it (U8)",
    (ctx) => ({ module: fallback(ctx) }),
    [
      { op: "start" },
      { op: "set", key: "want", value: ["a", "b"] },
      { op: "advance", ms: 75 },
      { op: "stop" },
      { op: "advance", ms: 150 },
      { op: "checkpoint", label: "after the runs" },
    ],
  );

  scenario(
    "the error boundary hears an all-failed with-results item once per attempt (U11)",
    (ctx) => ({
      module: fetches(ctx, {
        batch: { enabled: true, windowMs: 10 },
        retry: { attempts: 2, backoff: "none", initialDelay: 10 },
        resolveBatchWithResults: async (reqs: Ids) => {
          ctx.external(["call", idsOf(reqs), Date.now()]);

          return reqs.map((r) => ({
            success: false,
            error: new Error(`nope ${r.id}`),
          }));
        },
      }),
      errorBoundary: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 50, maxRetries: 1 },
        onError: (error: { source?: unknown; sourceId?: unknown }) =>
          ctx.external(["boundary", error.source, error.sourceId, Date.now()]),
      },
    }),
    [
      { op: "start" },
      { op: "set", key: "want", value: ["a", "b"] },
      { op: "advance", ms: 10 },
      { op: "checkpoint", label: "the first window" },
      { op: "advance", ms: 300 },
      { op: "checkpoint", label: "after the retry-later pass" },
    ],
  );
});
