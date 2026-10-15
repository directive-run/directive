/** L8: history — back, forward, effects on navigation, export/import, changesets. */

import { describe } from "vitest";
import { scenario } from "../scenario.js";

describe("L8 history", () => {
  scenario(
    "history: back, forward and effects re-run on navigation",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: { facts: { n: t.number() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.n = 0;
        },
        effects: {
          view: {
            deps: ["n"],
            run: (facts: any) => external(["view", facts.n]),
          },
          analytics: {
            deps: ["n"],
            onNavigate: "skip",
            run: (facts: any) => external(["analytics", facts.n]),
          },
        },
      } as any),
      history: { maxSnapshots: 20 },
    }),
    [
      { op: "start" },
      { op: "set", key: "n", value: 1 },
      { op: "settle" },
      { op: "set", key: "n", value: 2 },
      { op: "settle" },
      { op: "set", key: "n", value: 3 },
      { op: "settle" },
      { op: "back", steps: 2 },
      { op: "settle" },
      { op: "forward" },
      { op: "settle" },
      { op: "set", key: "n", value: 10 },
      { op: "settle" },
      {
        op: "run",
        label: "history state",
        fn: (system, { external }) =>
          external([
            "history",
            system.history.canGoBack,
            system.history.canGoForward,
            system.history.currentIndex,
            system.history.totalSnapshots,
          ]),
      },
    ],
  );

  scenario(
    "history: export, import and changesets",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: { facts: { n: t.number() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.n = 0;
        },
      } as any),
      history: { maxSnapshots: 10 },
      plugins: [
        {
          name: "nav",
          onHistoryNavigate: (from: number, to: number) =>
            external(["navigate", from, to]),
        },
      ],
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "changeset",
        fn: (system) => {
          system.history.beginChangeset("pair");
          system.facts.n = 1;
          system.facts.n = 2;
          system.history.endChangeset();
        },
      },
      { op: "settle" },
      { op: "set", key: "n", value: 3 },
      { op: "settle" },
      {
        op: "run",
        label: "export, go back, import",
        fn: (system, { external }) => {
          const saved = system.history.export();
          external(["exported", JSON.parse(saved)]);
          system.history.goBack();
          system.history.import(saved);
        },
      },
      { op: "settle" },
    ],
  );
});
