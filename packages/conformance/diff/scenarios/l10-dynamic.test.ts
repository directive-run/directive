/** L10: dynamic definitions and modules registered at runtime. */

import { type BuildContext, scenario, suite } from "../scenario.js";

function counterModule(
  { core: { createModule, t } }: BuildContext,
  id = "counter",
) {
  return createModule(id, {
    schema: {
      facts: { count: t.number(), label: t.string() },
      derivations: { double: t.number() },
      events: { inc: {} },
      requirements: { INCREMENT: {}, LABEL: {} },
    },
    init: (facts: any) => {
      facts.count = 0;
      facts.label = "";
    },
    derive: { double: (facts: any) => facts.count * 2 },
    events: {
      inc: (facts: any) => {
        facts.count += 1;
      },
    },
  } as any);
}

suite("L10 dynamic definitions and modules", () => {
  scenario(
    "constraints, resolvers, effects and derivations registered, assigned, called, unregistered",
    (ctx) => ({ module: counterModule(ctx) }),
    [
      { op: "start" },
      {
        op: "run",
        label: "register",
        fn: (system, { external }) => {
          system.resolvers.register("label", {
            requirement: "LABEL",
            resolve: async (_req: unknown, context: any) => {
              context.facts.label = `count ${context.facts.count}`;
            },
          });
          system.constraints.register("labelIt", {
            when: (facts: any) =>
              facts.count > 1 && facts.label !== `count ${facts.count}`,
            require: { type: "LABEL" },
          });
          system.effects.register("echo", {
            run: (facts: any) => external(["echo", facts.count]),
          });
          system.derive.register("triple", (facts: any) => facts.count * 3);
          external([
            "dynamic",
            system.constraints.listDynamic(),
            system.resolvers.listDynamic(),
            system.effects.listDynamic(),
            system.derive.listDynamic(),
            system.constraints.isDynamic("labelIt"),
          ]);
        },
      },
      { op: "dispatch", event: { type: "inc" } },
      { op: "dispatch", event: { type: "inc" } },
      { op: "settle" },
      {
        op: "run",
        label: "assign and call",
        fn: async (system, { external }) => {
          system.constraints.assign("labelIt", {
            when: (facts: any) => facts.count > 3,
            require: { type: "LABEL" },
          });
          external([
            "call constraint",
            await system.constraints.call("labelIt"),
          ]);
          system.derive.assign("triple", (facts: any) => facts.count * 30);
          external(["triple", system.read("triple")]);
          external(["call derivation", system.derive.call("triple")]);
          await system.effects.call("echo");
          await system.resolvers.call("label", { type: "LABEL" });
        },
      },
      { op: "settle" },
      {
        op: "run",
        label: "unregister",
        fn: (system, { external }) => {
          system.effects.unregister("echo");
          system.constraints.unregister("labelIt");
          system.derive.unregister("triple");
          system.resolvers.unregister("label");
          external(["after", system.constraints.listDynamic()]);
          try {
            system.constraints.assign("nonexistent", {
              when: () => true,
              require: { type: "LABEL" },
            });
          } catch (error) {
            external(["assign unknown", error]);
          }
        },
      },
      { op: "dispatch", event: { type: "inc" } },
      { op: "settle" },
    ],
  );

  scenario(
    "constraints disable and enable at runtime",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { n: t.number(), fixed: t.number() },
          derivations: {},
          events: {},
          requirements: { FIX: {} },
        },
        init: (facts: any) => {
          facts.n = 0;
          facts.fixed = 0;
        },
        constraints: {
          fix: { when: (f: any) => f.n > f.fixed, require: { type: "FIX" } },
        },
        resolvers: {
          fix: {
            requirement: "FIX",
            resolve: async (_req: unknown, context: any) => {
              external(["fix", context.facts.n]);
              context.facts.fixed = context.facts.n;
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "disable fix",
        fn: (system, { external }) => {
          system.constraints.disable("fix");
          external(["disabled?", system.constraints.isDisabled("fix")]);
        },
      },
      { op: "set", key: "n", value: 2 },
      { op: "settle" },
      {
        op: "run",
        label: "enable fix",
        fn: (system) => system.constraints.enable("fix"),
      },
      { op: "settle" },
    ],
  );

  scenario(
    "a module registered and unregistered at runtime",
    (ctx) => ({ modules: { base: counterModule(ctx, "base") } }),
    [
      { op: "start" },
      {
        op: "run",
        label: "registerModule extra",
        fn: (system, ctx) => {
          system.registerModule("extra", counterModule(ctx, "extra"));
          system.events.extra.inc();
          ctx.external(["extra", system.facts.extra.count]);
          try {
            system.registerModule("extra", counterModule(ctx, "extra"));
          } catch (error) {
            ctx.external(["duplicate", error]);
          }
        },
      },
      { op: "settle" },
      {
        op: "run",
        label: "unregisterModule extra",
        fn: async (system, { external }) => {
          await system.unregisterModule("extra");
          external(["after", Object.keys(system.facts)]);
        },
      },
      { op: "settle" },
    ],
  );
});
