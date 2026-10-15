/** L1: modules, namespacing, crossModuleDeps and read-only effect views. */

import { describe } from "vitest";
import { scenario } from "../scenario.js";

describe("L1 modules and namespacing", () => {
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
