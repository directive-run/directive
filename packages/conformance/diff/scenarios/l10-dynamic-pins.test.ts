/**
 * L10 pins: what 1.35 does with dynamic definitions in the places no other
 * scenario looks (the L10 RFC, "Untested behaviours" U2, U3, U5, U9a, U9b,
 * U14 and U17 to U20). Each `look` step reports what a reader sees, so an
 * approved difference shows as exact records. U2 and U3 show row (bm),
 * approved for L10a: its signed entry is added with the row.
 *
 * The diff harness runs development builds only. The production halves of
 * U9a, U9b and U20 are pinned by tests/core/l10-dynamic-pins-oracle-production.
 */

import {
  type AnySystem,
  type BuildContext,
  type Step,
  scenario,
  suite,
} from "../scenario.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The RFC's probe module: facts `a`, `b` and `log`, a derivation `double`,
 * an event `bump`, a requirement WORK. `extra` adds definitions to it.
 */
function probe(
  { core: { createModule, t } }: BuildContext,
  extra: Record<string, any> = {},
) {
  return createModule("m", {
    schema: {
      facts: { a: t.number(), b: t.number(), log: t.string() },
      derivations: {
        double: t.number(),
        ...(extra.derivations ?? {}),
      },
      events: { bump: {} },
      requirements: { WORK: {} },
    },
    init: (facts: any) => {
      facts.a = 1;
      facts.b = 0;
      facts.log = "";
    },
    derive: { double: (facts: any) => facts.a * 2, ...(extra.derive ?? {}) },
    events: {
      bump: (facts: any) => {
        facts.a += 1;
      },
    },
    ...(extra.constraints ? { constraints: extra.constraints } : {}),
    ...(extra.resolvers ? { resolvers: extra.resolvers } : {}),
    ...(extra.effects ? { effects: extra.effects } : {}),
  } as any);
}

/** What `fn` returns, or the message it throws, recorded under `label`. */
const look = (label: string, fn: (system: AnySystem) => unknown): Step => ({
  op: "run",
  label,
  fn: (system: AnySystem, { external }) => {
    try {
      external([label, fn(system)]);
    } catch (error) {
      external([label, { threw: String((error as Error)?.message ?? error) }]);
    }
  },
});

const readers = (label: string) =>
  look(label, (system) => [system.derive.reader, system.derive.direct]);

/**
 * U9a and U9b: a constraint registered while the system runs, a 30 ms
 * resolver that writes `log` and reports its signal; the write to `a` raises
 * the requirement, and the constraint is unregistered `delay` ms later.
 */
function unregisterInFlight(delay: number, bound: boolean): Step[] {
  return [
    { op: "start" },
    { op: "settle" },
    {
      op: "run",
      label: "register the constraint and its resolver",
      fn: (system, { external }) => {
        system.resolvers.register("work", {
          requirement: "WORK",
          resolve: async (_req: unknown, context: any) => {
            await wait(30);
            external(["signal aborted", context.signal.aborted]);
            context.facts.log = "done";
          },
        });
        system.constraints.register("dyn", {
          when: (facts: any) => facts.a > 1,
          require: { type: "WORK" },
          ...(bound ? { abortOn: ["a"] } : {}),
        });
      },
    },
    { op: "set", key: "a", value: 2 },
    ...(delay > 0 ? [{ op: "advance", ms: delay } as Step] : []),
    look("unregister", (system) => {
      system.constraints.unregister("dyn");

      return system.constraints.isDynamic("dyn");
    }),
    { op: "advance", ms: 60 },
    { op: "settle" },
    look("after", (system) => ({
      log: system.facts.log,
      unmet: system.inspect().unmet.length,
      constraints: system.inspect().constraints.map((c: any) => c.id),
    })),
  ];
}

/** P9 and P10's system: namespaced `m` with history, then module `x`. */
function historyBase({ core }: BuildContext) {
  const m = core.createModule("m", {
    schema: { facts: { a: core.t.number() } },
    init: (facts: any) => {
      facts.a = 1;
    },
  } as any);

  return { modules: { m }, history: { maxSnapshots: 20 } };
}

const moduleX = ({ core }: BuildContext) =>
  core.createModule("x", {
    schema: { facts: { c: core.t.number() } },
    init: (facts: any) => {
      facts.c = 10;
    },
  } as any);

const snapshots = (label: string) =>
  look(label, (system) => ({
    count: system.history.snapshots.length,
    index: system.history.currentIndex,
    last: system.history.snapshots.at(-1)?.facts ?? null,
  }));

