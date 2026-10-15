/** L1: modules, namespacing, crossModuleDeps and read-only effect views. */

import { scenario, suite } from "../scenario.js";

suite("L1 modules and namespacing", () => {
  scenario(
    "namespaced modules keep their facts apart",
    ({ core: { createModule, t } }) => {
      const make = (id: string, start: number) =>
        createModule(id, {
          schema: {
            facts: { n: t.number() },
            derivations: { twice: t.number() },
            events: { bump: {} },
          },
          init: (facts: any) => {
            facts.n = start;
          },
          derive: { twice: (facts: any) => facts.n * 2 },
          events: {
            bump: (facts: any) => {
              facts.n += 1;
            },
          },
        } as any);

      return { modules: { left: make("left", 1), right: make("right", 10) } };
    },
    [
      { op: "start" },
      { op: "set", key: "left.n", value: 5 },
      { op: "settle" },
      {
        op: "run",
        label: "bump right",
        fn: (system) => system.events.right.bump(),
      },
      { op: "settle" },
    ],
  );

  scenario(
    "an effect's write is blocked (facts are read-only in effects)",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), echo: t.number() },
          derivations: {},
          events: {},
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.echo = 0;
        },
        effects: {
          writer: {
            deps: ["n"],
            run: (facts: any) => {
              external(["before", facts.n]);
              facts.echo = facts.n;
              external(["after", facts.echo]);
            },
          },
        },
      } as any),
    }),
    [{ op: "start" }, { op: "set", key: "n", value: 3 }, { op: "settle" }],
  );
});
