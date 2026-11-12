/**
 * L8 pins: what 1.35 does with history in the places no other scenario looks
 * (the L8 RFC, "Untested behaviours" U4, U5, U7, U13, U14 and U17). Each
 * `look` step reports where history is (the index, the ids, the paused flag
 * and the facts), so an approved difference shows as exact records, not as a
 * different trace somewhere. A scenario pins 1.35 and names the candidate row
 * it shows; the signed entry for the row is added with the row.
 */

import {
  type AnySystem,
  type BuildContext,
  type Step,
  scenario,
  suite,
} from "../scenario.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A step that reports history's position, its ids, the pause and the facts. */
const look = (label: string, keys: string[] = ["n"]): Step => ({
  op: "run",
  label,
  fn: (system: AnySystem, { external }) =>
    external([
      label,
      {
        index: system.history.currentIndex,
        ids: system.history.snapshots.map((s: any) => s.id),
        paused: system.history.isPaused,
        facts: Object.fromEntries(keys.map((k) => [k, system.facts[k]])),
      },
    ]),
});

const writes = (key: string, values: unknown[]): Step[] =>
  values.flatMap((value) => [
    { op: "set" as const, key, value },
    { op: "settle" as const },
  ]);

/** One number fact and an effect that reports each run, navigation or not. */
function counter({ core: { createModule, t }, external }: BuildContext) {
  return createModule("m", {
    schema: { facts: { n: t.number() }, derivations: {}, events: {} },
    init: (facts: any) => {
      facts.n = 0;
    },
    effects: {
      view: { deps: ["n"], run: (facts: any) => external(["view", facts.n]) },
    },
  } as any);
}

