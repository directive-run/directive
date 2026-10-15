/** L9: trace entries, meta and tags, observe() late subscription. */

import { type BuildContext, scenario, suite } from "../scenario.js";

function tagged({ core: { createModule, t } }: BuildContext) {
  return createModule("account", {
    meta: { label: "Account" },
    schema: {
      facts: {
        email: t.string().meta({ label: "Email", tags: ["pii"] }),
        plan: t.string().meta({ tags: ["billing"] }),
        seats: t.number(),
      },
      derivations: { contact: t.string(), cost: t.number() },
      events: { upgrade: {} },
      requirements: { CHARGE: {} },
    },
    init: (facts: any) => {
      facts.email = "a@b.c";
      facts.plan = "free";
      facts.seats = 1;
    },
    derive: {
      contact: (facts: any) => `mail ${facts.email}`,
      cost: {
        compute: (facts: any) => (facts.plan === "pro" ? facts.seats * 10 : 0),
        meta: { label: "Cost", tagBoundary: true },
      },
    },
    events: {
      upgrade: {
        handler: (facts: any) => {
          facts.plan = "pro";
        },
        meta: { label: "Upgrade" },
      },
    },
    constraints: {
      charge: {
        when: (facts: any) => facts.plan === "pro" && facts.seats > 0,
        require: { type: "CHARGE" },
        meta: { label: "Charge", tags: ["billing"] },
      },
    },
    resolvers: {
      charge: {
        requirement: "CHARGE",
        meta: { description: "Bills the account" },
        resolve: async (_req: unknown, context: any) => {
          await new Promise((resolve) => setTimeout(resolve, 3));
          context.facts.seats = 0;
        },
      },
    },
  } as any);
}

suite("L9 trace and introspection", () => {
  scenario(
    "trace: per-run changelogs with causes",
    (ctx) => ({ module: tagged(ctx), trace: { maxRuns: 5 } }),
    [
      { op: "start" },
      { op: "dispatch", event: { type: "upgrade" } },
      { op: "settle" },
      { op: "set", key: "seats", value: 4 },
      { op: "settle" },
      {
        op: "run",
        label: "read the trace",
        fn: (system, { external }) =>
          external(["trace", system.inspect().trace]),
      },
    ],
  );

  scenario(
    "meta, tags and tag inheritance queries",
    (ctx) => ({ module: tagged(ctx) }),
    [
      { op: "start" },
      {
        op: "run",
        label: "meta queries",
        fn: (system, { external }) => {
          external(["module", system.meta.module("account")]);
          external(["fact", system.meta.fact("email")]);
          external(["derivation", system.meta.derivation("cost")]);
          external(["constraint", system.meta.constraint("charge")]);
          external(["resolver", system.meta.resolver("charge")]);
          external(["event", system.meta.event("upgrade")]);
          external(["by tag pii", system.meta.byTag("pii")]);
          external([
            "by tag billing (constraints)",
            system.meta.byTag("billing", { kind: "constraint" }),
          ]);
          external([
            "carries pii",
            system.meta.carriesTag("derivation", "contact", "pii"),
            system.meta.carriesTag("derivation", "cost", "pii"),
          ]);
        },
      },
      {
        op: "run",
        label: "meta subscribe",
        fn: (system, { external }) => {
          system.meta.subscribe(["pii"], (change: unknown) =>
            external(["pii change", change]),
          );
        },
      },
      { op: "set", key: "email", value: "x@y.z" },
      { op: "dispatch", event: { type: "upgrade" } },
      { op: "settle" },
    ],
  );

  scenario(
    "observe subscribed late sees only what follows; unsubscribe is idempotent",
    (ctx) => ({ module: tagged(ctx) }),
    [
      { op: "start" },
      { op: "dispatch", event: { type: "upgrade" } },
      {
        op: "run",
        label: "late observer",
        fn: (system, { external, handles }) => {
          handles.off = system.observe((event: any) =>
            external(["late observer", event.type]),
          );
        },
      },
      { op: "settle" },
      {
        op: "run",
        label: "unsubscribe twice",
        fn: (_s, { handles }) => {
          handles.off();
          handles.off();
        },
      },
      { op: "set", key: "seats", value: 2 },
      { op: "settle" },
    ],
  );
});
