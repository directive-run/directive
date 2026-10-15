/**
 * L12: the built-in plugins on a running system — logging, performance,
 * audit ledger, clobber alert and loop, circuit breaker, snapshot signing.
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A payment whose resolver's tail write gets clobbered when `cancel` fires. */
function payments({ core: { createModule, t } }: BuildContext) {
  let release: () => void = () => {};

  return createModule("payments", {
    schema: {
      facts: {
        amount: t.number().meta({ tags: ["money", "irreversible"] }),
        status: t.string(),
      },
      derivations: { charged: t.boolean() },
      events: { start: {}, cancel: {} },
      requirements: { CHARGE: {} },
    },
    init: (facts: any) => {
      facts.amount = 100;
      facts.status = "idle";
    },
    derive: { charged: (facts: any) => facts.status === "done" },
    events: {
      start: (facts: any) => {
        facts.status = "charging";
      },
      cancel: (facts: any) => {
        facts.amount = 0;
      },
    },
    constraints: {
      charge: {
        when: (facts: any) => facts.status === "charging",
        require: { type: "CHARGE" },
        abortOn: ["amount"],
      },
    },
    resolvers: {
      charge: {
        requirement: "CHARGE",
        resolve: async (_req: unknown, context: any) => {
          await new Promise<void>((resolve) => {
            release = resolve;
            setTimeout(resolve, 20);
          });
          void release;
          context.facts.amount = 99;
          context.facts.status = "done";
        },
      },
    },
  } as any);
}

const chargeAndClobber = [
  { op: "start" as const },
  { op: "dispatch" as const, event: { type: "start" } },
  { op: "advance" as const, ms: 5 },
  { op: "dispatch" as const, event: { type: "cancel" } },
  { op: "advance" as const, ms: 30 },
  { op: "settle" as const },
];

suite("L12 plugins", () => {
  scenario(
    "logging and performance plugins on a clobbered charge",
    (ctx) => ({
      module: payments(ctx),
      plugins: [
        ctx.plugins.loggingPlugin({
          level: "debug",
          logger: {
            debug: (...a: unknown[]) => ctx.external(["log debug", a[0]]),
            info: (...a: unknown[]) => ctx.external(["log info", a[0]]),
            warn: (...a: unknown[]) => ctx.external(["log warn", a[0]]),
            error: (...a: unknown[]) => ctx.external(["log error", a[0]]),
            group: () => {},
            groupEnd: () => {},
          },
        }),
        ctx.plugins.performancePlugin({
          onSlowResolver: (id: string, ms: number) =>
            ctx.external(["slow resolver", id, ms]),
          slowResolverThresholdMs: 10,
        }),
      ],
    }),
    [...chargeAndClobber],
  );

  scenario(
    "clobber alert and clobber loop plugins",
    (ctx) => ({
      module: payments(ctx),
      plugins: [
        ctx.plugins.clobberAlertPlugin({
          onAlert: (event: unknown) => ctx.external(["alert", event]),
        }),
        // clobberLoopPlugin returns a handle; its plugin is `.plugin`.
        ctx.plugins.clobberLoopPlugin({
          threshold: 2,
          windowMs: 1000,
          onLoop: (event: unknown) => ctx.external(["loop", event]),
          onResolved: (event: unknown) =>
            ctx.external(["loop resolved", event]),
        }).plugin,
      ],
    }),
    [
      ...chargeAndClobber,
      { op: "dispatch", event: { type: "start" } },
      { op: "advance", ms: 5 },
      { op: "dispatch", event: { type: "cancel" } },
      { op: "advance", ms: 30 },
      { op: "dispatch", event: { type: "start" } },
      { op: "advance", ms: 5 },
      { op: "dispatch", event: { type: "cancel" } },
      { op: "settle" },
      { op: "advance", ms: 5000 },
      { op: "settle" },
    ],
  );

  scenario(
    "the audit ledger chains entries and verifies",
    (ctx) => {
      const ledger = ctx.plugins.createAuditLedger();
      ctx.handles.ledger = ledger;

      return { module: payments(ctx), plugins: [ledger.plugin] };
    },
    [
      ...chargeAndClobber,
      {
        op: "run",
        label: "verify the ledger",
        fn: (_s, { handles, external }) => {
          const ledger = handles.ledger;
          external(["verify", ledger.verify()]);
          external([
            "entries",
            ledger.entries?.() ?? ledger.getEntries?.() ?? null,
          ]);
          ledger.destroy();
        },
      },
    ],
  );

  scenario(
    "circuit breaker opens, rejects and half-opens",
    (ctx) => ({ module: payments(ctx) }),
    [
      { op: "start" },
      {
        op: "run",
        label: "breaker",
        fn: async (_s, { plugins, external }) => {
          const breaker = plugins.createCircuitBreaker({
            failureThreshold: 2,
            recoveryTimeMs: 100,
            name: "api",
          });
          for (let i = 0; i < 3; i++) {
            try {
              await breaker.execute(async () => {
                throw new Error(`down ${i}`);
              });
            } catch (error) {
              external(["call", i, breaker.getState(), error]);
            }
          }
          await wait(150);
          external(["after recovery", breaker.getState()]);
          external([
            "ok",
            await breaker.execute(async () => "fine"),
            breaker.getState(),
          ]);
          external(["stats", breaker.getStats?.() ?? null]);
        },
      },
    ],
  );

  scenario(
    "snapshot signing and verification",
    (ctx) => ({ module: payments(ctx) }),
    [
      { op: "start" },
      {
        op: "run",
        label: "sign and verify",
        fn: async (system, { core, external }) => {
          const snapshot = system.getDistributableSnapshot({ ttlSeconds: 60 });
          const signed = await core.signSnapshot(snapshot, "secret");
          external(["signed", core.isSignedSnapshot(signed), signed.algorithm]);
          external([
            "verify",
            await core.verifySnapshotSignature(signed, "secret"),
          ]);
          external([
            "wrong secret",
            await core.verifySnapshotSignature(signed, "other"),
          ]);
          const tampered = {
            ...(signed as any),
            data: { ...(signed as any).data, amount: 1 },
          };
          external([
            "tampered",
            await core.verifySnapshotSignature(tampered, "secret"),
          ]);
          external(["expired?", core.isSnapshotExpired(snapshot)]);
          external([
            "diff",
            core.diffSnapshots(snapshot, { ...snapshot, data: { amount: 5 } }),
          ]);
        },
      },
    ],
  );
});