/** U17's steps: a write, `registerModule("x")`, a write to `c`. */
const registerUnderHistory: Step[] = [
  { op: "start" },
  { op: "settle" },
  {
    op: "run",
    label: "write a",
    fn: (system) => {
      system.facts.m.a = 2;
    },
  },
  { op: "settle" },
  snapshots("before registerModule"),
  {
    op: "run",
    label: "registerModule x",
    fn: (system, ctx) => {
      system.registerModule("x", moduleX(ctx));
    },
  },
  { op: "settle" },
  snapshots("after registerModule"),
  {
    op: "run",
    label: "write c",
    fn: (system) => {
      system.facts.x.c = 11;
    },
  },
  { op: "settle" },
  snapshots("after the write to c"),
];

/** U18's steps after U17's: back twice, to before the registration. */
const backPastRegistration: Step[] = [
  { op: "back" },
  { op: "settle" },
  look("after one back", (system) => [system.facts.x?.c ?? null]),
  { op: "back" },
  { op: "settle" },
  look("after two backs", (system) => ({
    c: system.facts.x?.c ?? null,
    a: system.facts.m.a,
    index: system.history.currentIndex,
  })),
];

suite("L10 dynamic definition pins", () => {
  scenario(
    "a derivation that asked for a name before it was registered keeps its answer (U2; row bm)",
    (ctx) => ({
      module: probe(ctx, {
        derivations: {
          reader: ctx.core.t.string(),
          direct: ctx.core.t.string(),
        },
        derive: {
          reader: (_facts: any, derived: any) =>
            "later" in derived ? `has ${derived.later}` : "none",
          direct: (_facts: any, derived: any) => `v ${derived.later}`,
        },
      }),
    }),
    [
      { op: "start" },
      { op: "settle" },
      readers("before"),
      look("register later", (system) => {
        system.derive.register("later", (facts: any) => facts.a * 10);

        return system.derive.later;
      }),
      { op: "settle" },
      readers("after the registration"),
      { op: "set", key: "a", value: 5 },
      { op: "settle" },
      readers("after a write later reads"),
      look("unregister later", (system) => {
        system.derive.unregister("later");

        return "later" in system.derive;
      }),
      { op: "settle" },
      readers("after the unregister"),
    ],
  );

  scenario(
    "a constraint gated on a later-registered name is never evaluated again (U3; row bm)",
    (ctx) => ({
      module: probe(ctx, {
        constraints: {
          gate: {
            when: (_facts: any, derived: any) => {
              ctx.external(["gate evaluated"]);

              return "later" in derived && derived.later > 0;
            },
            require: { type: "WORK" },
          },
        },
        resolvers: {
          work: {
            requirement: "WORK",
            resolve: async (_req: unknown, context: any) => {
              context.facts.log = "worked";
            },
          },
        },
      }),
    }),
    [
      { op: "start" },
      { op: "settle" },
      {
        op: "run",
        label: "register later",
        fn: (system) => {
          system.derive.register("later", (facts: any) => facts.a * 10);
        },
      },
      { op: "settle" },
      look("after the registration", (system) => system.facts.log),
      { op: "set", key: "a", value: 5 },
      { op: "settle" },
      look("after a write later reads", (system) => system.facts.log),
    ],
  );

  scenario(
    "a registration inside an effect is deferred to the end of the pass (U5)",
    (ctx) => ({
      module: probe(ctx, {
        effects: {
          reg: {
            run: (facts: any) => {
              const system = ctx.handles.system;
              if (
                system &&
                facts.a === 2 &&
                !system.constraints.isDynamic("late")
              ) {
                system.constraints.register("late", {
                  when: (f: any) => f.a > 1,
                  require: { type: "WORK" },
                });
                ctx.external([
                  "inside the effect",
                  system.constraints.isDynamic("late"),
                  system.constraints.listDynamic(),
                ]);
              }
            },
          },
        },
        resolvers: {
          work: {
            requirement: "WORK",
            resolve: async (_req: unknown, context: any) => {
              context.facts.log = "late ran";
            },
          },
        },
      }),
    }),
    [
      {
        op: "run",
        label: "hand the effect the system",
        fn: (system, { handles }) => {
          handles.system = system;
        },
      },
      { op: "start" },
      { op: "settle" },
      look("write a = 2", (system) => {
        system.facts.a = 2;

        return system.constraints.isDynamic("late");
      }),
      { op: "settle" },
      look("after settling", (system) => [
        system.constraints.isDynamic("late"),
        system.constraints.listDynamic(),
        system.facts.log,
      ]),
    ],
  );

  scenario(
    "unregistering a constraint while its resolver runs aborts the signal, and the write lands (U9a, 0 ms)",
    (ctx) => ({ module: probe(ctx) }),
    unregisterInFlight(0, false),
  );

  scenario(
    "unregistering a constraint while its resolver runs aborts the signal, and the write lands (U9a, 5 ms)",
    (ctx) => ({ module: probe(ctx) }),
    unregisterInFlight(5, false),
  );

  scenario(
    "an abortOn binding goes with the definition: its resolver is aborted, not detached (U9b, 0 ms)",
    (ctx) => ({ module: probe(ctx) }),
    unregisterInFlight(0, true),
  );

  scenario(
    "an abortOn binding goes with the definition: its resolver is aborted, not detached (U9b, 5 ms)",
    (ctx) => ({ module: probe(ctx) }),
    unregisterInFlight(5, true),
  );

  scenario(
    "a dynamic registration's pass is traced and snapshotted like any other (U14)",
    (ctx) => ({
      module: probe(ctx),
      trace: true,
      history: { maxSnapshots: 20 },
    }),
    [
      { op: "start" },
      { op: "settle" },
      look("before", (system) => ({
        runs: system.trace.length,
        snapshots: system.history.snapshots.length,
      })),
      {
        op: "run",
        label: "register a constraint and its resolver",
        fn: (system) => {
          system.resolvers.register("setB", {
            requirement: "WORK",
            resolve: async (_req: unknown, context: any) => {
              context.facts.b = 9;
            },
          });
          system.constraints.register("c", {
            when: (facts: any) => facts.b === 0,
            require: { type: "WORK" },
          });
        },
      },
      { op: "settle" },
      look("after", (system) => ({
        runs: system.trace.length,
        hits: system.trace.map((run: any) =>
          run.constraintsHit.map((c: any) => c.id),
        ),
        snapshots: system.history.snapshots.length,
        b: system.facts.b,
      })),
    ],
  );

  scenario(
    "registerModule takes one history snapshot, and snapshots carry the module's namespaced keys (U17)",
    (ctx) => historyBase(ctx),
    registerUnderHistory,
  );

  scenario(
    "goBack past a registration leaves the module's facts and restores the older ones (U18)",
    (ctx) => historyBase(ctx),
    [...registerUnderHistory, ...backPastRegistration],
  );

  scenario(
    "unregisterModule while navigated back drops the forward snapshots and takes its own (U19)",
    (ctx) => historyBase(ctx),
    [
      ...registerUnderHistory,
      ...backPastRegistration,
      {
        op: "run",
        label: "unregisterModule x",
        fn: async (system) => {
          await system.unregisterModule("x");
        },
      },
      { op: "settle" },
      snapshots("after unregisterModule"),
      look("x", (system) => system.facts.x ?? null),
    ],
  );

  scenario(
    "unregisterModule with a history changeset open takes its snapshot at once (U20)",
    (ctx) => historyBase(ctx),
    [
      { op: "start" },
      { op: "settle" },
      {
        op: "run",
        label: "registerModule x",
        fn: (system, ctx) => {
          system.registerModule("x", moduleX(ctx));
        },
      },
      { op: "settle" },
      snapshots("before"),
      {
        op: "run",
        label: "beginChangeset, unregisterModule x",
        fn: async (system) => {
          system.history.beginChangeset("cs");
          await system.unregisterModule("x");
        },
      },
      { op: "settle" },
      snapshots("with the changeset open"),
      {
        op: "run",
        label: "endChangeset",
        fn: (system) => {
          system.history.endChangeset();
        },
      },
      { op: "settle" },
      snapshots("after endChangeset"),
      look("x", (system) => system.facts.x ?? null),
    ],
  );

  scenario(
    "unregisterModule started inside system.batch runs its teardown (U20)",
    (ctx) => historyBase(ctx),
    [
      { op: "start" },
      { op: "settle" },
      {
        op: "run",
        label: "registerModule x",
        fn: (system, ctx) => {
          system.registerModule("x", moduleX(ctx));
        },
      },
      { op: "settle" },
      {
        op: "run",
        label: "unregisterModule x inside batch",
        fn: async (system) => {
          let done: Promise<unknown> | undefined;
          system.batch(() => {
            done = system.unregisterModule("x");
          });
          await done;
        },
      },
      { op: "settle" },
      snapshots("after"),
      look("x", (system) => system.facts.x ?? null),
    ],
  );
});
