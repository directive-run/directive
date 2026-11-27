/**
 * L13-pre's diff pins from the L13 RFC's untested list: U10 (every
 * /adapter-utils export: the inspect state, the history state on and off,
 * the selector's tracked keys with the prefixed derivation key, the fact and
 * hydration helpers, the bridge helpers), U11 (`depsChanged` is order
 * sensitive) and U17 (/migration: the five functions over a Redux, a
 * Zustand and an XState fixture, every string compared). On v2 they fail
 * until L13b builds the entries; they are placed at L13.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

function counter({ core: { createModule, t } }: BuildContext) {
  return createModule("counter", {
    schema: {
      facts: { n: t.number(), label: t.string() },
      derivations: { double: t.number() },
      events: { inc: {} },
      requirements: {},
    },
    init: (facts: any) => {
      facts.n = 1;
      facts.label = "a";
    },
    derive: { double: (facts: any) => facts.n * 2 },
    events: {
      inc: (facts: any) => {
        facts.n = facts.n + 1;
      },
    },
  } as any);
}

const au = (ctx: BuildContext) => ctx.entries["./adapter-utils"] as any;

/** The own keys of a state object, with the kind of each member. */
const shape = (value: Record<string, unknown> | null) =>
  value === null
    ? null
    : Object.keys(value)
        .sort()
        .map((k) => [k, typeof value[k]]);

