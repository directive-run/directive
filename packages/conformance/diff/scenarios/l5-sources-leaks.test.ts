/**
 * L5c: the two source leaks the owner approved fixing (rows (ad) and (ae),
 * 2026-11-01). Each records 1.35's leak; core-next differs only by the fix,
 * which the L5 gate signs in divergences.json.
 *
 * - (ad) a stop() inside a source's attach, during start's attach loop:
 *   1.35 leaves that source and every one after it attached, and the next
 *   start attaches them again.
 * - (ae) a gateLingerMs timer that fires while stopAsync() awaits an
 *   unsubscribe: 1.35 attaches a subscription nothing unsubscribes.
 */

import { scenario, suite } from "../scenario.js";

suite("L5 source leaks", () => {
  // (ad): s1's first attach stops the system; s0 is attached before it, s2
  // and the gated g after it.
  scenario(
    "a stop inside a source's attach at start ends the attach loop",
    ({ core: { createModule, t }, external, handles }) => {
      let first = true;
      const source = (id: string, then?: () => void) => ({
        attach: () => {
          external(["subscribe", id]);
          then?.();

          return () => external(["unsubscribe", id]);
        },
      });

      return {
        module: createModule("m", {
          schema: { facts: { open: t.boolean() }, derivations: {}, events: {} },
          init: (facts: any) => {
            facts.open = true;
          },
          sources: {
            s0: source("s0"),
            s1: source("s1", () => {
              if (first) {
                first = false;
                handles.system.stop();
              }
            }),
            s2: source("s2"),
            g: { active: (facts: any) => facts.open, ...source("g") },
          },
        } as any),
      };
    },
    [
      {
        op: "run",
        label: "hold the system",
        fn: (system, { handles }) => {
          handles.system = system;
        },
      },
      { op: "start" },
      { op: "settle" },
      { op: "checkpoint", label: "stopped inside an attach" },
      { op: "start" },
      { op: "settle" },
      { op: "checkpoint", label: "started again" },
      { op: "stop" },
      { op: "checkpoint", label: "stopped" },
    ],
  );

  // (ae): the re-key to b lingers 100 ms; stopAsync detaches chat, then
  // awaits slow's 200 ms unsubscribe, so the linger's deadline falls inside
  // the stop.
  scenario(
    "a linger pending at stopAsync attaches nothing during the stop",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: { facts: { room: t.string() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.room = "a";
        },
        sources: {
          slow: {
            attach: () => () =>
              new Promise<void>((resolve) =>
                setTimeout(() => {
                  external("slow unsubscribed");
                  resolve();
                }, 200),
              ),
          },
          chat: {
            key: (facts: any) => facts.room,
            gateLingerMs: 100,
            attach: (_publish: any, _reportError: any, ctx: any) => {
              external(["subscribe", ctx.key]);

              return () => external(["unsubscribe", ctx.key]);
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "settle" },
      { op: "set", key: "room", value: "b" },
      { op: "settle" },
      { op: "checkpoint", label: "lingering" },
      {
        op: "run",
        label: "stopAsync",
        fn: async (system, { external }) => {
          await system.stopAsync();
          external("stopped");
        },
      },
      { op: "checkpoint", label: "stopped" },
      { op: "advance", ms: 300 },
      { op: "start" },
      { op: "settle" },
      { op: "checkpoint", label: "started again" },
      { op: "stop" },
      { op: "checkpoint", label: "stopped again" },
    ],
  );
});
