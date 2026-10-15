/** L8: history goTo, replay, pause/resume, onNavigate on goTo, limits. */

import { type BuildContext, scenario, suite } from "../scenario.js";

function counter({ core: { createModule, t }, external }: BuildContext) {
  return createModule("m", {
    schema: {
      facts: { n: t.number(), label: t.string() },
      derivations: { double: t.number() },
      events: {},
    },
    init: (facts: any) => {
      facts.n = 0;
      facts.label = "";
    },
    derive: { double: (facts: any) => facts.n * 2 },
    effects: {
      view: { deps: ["n"], run: (facts: any) => external(["view", facts.n]) },
      audit: {
        deps: ["n"],
        onNavigate: "skip",
        run: (facts: any) => external(["audit", facts.n]),
      },
    },
  } as any);
}

const writes = (values: number[]) =>
  values.flatMap((value) => [
    { op: "set" as const, key: "n", value },
    { op: "settle" as const },
  ]);

suite("L8 history navigation", () => {
  scenario(
    "history goTo a snapshot id, then replay",
    (ctx) => ({
      module: counter(ctx),
      history: { maxSnapshots: 5 },
    }),
    [
      { op: "start" },
      ...writes([1, 2, 3, 4, 5, 6]),
      {
        op: "run",
        label: "goTo the oldest kept snapshot",
        fn: (system, { external }) => {
          const ids = system.history.snapshots.map((s: any) => s.id);
          external([
            "kept",
            ids,
            system.history.snapshots.map((s: any) => s.trigger),
          ]);
          system.history.goTo(ids[0]);
        },
      },
      { op: "settle" },
      {
        op: "run",
        label: "replay",
        fn: (system) => system.history.replay(),
      },
      { op: "settle" },
    ],
  );

  scenario(
    "history pause and resume skip snapshots while paused",
    (ctx) => ({ module: counter(ctx), history: true }),
    [
      { op: "start" },
      ...writes([1]),
      {
        op: "run",
        label: "pause",
        fn: (system) => system.history.pause(),
      },
      ...writes([2, 3]),
      {
        op: "run",
        label: "resume",
        fn: (system, { external }) => {
          external(["paused?", system.history.isPaused]);
          system.history.resume();
        },
      },
      ...writes([4]),
      { op: "back" },
      { op: "settle" },
    ],
  );

  scenario(
    "onNavigate rerun vs skip on goTo, and onHistoryChange",
    (ctx) => ({ module: counter(ctx), history: { maxSnapshots: 10 } }),
    [
      { op: "start" },
      {
        op: "run",
        label: "listen for history changes",
        fn: (system, { external }) =>
          system.onHistoryChange(() =>
            external(["history changed", system.history.currentIndex]),
          ),
      },
      ...writes([1, 2, 3]),
      {
        op: "run",
        label: "goTo the first snapshot",
        fn: (system) => system.history.goTo(system.history.snapshots[0].id),
      },
      { op: "settle" },
      { op: "forward", steps: 2 },
      { op: "settle" },
      { op: "set", key: "n", value: 7 },
      { op: "settle" },
    ],
  );
});
