/**
 * L3: retry-later really re-running, readiness, SSR hydrate, the plugin
 * API (order, an async onInit, a throwing hook), the guardrail notify.*
 * channels, async stop/destroy, settle(maxWait). Two scenarios use a feature
 * a later layer builds and are placed there in layers.rules.json: the
 * clobber-loop notify.* channels (L12) and evict (L10).
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function worker(
  { core: { createModule, t }, external }: BuildContext,
  failures: number,
  delay = 2,
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
          external(["attempt", attempt, Date.now()]);
          await wait(delay);
          if (attempt <= failures) {
            throw new Error(`failure ${attempt}`);
          }
          context.facts.done = true;
        },
      },
    },
  } as any);
}

suite("L3 lifecycle and the plugin API", () => {
  scenario(
    "retry-later re-runs the resolver after its delay",
    (ctx) => ({
      module: worker(ctx, 2),
      errorBoundary: {
        onResolverError: "retry-later",
        retryLater: { delayMs: 100, maxRetries: 3, backoffMultiplier: 2 },
      },
    }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 3 },
      { op: "checkpoint", label: "failed once" },
      { op: "advance", ms: 99 },
      { op: "checkpoint", label: "just before retry-later" },
      { op: "advance", ms: 10 },
      { op: "checkpoint", label: "after the first retry-later" },
      { op: "advance", ms: 1000 },
      { op: "settle" },
    ],
  );

  scenario(
    "whenReady, isReady and an async plugin onInit",
    (ctx) => ({
      module: worker(ctx, 0),
      plugins: [
        {
          name: "slow-init",
          onInit: async () => {
            await wait(20);
            ctx.external("slow init done");
          },
          onStart: () => ctx.external("slow-init onStart"),
        },
      ],
    }),
    [
      {
        op: "run",
        label: "isReady before start",
        fn: (system, { external }) => external(["ready?", system.isReady]),
      },
      { op: "start" },
      {
        op: "run",
        label: "whenReady",
        fn: async (system, { external }) => {
          external(["ready after start?", system.isReady]);
          await system.whenReady();
          external(["ready", system.isReady]);
        },
      },
      { op: "set", key: "go", value: true },
      { op: "settle" },
    ],
  );

  scenario(
    "SSR: hydrate before start, initialFacts, and hydrate after start refused",
    ({ core: { createModule, t } }) => ({
      module: createModule("ssr", {
        schema: {
          facts: { userId: t.string(), name: t.string(), count: t.number() },
          derivations: { display: t.string() },
          events: {},
        },
        init: (facts: any) => {
          facts.userId = "";
          facts.name = "";
          facts.count = 0;
        },
        derive: { display: (facts: any) => facts.name || "Anonymous" },
      } as any),
      initialFacts: { count: 5 },
    }),
    [
      {
        op: "run",
        label: "hydrate",
        fn: (system) =>
          system.hydrate(async () => ({ userId: "u1", name: "Ada" })),
      },
      { op: "start" },
      { op: "checkpoint", label: "hydrated" },
      {
        op: "run",
        label: "hydrate after start",
        fn: (system) => system.hydrate(async () => ({ name: "late" })),
      },
      {
        op: "run",
        label: "snapshot for the client",
        fn: (system, { external }) =>
          external(["snapshot", system.getSnapshot()]),
      },
      { op: "settle" },
    ],
  );

  scenario(
    "plugins run in order, and a throwing hook is isolated",
    (ctx) => ({
      module: worker(ctx, 0),
      plugins: [
        {
          name: "first",
          onFactSet: (key: string) => ctx.external(["first", key]),
          onResolverStart: () => {
            throw new Error("plugin hook failed");
          },
        },
        {
          name: "second",
          onFactSet: (key: string) => ctx.external(["second", key]),
          onResolverComplete: (resolver: string) =>
            ctx.external(["second complete", resolver]),
        },
      ],
    }),
    [{ op: "start" }, { op: "set", key: "go", value: true }, { op: "settle" }],
  );

  scenario(
    "notify: guardrail channels reach plugins",
    (ctx) => ({ module: worker(ctx, 0) }),
    [
      { op: "start" },
      {
        op: "run",
        label: "guardrail notifications",
        fn: (system) => {
          system.notify.guardrailBlocked(
            "conformance-recorder",
            "email",
            "redact",
            2,
            "pii",
          );
          system.notify.guardrailBlocked("nobody", "email", "redact", 1, "pii");
          system.notify.guardrailCoverage(
            "conformance-recorder",
            3,
            "digest-1",
            "start",
          );
        },
      },
      { op: "settle" },
    ],
  );

  scenario(
    "notify: clobber-loop channels reach plugins",
    (ctx) => ({ module: worker(ctx, 0) }),
    [
      { op: "start" },
      {
        op: "run",
        label: "clobber loop notifications",
        fn: (system) => {
          const event = {
            resolver: "work",
            fact: "done",
            count: 3,
            windowMs: 1000,
          };
          system.notify.clobberLoopDetected(event);
          system.notify.clobberLoopResolved(event);
        },
      },
      { op: "settle" },
    ],
  );

  scenario(
    "async stop and destroy wait for in-flight runs",
    (ctx) => ({ module: worker(ctx, 0, 30) }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 5 },
      {
        op: "run",
        label: "stopAsync",
        fn: async (system, { external }) => {
          await system.stopAsync();
          external(["stopped", system.isRunning ?? null]);
        },
      },
      { op: "start" },
      {
        op: "run",
        label: "destroyAsync",
        fn: async (system, { external }) => {
          await system.destroyAsync();
          external("destroyed");
        },
      },
    ],
  );

  scenario(
    "async stop, evict and destroy",
    (ctx) => ({ module: worker(ctx, 0, 30) }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 5 },
      {
        op: "run",
        label: "stopAsync",
        fn: async (system, { external }) => {
          await system.stopAsync();
          external(["stopped", system.isRunning ?? null]);
        },
      },
      { op: "start" },
      {
        op: "run",
        label: "evict",
        fn: (system) => system.evict(50),
      },
      {
        op: "run",
        label: "destroyAsync",
        fn: async (system, { external }) => {
          await system.destroyAsync();
          external("destroyed");
        },
      },
    ],
  );

  scenario(
    "settle(maxWait) gives up on a resolver that never finishes",
    (ctx) => ({ module: worker(ctx, 0, 10_000) }),
    [
      { op: "start" },
      { op: "set", key: "go", value: true },
      {
        op: "run",
        label: "settle with maxWait",
        fn: async (system, { external }) => {
          try {
            await system.settle(50);
            external("settled");
          } catch (error) {
            external(["settle gave up", error]);
          }
        },
      },
      { op: "checkpoint", label: "after giving up" },
      { op: "stop" },
    ],
  );
});
