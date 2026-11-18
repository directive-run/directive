/**
 * L9 pins: what 1.35 does with the trace and meta in the places no other
 * scenario looks (the L9 RFC, "Untested behaviours" U2, U3, U4 and U8). Each
 * `look` step reports the trace's length, each run's status and what it
 * holds, so an approved difference shows as exact records; the
 * `onTraceComplete` reports are recorded by the harness, with their timing
 * projected (the RFC's harness rule 1). U2 shows row (bi), approved for L9b:
 * its signed entry is added with the row.
 */

import { traceRunContract } from "../compare.js";
import {
  type AnySystem,
  type BuildContext,
  type Step,
  scenario,
  suite,
} from "../scenario.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The trace's length, and each run's status and contents, without times (a duration anomaly included). */
const look = (label: string): Step => ({
  op: "run",
  label,
  fn: (system: AnySystem, { external }) =>
    external([
      label,
      (system.trace ?? null) === null
        ? null
        : system.trace.map((run: any) => ({
            status: run.status,
            facts: run.factChanges.map((c: any) => c.key),
            hit: run.constraintsHit.map((c: any) => c.id),
            added: run.requirementsAdded.map((r: any) => r.type ?? r.id),
            started: run.resolversStarted.map((r: any) => r.resolver),
            errored: run.resolversErrored.map((r: any) => r.error),
            // As the comparison projects a run (diff/compare.ts
            // traceRunContract): a duration anomaly depends on time.
            anomalies: (traceRunContract(run) as any).anomalies ?? null,
          })),
    ]),
});

/**
 * The RFC's probe module: `email` is tagged `pii`; `contact` reads it,
 * `cost` reads `contact` behind a `tagBoundary`, and `shown` reads it only
 * while `gate` is true. `upgrade` raises CHARGE, whose resolver waits 20 ms,
 * then sets `seats` to 0 or throws "card declined".
 */
function account({ core: { createModule, t } }: BuildContext, fail = false) {
  return createModule("account", {
    schema: {
      facts: {
        email: t.string().meta({ tags: ["pii"] }),
        plan: t.string(),
        seats: t.number(),
        gate: t.boolean(),
      },
      derivations: { contact: t.string(), cost: t.number(), shown: t.string() },
      events: { upgrade: {} },
      requirements: { CHARGE: {} },
    },
    init: (facts: any) => {
      facts.email = "a@b.c";
      facts.plan = "free";
      facts.seats = 1;
      facts.gate = false;
    },
    derive: {
      contact: (facts: any) => `mail ${facts.email}`,
      cost: {
        compute: (_facts: any, derived: any) => derived.contact.length,
        meta: { tagBoundary: true },
      },
      shown: (facts: any) => (facts.gate ? facts.email : "hidden"),
    },
    events: {
      upgrade: (facts: any) => {
        facts.plan = "pro";
      },
    },
    constraints: {
      charge: {
        when: (facts: any) => facts.plan === "pro" && facts.seats > 0,
        require: { type: "CHARGE" },
      },
    },
    resolvers: {
      charge: {
        requirement: "CHARGE",
        resolve: async (_req: unknown, context: any) => {
          await wait(20);
          if (fail) {
            throw new Error("card declined");
          }
          context.facts.seats = 0;
        },
      },
    },
  } as any);
}

/** `byTag("pii")` as kind, id and where the tag comes from. */
const byTag = (label: string): Step => ({
  op: "run",
  label,
  fn: (system: AnySystem, { external }) =>
    external([
      label,
      system.meta
        .byTag("pii")
        .map((row: any) => [row.kind, row.id, row.tagOrigin ?? null]),
    ]),
});

suite("L9 trace pins", () => {
  scenario(
    "a run dropped from the ring while its resolver runs never reports (U2)",
    (ctx) => ({ module: account(ctx), trace: { maxRuns: 1 } }),
    [
      { op: "start" },
      { op: "settle" },
      { op: "dispatch", event: { type: "upgrade" } },
      { op: "advance", ms: 1 },
      look("the upgrade's run, its resolver running"),
      { op: "set", key: "email", value: "x@y.z" },
      { op: "advance", ms: 1 },
      look("a later run pushed it out"),
      { op: "settle" },
      look("after the resolver ended"),
    ],
  );

  scenario(
    "with maxRuns 0 the trace stays empty, and only runs without a resolver report (U2)",
    (ctx) => ({ module: account(ctx), trace: { maxRuns: 0 } }),
    [
      { op: "start" },
      { op: "settle" },
      { op: "dispatch", event: { type: "upgrade" } },
      { op: "settle" },
      { op: "set", key: "email", value: "x@y.z" },
      { op: "settle" },
      look("the trace"),
    ],
  );

  scenario(
    "meta.subscribe is called for immediate only, not on a write or a new inheritance (U3)",
    (ctx) => ({ module: account(ctx) }),
    [
      { op: "start" },
      { op: "settle" },
      {
        op: "run",
        label: "subscribe",
        fn: (system, { external }) => {
          system.meta.subscribe(["pii"], () => external(["pii listener"]));
          system.meta.subscribe(() => external(["immediate listener"]), {
            immediate: true,
          });
        },
      },
      { op: "set", key: "email", value: "x@y.z" },
      { op: "settle" },
      byTag("byTag before the gate opens"),
      { op: "set", key: "gate", value: true },
      { op: "settle" },
      {
        op: "run",
        label: "read shown",
        fn: (system, { external }) => external(["shown", system.derive.shown]),
      },
      byTag("byTag after the gate opened"),
    ],
  );

  scenario(
    "byTag computes derivations nothing has read, and lists them as inherited (U4)",
    (ctx) => ({ module: account(ctx) }),
    [
      { op: "start" },
      byTag("byTag before any read"),
      {
        op: "run",
        label: "carriesTag, then read",
        fn: (system, { external }) => {
          external([
            "carries",
            system.meta.carriesTag("derivation", "contact", "pii"),
            system.meta.carriesTag("derivation", "cost", "pii"),
            system.meta.carriesTag("derivation", "shown", "pii"),
          ]);
          external(["contact", system.derive.contact]);
          external(["derivation meta", system.meta.derivation("contact")]);
        },
      },
      { op: "settle" },
      byTag("byTag after the reads"),
    ],
  );

  scenario(
    "a resolver error is stored as its string, and a pass that only re-hits the constraint is its own run (U8)",
    (ctx) => ({ module: account(ctx, true), trace: { maxRuns: 10 } }),
    [
      { op: "start" },
      { op: "settle" },
      { op: "dispatch", event: { type: "upgrade" } },
      { op: "settle" },
      look("after the resolver errored"),
      { op: "set", key: "email", value: "x@y.z" },
      { op: "settle" },
      look("after a later write"),
    ],
  );
});
