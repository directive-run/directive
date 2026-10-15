/** L4: effects — deps, prev, cleanup, auto-tracking and errors. */

import { scenario, suite } from "../scenario.js";

suite("L4 effects", () => {
  scenario(
    "effects: deps, prev, cleanup and auto-tracking",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { a: t.number(), b: t.number(), on: t.boolean() },
          derivations: {},
          events: {},
        },
        init: (facts: any) => {
          facts.a = 0;
          facts.b = 0;
          facts.on = true;
        },
        effects: {
          explicit: {
            deps: ["a"],
            run: (facts: any, prev: any) => {
              external(["explicit", facts.a, prev?.a ?? null]);

              return () => external(["cleanup explicit", facts.a]);
            },
          },
          tracked: {
            run: (facts: any) => {
              external(["tracked", facts.on ? facts.a : facts.b]);
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "a", value: 1 },
      { op: "settle" },
      { op: "set", key: "b", value: 5 },
      { op: "settle" },
      { op: "set", key: "on", value: false },
      { op: "settle" },
      { op: "set", key: "b", value: 6 },
      { op: "set", key: "a", value: 2 },
      { op: "settle" },
      { op: "destroy" },
    ],
  );

  scenario(
    "effects: a throwing effect goes to the boundary and keeps running",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: { facts: { n: t.number() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.n = 0;
        },
        effects: {
          sometimes: {
            deps: ["n"],
            run: (facts: any) => {
              external(["run", facts.n]);
              if (facts.n === 1) {
                throw new Error("effect failed");
              }
            },
          },
        },
      } as any),
      errorBoundary: { onEffectError: "skip" },
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