suite("L8 history pins", () => {
  scenario(
    "a navigation clears a pause, and the next write takes a snapshot (U4)",
    (ctx) => ({ module: counter(ctx), history: { maxSnapshots: 20 } }),
    [
      { op: "start" },
      ...writes("n", [1, 2]),
      {
        op: "run",
        label: "pause",
        fn: (system) => system.history.pause(),
      },
      look("paused"),
      { op: "back" },
      { op: "settle" },
      look("after the navigation"),
      ...writes("n", [7]),
      look("after the next write"),
    ],
  );

  scenario(
    "replay() and import() tell no listener; goTo the current id does (U5)",
    (ctx) => ({
      module: counter(ctx),
      history: { maxSnapshots: 20 },
      plugins: [
        {
          name: "nav",
          onHistoryNavigate: (from: number, to: number) =>
            ctx.external(["navigate hook", from, to]),
        },
      ],
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "listen for history changes",
        fn: (system, { external }) =>
          system.onHistoryChange(() =>
            external(["listener", system.history.currentIndex]),
          ),
      },
      ...writes("n", [1, 2]),
      {
        op: "run",
        label: "replay",
        fn: (system) => system.history.replay(),
      },
      { op: "settle" },
      look("after replay"),
      {
        op: "run",
        label: "goTo the current id",
        fn: (system) =>
          system.history.goTo(
            system.history.snapshots[system.history.currentIndex].id,
          ),
      },
      { op: "settle" },
      look("after goTo the current id"),
      {
        op: "run",
        label: "import what export gave",
        fn: (system) => system.history.import(system.history.export()),
      },
      { op: "settle" },
      look("after import"),
    ],
  );

  scenario(
    "a changeset keeps its indexes when the buffer drops snapshots (U7)",
    (ctx) => ({ module: counter(ctx), history: { maxSnapshots: 4 } }),
    [
      { op: "start" },
      {
        op: "run",
        label: "begin changeset A",
        fn: (system) => system.history.beginChangeset("A"),
      },
      ...writes("n", [1, 2]),
      {
        op: "run",
        label: "end changeset A",
        fn: (system) => system.history.endChangeset(),
      },
      look("before the buffer overflows"),
      { op: "back" },
      { op: "settle" },
      look("undo crosses the changeset"),
      { op: "forward" },
      { op: "settle" },
      look("redo crosses it back"),
      ...writes("n", [3, 4, 5, 6]),
      look("the buffer has dropped the changeset's snapshots"),
      { op: "back" },
      { op: "settle" },
      look("first undo"),
      { op: "back" },
      { op: "settle" },
      look("second undo"),
      { op: "forward" },
      { op: "settle" },
      look("redo"),
    ],
  );

  scenario(
    "a changeset keeps its indexes when a new snapshot cuts off redo (U7)",
    (ctx) => ({ module: counter(ctx), history: { maxSnapshots: 20 } }),
    [
      { op: "start" },
      ...writes("n", [1]),
      {
        op: "run",
        label: "begin changeset A",
        fn: (system) => system.history.beginChangeset("A"),
      },
      ...writes("n", [2, 3]),
      {
        op: "run",
        label: "end changeset A",
        fn: (system) => system.history.endChangeset(),
      },
      look("at the end of A"),
      { op: "back" },
      { op: "settle" },
      look("undo from inside A"),
      { op: "back" },
      { op: "settle" },
      look("undo to the start"),
      ...writes("n", [10, 11, 12]),
      look("three new snapshots cut off the old redo"),
      { op: "back" },
      { op: "settle" },
      look("one undo"),
    ],
  );

  scenario(
    "a changeset keeps its indexes across an import (U7)",
    (ctx) => ({ module: counter(ctx), history: { maxSnapshots: 20 } }),
    [
      { op: "start" },
      ...writes("n", [1, 2, 3, 4, 5]),
      {
        op: "run",
        label: "export five snapshots",
        fn: (system, { handles }) => {
          handles.saved = system.history.export();
        },
      },
      { op: "back", steps: 3 },
      { op: "settle" },
      look("back to the third snapshot"),
      {
        op: "run",
        label: "begin changeset A",
        fn: (system) => system.history.beginChangeset("A"),
      },
      ...writes("n", [20, 21]),
      {
        op: "run",
        label: "end changeset A",
        fn: (system) => system.history.endChangeset(),
      },
      {
        op: "run",
        label: "import the export, which has no changeset",
        fn: (system, { handles }) => system.history.import(handles.saved),
      },
      { op: "settle" },
      look("after the import"),
      { op: "back" },
      { op: "settle" },
      look("first undo"),
      { op: "back" },
      { op: "settle" },
      look("second undo"),
    ],
  );

  scenario(
    "the first snapshot is taken after start(), labelled with the init keys (U13)",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: {
            n: t.number(),
            a: t.number(),
            b: t.number(),
            c: t.number(),
            email: t.string(),
          },
          derivations: {},
          events: { bump: {} },
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.a = 0;
          facts.b = 0;
          facts.c = 0;
          facts.email = "a@b.c";
        },
        events: {
          bump: (facts: any) => {
            facts.n += 1;
          },
        },
      } as any),
      history: true,
      plugins: [
        {
          name: "snapshots",
          onSnapshot: (snapshot: any) =>
            external(["snapshot", snapshot.id, snapshot.trigger]),
        },
      ],
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "right after start()",
        fn: (system, { external }) =>
          external([
            "triggers",
            system.history.snapshots.map((s: any) => s.trigger),
          ]),
      },
      { op: "settle" },
      look("settled", ["n", "a"]),
      { op: "set", key: "n", value: 1 },
      { op: "set", key: "a", value: 1 },
      { op: "settle" },
      look("two writes, each its own pass", ["n", "a"]),
      {
        op: "batch",
        writes: [
          ["n", 5],
          ["a", 5],
        ],
      },
      { op: "settle" },
      look("two writes in one batch: one pass, one snapshot", ["n", "a"]),
      { op: "dispatch", event: { type: "bump" } },
      { op: "settle" },
      look("an event", ["n", "a"]),
    ],
  );

  /** A module whose `slow` fact raises WORK, a resolver that takes 50 ms. */
  function work({ core: { createModule, t }, external }: BuildContext) {
    return createModule("m", {
      schema: {
        facts: { n: t.number(), slow: t.boolean(), done: t.boolean() },
        derivations: {},
        events: {},
        requirements: { WORK: {} },
      },
      init: (facts: any) => {
        facts.n = 0;
        facts.slow = false;
        facts.done = false;
      },
      constraints: {
        need: {
          when: (facts: any) => facts.slow && !facts.done,
          require: { type: "WORK" },
        },
      },
      resolvers: {
        work: {
          requirement: "WORK",
          resolve: async (_req: unknown, context: any) => {
            external(["resolver starts"]);
            await wait(50);
            context.facts.done = true;
            external(["resolver ends"]);
          },
        },
      },
    } as any);
  }

  scenario(
    "a navigation while a resolver runs: its late write takes a snapshot that cuts off redo (U14)",
    (ctx) => ({ module: work(ctx), history: { maxSnapshots: 20 } }),
    [
      { op: "start" },
      ...writes("n", [1]),
      { op: "set", key: "slow", value: true },
      { op: "advance", ms: 5 },
      look("the resolver is running", ["n", "slow", "done"]),
      { op: "back" },
      { op: "advance", ms: 5 },
      look("a navigation while it runs", ["n", "slow", "done"]),
      { op: "advance", ms: 100 },
      { op: "settle" },
      look("after its late write", ["n", "slow", "done"]),
    ],
  );

  /** A batched resolver fed by `want`: one call for the ids, then `status`. */
  function batched(
    { core: { createModule, t }, external }: BuildContext,
    windowMs: number,
    runMs: number,
  ) {
    return createModule("m", {
      schema: {
        facts: {
          n: t.number(),
          want: t.array<string>(),
          status: t.string(),
        },
        derivations: {},
        events: {},
        requirements: { FETCH: { id: t.string() } },
      },
      init: (facts: any) => {
        facts.n = 0;
        facts.want = [];
        facts.status = "idle";
      },
      constraints: {
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
          batch: { enabled: true, windowMs },
          resolveBatch: async (reqs: Array<{ id: string }>, context: any) => {
            external(["batch starts", reqs.map((r) => r.id)]);
            await wait(runMs);
            context.facts.status = "done";
            external(["batch ends"]);
          },
        },
      },
    } as any);
  }

  const batchKeys = ["n", "want", "status"];

  scenario(
    "a navigation while a batch is queued: the batch still runs and its write cuts off redo (U14)",
    (ctx) => ({
      module: batched(ctx, 50, 0),
      history: { maxSnapshots: 20 },
    }),
    [
      { op: "start" },
      ...writes("n", [1, 2]),
      { op: "set", key: "want", value: ["a", "b"] },
      { op: "advance", ms: 5 },
      look("the batch is queued", batchKeys),
      { op: "back" },
      { op: "advance", ms: 5 },
      look("a navigation while it is queued", batchKeys),
      { op: "advance", ms: 100 },
      { op: "settle" },
      look("after the window closes", batchKeys),
    ],
  );

  scenario(
    "a navigation while a batch runs: the batch still ends and its write cuts off redo (U14)",
    (ctx) => ({
      module: batched(ctx, 10, 50),
      history: { maxSnapshots: 20 },
    }),
    [
      { op: "start" },
      ...writes("n", [1, 2]),
      { op: "set", key: "want", value: ["a", "b"] },
      { op: "advance", ms: 20 },
      look("the batch is running", batchKeys),
      { op: "back" },
      { op: "advance", ms: 5 },
      look("a navigation while it runs", batchKeys),
      { op: "advance", ms: 100 },
      { op: "settle" },
      look("after it ends", batchKeys),
    ],
  );

  scenario(
    "a navigation that moves a derivation an effect reads wakes the effect, and constraints do not see a change (U17)",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number() },
          derivations: { doubled: t.number() },
          events: {},
          requirements: { NOTE: {} },
        },
        init: (facts: any) => {
          facts.n = 0;
        },
        derive: { doubled: (facts: any) => facts.n * 2 },
        constraints: {
          big: {
            when: (_facts: any, derived: any) => derived.doubled > 4,
            require: { type: "NOTE" },
          },
        },
        resolvers: {
          note: {
            requirement: "NOTE",
            resolve: async () => {
              external(["resolver NOTE"]);
            },
          },
        },
        effects: {
          mirror: {
            run: (_facts: any, _prev: any, derived: any) =>
              external(["effect mirror", derived.doubled]),
          },
        },
      } as any),
      history: { maxSnapshots: 20 },
    }),
    [
      { op: "start" },
      ...writes("n", [1, 3]),
      look("doubled is 6 and the constraint has fired", ["n"]),
      { op: "back" },
      { op: "settle" },
      look("back: doubled is 2", ["n"]),
      { op: "forward" },
      { op: "settle" },
      look("forward: doubled is 6 again", ["n"]),
    ],
  );
});
