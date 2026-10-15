/**
 * L13: the public surface itself — every export of the root and /plugins
 * entries by name and kind — and the small helpers no system exercises:
 * requirement helpers, createSystemWithStatus, the requirement-status
 * plugin, typed definition helpers, shallowEqual.
 */

import { scenario, suite } from "../scenario.js";

function surface(entry: Record<string, unknown>) {
  return Object.keys(entry)
    .sort()
    .map((name) => {
      const value = entry[name];
      const kind =
        typeof value === "function"
          ? /^class\s/.test(Function.prototype.toString.call(value))
            ? "class"
            : "function"
          : value === null
            ? "null"
            : typeof value;
      const keys =
        value && typeof value === "object" ? Object.keys(value).sort() : [];

      return [name, kind, keys];
    });
}

suite("L13 the public surface", () => {
  scenario(
    "every root and /plugins export, by name and kind",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: { facts: { n: t.number() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.n = 0;
        },
      } as any),
    }),
    [
      {
        op: "run",
        label: "list exports",
        fn: (_s, { core, plugins, external }) => {
          external(["root", surface(core as Record<string, unknown>)]);
          external(["plugins", surface(plugins)]);
          external(["Backoff", (core as any).Backoff]);
        },
      },
    ],
  );

  scenario(
    "requirement helpers, typed helpers and the status plugin",
    ({ core, external, handles }) => {
      const { createModule, t } = core as any;
      const status = core.createRequirementStatusPlugin();
      handles.status = status;

      return {
        module: createModule("m", {
          schema: {
            facts: { go: t.boolean(), done: t.boolean() },
            derivations: {},
            events: {},
            requirements: { LOAD: { id: t.string() } },
          },
          init: (facts: any) => {
            facts.go = false;
            facts.done = false;
          },
          constraints: {
            load: core.typedConstraint({
              when: (facts: any) => facts.go && !facts.done,
              require: core.req("LOAD")({ id: "a" }),
            } as never),
          },
          resolvers: {
            load: core.typedResolver({
              requirement: "LOAD",
              resolve: async (_req: unknown, context: any) => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                context.facts.done = true;
              },
            } as never),
          },
        }),
        plugins: [status.plugin],
        $: external,
      };
    },
    [
      { op: "start" },
      {
        op: "run",
        label: "helpers",
        fn: (_s, { core, external }) => {
          const c = core as any;
          const r = c.req("LOAD")({ id: "x" });
          external(["req", r, c.isRequirementType(r, "LOAD")]);
          external(["forType", c.forType("LOAD")(r), c.forType("OTHER")(r)]);
          external(["id", c.generateRequirementId(r)]);
          const set = new c.RequirementSet();
          set.add({ id: "LOAD:x", requirement: r, fromConstraint: "c" });
          external(["set", set.size ?? null, set.has?.("LOAD:x") ?? null]);
          external([
            "shallowEqual",
            c.shallowEqual({ a: 1 }, { a: 1 }),
            c.shallowEqual({ a: 1 }, { a: 2 }),
          ]);
        },
      },
      { op: "set", key: "go", value: true },
      { op: "advance", ms: 2 },
      {
        op: "run",
        label: "status while loading",
        fn: (_s, { handles, external }) =>
          external(["status", handles.status.getStatus("LOAD")]),
      },
      { op: "settle" },
      {
        op: "run",
        label: "status after",
        fn: (_s, { handles, external }) =>
          external(["status", handles.status.getStatus("LOAD")]),
      },
    ],
  );

  scenario(
    "createSystemWithStatus wires the status plugin in",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: { facts: { n: t.number() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.n = 0;
        },
      } as any),
    }),
    [
      {
        op: "run",
        label: "a second system with status",
        fn: async (_s, { core, external }) => {
          const { createModule, t } = core as any;
          const made = (core as any).createSystemWithStatus({
            module: createModule("s", {
              schema: { facts: { n: t.number() }, derivations: {}, events: {} },
              init: (facts: any) => {
                facts.n = 1;
              },
            }),
          });
          external(["keys", Object.keys(made).sort()]);
          made.system?.start?.();
          await made.system?.settle?.();
          external(["n", made.system?.facts?.n ?? null]);
          made.system?.destroy?.();
        },
      },
    ],
  );
});
