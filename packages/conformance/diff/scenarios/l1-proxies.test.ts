/**
 * L1: what the fact, derive and events proxies answer to reflection —
 * keys, `in`, spreads, JSON, unknown keys, namespaced access — on single
 * and namespaced systems, and inside an effect's read-only view.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

function profile({ core: { createModule, t } }: BuildContext, id: string) {
  return createModule(id, {
    schema: {
      facts: {
        name: t.string(),
        tags: t.array<string>(),
        meta: t.object<Record<string, number>>(),
      },
      derivations: { upper: t.string() },
      events: { rename: { to: t.string() } },
    },
    init: (facts: any) => {
      facts.name = id;
      facts.tags = ["a"];
      facts.meta = { v: 1 };
    },
    derive: { upper: (facts: any) => facts.name.toUpperCase() },
    events: {
      rename: (facts: any, event: any) => {
        facts.name = event.to;
      },
    },
  } as any);
}

function reflect(
  target: any,
  external: (data: unknown) => void,
  label: string,
) {
  const attempt = (what: string, fn: () => unknown) => {
    try {
      external([label, what, fn()]);
    } catch (error) {
      external([label, what, "threw", error]);
    }
  };
  attempt("keys", () => Object.keys(target).sort());
  attempt("in name", () => "name" in target);
  attempt("in nope", () => "nope" in target);
  attempt("spread", () => ({ ...target }));
  attempt("json", () => JSON.parse(JSON.stringify(target)));
  attempt("unknown read", () => target.nope);
  attempt(
    "descriptor",
    () => Object.getOwnPropertyDescriptor(target, "name")?.value ?? null,
  );
  attempt("entries", () => Object.entries(target).length);
}

suite("L1 proxies and views", () => {
  scenario(
    "single-module facts, derive and events proxies under reflection",
    (ctx) => ({ module: profile(ctx, "me") }),
    [
      { op: "start" },
      {
        op: "run",
        label: "reflect",
        fn: (system, { external }) => {
          reflect(system.facts, external, "facts");
          reflect(system.derive, external, "derive");
          external(["events keys", Object.keys(system.events).sort()]);
          system.events.rename({ to: "you" });
          try {
            system.facts.nope = 1;
          } catch (error) {
            external(["write unknown", error]);
          }
          system.facts.tags = [...system.facts.tags, "b"];
        },
      },
      { op: "settle" },
    ],
  );

  scenario(
    "namespaced facts, derive and events proxies under reflection",
    (ctx) => ({
      modules: { left: profile(ctx, "left"), right: profile(ctx, "right") },
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "reflect",
        fn: (system, { external }) => {
          reflect(system.facts, external, "facts");
          reflect(system.facts.left, external, "facts.left");
          reflect(system.derive, external, "derive");
          reflect(system.derive.right, external, "derive.right");
          external([
            "events",
            Object.keys(system.events).sort(),
            Object.keys(system.events.left).sort(),
          ]);
          system.events.right.rename({ to: "R" });
          try {
            system.facts.left = { name: "x" };
          } catch (error) {
            external(["replace namespace", error]);
          }
          try {
            system.facts.nope.name = "x";
          } catch (error) {
            external(["unknown namespace", error]);
          }
        },
      },
      { op: "settle" },
    ],
  );

  scenario(
    "an effect's read-only view under reflection",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { list: t.array<number>(), obj: t.object<{ a: number }>() },
          derivations: {},
          events: {},
        },
        init: (facts: any) => {
          facts.list = [1, 2];
          facts.obj = { a: 1 };
        },
        effects: {
          look: {
            run: (facts: any, prev: any) => {
              reflect(facts, external, "view");
              external(["prev keys", prev ? Object.keys(prev).sort() : null]);
              for (const mutate of [
                () => facts.list.push(3),
                () => {
                  facts.obj.a = 2;
                },
                () => {
                  // biome-ignore lint/performance/noDelete: the delete operator is what is under test
                  delete facts.obj;
                },
              ]) {
                try {
                  mutate();
                  external(["mutated"]);
                } catch (error) {
                  external(["refused", error]);
                }
              }
            },
          },
        },
      } as any),
    }),
    [{ op: "start" }, { op: "set", key: "list", value: [5] }, { op: "settle" }],
  );
});
