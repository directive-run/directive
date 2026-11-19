/**
 * L12-pre's diff pins from the L12 RFC's untested list: U1 (a watch does not
 * see a change to an included fact; the next derivation change carries it;
 * shows (bx)), U2 (a watch calls back synchronously in the write, once per
 * batch, never for an equal write, never after unsubscribing) and U16 (every
 * watch snapshot carries `version`, asked for or not).
 */

import { type BuildContext, scenario, suite } from "../scenario.js";

function acct({ core: { createModule, t } }: BuildContext) {
  return createModule("acct", {
    schema: {
      facts: { name: t.string(), count: t.number(), plan: t.string() },
      derivations: { display: t.string() },
      events: {},
      requirements: {},
    },
    init: (facts: any) => {
      facts.name = "Ada";
      facts.count = 1;
      facts.plan = "free";
    },
    derive: { display: (facts: any) => `${facts.name} (${facts.count})` },
  } as any);
}

/** What a callback snapshot shows: its data, and whether it has a version. */
const seen = (snapshot: any) => [
  snapshot.data,
  typeof snapshot.version === "string",
];

suite("L12 pins", () => {
  scenario(
    "a watch misses an included fact's change until a derivation changes (U1)",
    (ctx) => ({ module: acct(ctx) }),
    [
      { op: "start" },
      { op: "settle" },
      {
        op: "run",
        label: "watch display with plan included",
        fn: (system, { handles, external }) => {
          handles.stop = system.watchDistributableSnapshot(
            { includeDerivations: ["display"], includeFacts: ["plan"] },
            (snapshot: any) => external(["watch", ...seen(snapshot)]),
          );
        },
      },
      { op: "set", key: "plan", value: "pro" },
      { op: "settle" },
      {
        op: "run",
        label: "the snapshot now",
        fn: (system, { external }) => {
          external([
            "now",
            system.getDistributableSnapshot({
              includeDerivations: ["display"],
              includeFacts: ["plan"],
            }).data,
          ]);
        },
      },
      { op: "set", key: "count", value: 5 },
      { op: "settle" },
      {
        op: "run",
        label: "unsubscribe",
        fn: (_s, { handles }) => {
          handles.stop();
        },
      },
    ],
  );

  scenario(
    "a watch calls back in the write, once per batch, with a version (U2, U16)",
    (ctx) => ({ module: acct(ctx) }),
    [
      { op: "start" },
      { op: "settle" },
      {
        op: "run",
        label: "watch, then write",
        fn: (system, { handles, external }) => {
          const calls: unknown[] = [];
          handles.calls = calls;
          // No includeVersion: every callback snapshot has one anyway (U16).
          handles.stop = system.watchDistributableSnapshot(
            { includeDerivations: ["display"] },
            (snapshot: any) => {
              calls.push(seen(snapshot));
              external(["watch", ...seen(snapshot)]);
            },
          );
          system.facts.count = 5;
          external(["calls in the write", calls.length]);
        },
      },
      { op: "settle" },
      {
        op: "run",
        label: "an equal write, then a batch",
        fn: (system, { handles, external }) => {
          system.facts.count = 5;
          external(["after the equal write", handles.calls.length]);
          system.batch(() => {
            system.facts.count = 6;
            system.facts.count = 7;
          });
          external(["after the batch", handles.calls.length]);
        },
      },
      { op: "settle" },
      {
        op: "run",
        label: "unsubscribe, then write",
        fn: (system, { handles, external }) => {
          handles.stop();
          system.facts.count = 8;
          external(["after unsubscribing", handles.calls.length]);
        },
      },
      { op: "settle" },
    ],
  );
});