suite("L13 pins", () => {
  scenario(
    "/adapter-utils over a live system (U10, U11)",
    (ctx) => ({ module: counter(ctx) }),
    [
      { op: "start" },
      { op: "settle" },
      {
        op: "run",
        label: "inspect state, picked facts, equality, hydration",
        fn: (system, ctx) => {
          const u = au(ctx);
          ctx.external(["inspectState", u.computeInspectState(system)]);
          ctx.external(["pick", u.pickFacts(system, ["n", "label", "none"])]);
          ctx.external([
            "equality",
            u.defaultEquality(Number.NaN, Number.NaN),
            u.defaultEquality(0, -0),
            u.defaultEquality({}, {}),
          ]);
          ctx.external([
            "hydrate",
            u.mergeHydrationFacts({ data: { n: 5 } }, { n: 1, label: "x" }),
            u.mergeHydrationFacts({ n: 6 }, { n: 1, label: "x" }),
            u.mergeHydrationFacts({ data: null }, { n: 1 }),
            u.mergeHydrationFacts({ data: 3 }, { n: 1 }),
            u.mergeHydrationFacts(null, { n: 1 }),
            u.mergeHydrationFacts(undefined),
          ]);
          ctx.external([
            "shallowEqual",
            u.shallowEqual({ a: 1 }, { a: 1 }),
            u.shallowEqual({ a: 1 }, { a: 1, b: 2 }),
            u.shallowEqual({ a: {} }, { a: {} }),
          ]);
        },
      },
      {
        op: "run",
        label: "selector tracking (the derivation key is prefixed)",
        fn: (system, ctx) => {
          const u = au(ctx);
          const one = u.runTrackedSelector(
            system,
            new Set(["double"]),
            (s: any) => s.double + s.n,
          );
          const two = u.runTrackedSelector(
            system,
            new Set(["double"]),
            (s: any) => s.label,
          );
          const none = u.runTrackedSelector(
            system,
            new Set(["double"]),
            () => 7,
          );
          ctx.external(["selector", one, two, none]);
        },
      },
      {
        op: "run",
        label: "depsChanged is order sensitive (U11)",
        fn: (_system, ctx) => {
          const u = au(ctx);
          ctx.external([
            "deps",
            u.depsChanged(["a", "b"], ["a", "b"], ["x"], ["x"]),
            u.depsChanged(["a", "b"], ["b", "a"], [], []),
            u.depsChanged(["a"], ["a", "b"], [], []),
            u.depsChanged([], [], ["x", "y"], ["y", "x"]),
            u.depsChanged([], [], ["x"], []),
          ]);
        },
      },
      {
        op: "run",
        label: "bridge helpers and requirement guards",
        fn: (system, ctx) => {
          const u = au(ctx);
          u.setBridgeFact(system.facts, "label", "bridged");
          ctx.external(["bridge", u.getBridgeFact(system.facts, "label")]);
          const one = u.requirementGuard("A");
          const many = u.requirementGuardMultiple(["A", "B"]);
          ctx.external([
            "guards",
            one({ type: "A" }),
            one({ type: "B" }),
            many({ type: "B" }),
            many({ type: "C" }),
          ]);
          const seen: unknown[] = [];
          const plugin = u.createCallbackPlugin("cb", {
            onRequirementCreated: (r: unknown) => seen.push(["created", r]),
            onRequirementResolved: (r: unknown) => seen.push(["met", r]),
          });
          plugin.onRequirementCreated?.({
            id: "i",
            requirement: { type: "A" },
          });
          plugin.onRequirementMet?.(
            { id: "i", requirement: { type: "A" } },
            "r",
          );
          ctx.external([
            "callbackPlugin",
            plugin.name,
            Object.keys(plugin).sort(),
            seen,
            Object.keys(u.createCallbackPlugin("empty", {})).sort(),
          ]);
        },
      },
      {
        op: "run",
        label:
          "the system's tracker sees what a selector read outside the proxy",
        fn: (system, ctx) => {
          const u = au(ctx);
          const out = u.runTrackedSelector(
            system,
            new Set(["double"]),
            () => system.facts.n + system.facts.label,
          );
          ctx.external(["closure read", out]);
        },
      },
    ],
  );

  scenario(
    "/adapter-utils history state on and off (U10)",
    (ctx) => ({ module: counter(ctx), history: { maxSnapshots: 10 } }),
    [
      { op: "start" },
      { op: "settle" },
      { op: "set", key: "n", value: 2 },
      { op: "set", key: "n", value: 3 },
      {
        op: "run",
        label: "history state",
        fn: (system, ctx) => {
          const state = au(ctx).buildHistoryState(system);
          ctx.external([
            "history",
            shape(state),
            state.canGoBack,
            state.canGoForward,
            state.currentIndex,
            state.totalSnapshots,
            state.snapshots.map((s: any) => [s.id, s.trigger]),
            state.getSnapshotFacts(state.snapshots[0].id),
            state.getSnapshotFacts(-1),
            state.isPaused,
          ]);
          state.goBack();
          ctx.external(["back", state.currentIndex, system.facts.n]);
          state.pause();
          ctx.external(["paused", au(ctx).buildHistoryState(system).isPaused]);
          state.resume();
        },
      },
    ],
  );

  scenario(
    "/adapter-utils history state is null with history off (U10)",
    (ctx) => ({ module: counter(ctx) }),
    [
      { op: "start" },
      {
        op: "run",
        label: "no history",
        fn: (system, ctx) => {
          ctx.external(["none", au(ctx).buildHistoryState(system)]);
        },
      },
    ],
  );

  scenario(
    "/adapter-utils throttle on the scenario fake clock: a trailing call with the latest arguments, and cleanup (U10)",
    (ctx) => ({ module: counter(ctx) }),
    [
      { op: "start" },
      {
        op: "run",
        label: "throttle",
        fn: (_system, ctx) => {
          const { throttled, cleanup } = au(ctx).createThrottle(
            (...args: unknown[]) => ctx.external(["called", ...args]),
            100,
          );
          ctx.handles.cleanup = cleanup;
          throttled(1);
          throttled(2);
          throttled(3);
          const second = au(ctx).createThrottle(
            (...args: unknown[]) => ctx.external(["second", ...args]),
            100,
          );
          second.throttled("a");
          second.throttled("b");
          second.cleanup();
        },
      },
      { op: "advance", ms: 50 },
      { op: "advance", ms: 60 },
      { op: "advance", ms: 500 },
    ],
  );

  scenario(
    "/migration over a Redux, a Zustand and an XState fixture (U17)",
    (ctx) => ({ module: counter(ctx) }),
    [
      {
        op: "run",
        label: "the five functions",
        fn: (_system, ctx) => {
          const m = ctx.entries["./migration"] as any;
          const redux = {
            name: "counter",
            initialState: {
              value: 0,
              status: "idle",
              items: [],
              user: null,
              ok: true,
            },
            reducers: {
              increment: (state: any) => {
                state.value += 1;
              },
              add: (state: any, action: any) => {
                state.value += action.payload;
              },
              reset: (state: any) => {
                state.value = 0;
              },
            },
          };
          const zustand = {
            state: { count: 0, name: "z", list: [], flag: false },
            actions: {
              inc: (..._a: unknown[]) => undefined,
              setName: (..._a: unknown[]) => undefined,
            },
          };
          const xstate = {
            id: "toggle",
            initial: "off",
            states: {
              off: { on: { TOGGLE: "on", PING: { target: "off" } } },
              on: { on: { TOGGLE: "off" } },
              done: {},
            },
            context: { count: 0, who: "x" },
          };
          const structures = [
            m.analyzeReduxSlice(redux),
            m.analyzeZustandStore(zustand),
            m.analyzeXStateMachine(xstate),
          ];
          ctx.external(["structures", structures]);
          ctx.external([
            "code",
            structures.map((s) => m.generateModuleCode(s)),
          ]);
          ctx.external([
            "checklists",
            ["redux", "zustand", "xstate"].map((k) =>
              m.generateMigrationChecklist(k),
            ),
            m.generateMigrationChecklist("nothing"),
          ]);
          ctx.external([
            "empty",
            m.analyzeReduxSlice({
              name: "e",
              initialState: {},
              reducers: {},
            }),
          ]);
        },
      },
    ],
  );
});
