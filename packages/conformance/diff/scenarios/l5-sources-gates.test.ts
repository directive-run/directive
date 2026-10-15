/** L5: keyed sources, gate linger, coalescing, onEvict and attach errors. */

import { scenario, suite } from "../scenario.js";

suite("L5 source gates and lifecycle", () => {
  scenario(
    "a key gate re-keys the source and detaches on null",
    ({ core: { createModule, t }, external, handles }) => ({
      module: createModule("m", {
        schema: {
          facts: { room: t.string().nullable(), seen: t.number() },
          derivations: {},
          events: { msg: { text: t.string() } },
        },
        init: (facts: any) => {
          facts.room = null;
          facts.seen = 0;
        },
        events: {
          msg: (facts: any) => {
            facts.seen += 1;
          },
        },
        sources: {
          chat: {
            key: (facts: any) => facts.room,
            attach: (publish: any, _reportError: any, ctx: any) => {
              handles.publish = publish;
              external(["attach", ctx?.key ?? null]);

              return () => external(["detach", ctx?.key ?? null]);
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "room", value: "a" },
      { op: "settle" },
      {
        op: "run",
        label: "publish in a",
        fn: (_s, { handles }) => handles.publish?.("msg", { text: "hi" }),
      },
      { op: "set", key: "room", value: "b" },
      { op: "settle" },
      { op: "set", key: "room", value: null },
      { op: "settle" },
      { op: "checkpoint", label: "closed" },
    ],
  );

  scenario(
    "gateLingerMs keeps a closed gate attached for a while",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: { facts: { open: t.boolean() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.open = true;
        },
        sources: {
          feed: {
            active: (facts: any) => facts.open,
            gateLingerMs: 100,
            attach: () => {
              external("attach");

              return () => external("detach");
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "settle" },
      { op: "set", key: "open", value: false },
      { op: "settle" },
      { op: "advance", ms: 50 },
      { op: "set", key: "open", value: true },
      { op: "settle" },
      { op: "set", key: "open", value: false },
      { op: "settle" },
      { op: "advance", ms: 150 },
      { op: "checkpoint", label: "lingered out" },
    ],
  );

  scenario(
    "coalesce lastWriteWins drops superseded publishes in a microtask",
    ({ core: { createModule, t }, handles }) => ({
      module: createModule("m", {
        schema: {
          facts: { last: t.number(), count: t.number() },
          derivations: {},
          events: { tick: { n: t.number() } },
        },
        init: (facts: any) => {
          facts.last = 0;
          facts.count = 0;
        },
        events: {
          tick: (facts: any, event: any) => {
            facts.last = event.n;
            facts.count += 1;
          },
        },
        sources: {
          latest: {
            coalesce: "lastWriteWins",
            attach: (publish: any) => {
              handles.latest = publish;

              return () => undefined;
            },
          },
          every: {
            coalesce: "all",
            attach: (publish: any) => {
              handles.every = publish;

              return () => undefined;
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "three quick publishes on each",
        fn: (_s, { handles }) => {
          for (const n of [1, 2, 3]) {
            handles.latest("tick", { n });
          }
          for (const n of [10, 20]) {
            handles.every("tick", { n });
          }
        },
      },
      { op: "settle" },
    ],
  );

  scenario(
    "onEvict runs on evict; a throwing attach reports a source error",
    ({ core: { createModule, t }, external, handles }) => ({
      module: createModule("m", {
        schema: { facts: { up: t.boolean() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.up = false;
        },
        sources: {
          kept: {
            attach: (_publish: any, reportError: any) => {
              handles.reportError = reportError;

              return () => external("kept detach");
            },
            onEvict: async () => {
              await new Promise((resolve) => setTimeout(resolve, 5));
              external("kept evicted");
            },
          },
          broken: {
            active: (facts: any) => facts.up,
            attach: () => {
              throw new Error("transport unavailable");
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      { op: "set", key: "up", value: true },
      { op: "settle" },
      {
        op: "run",
        label: "report a runtime error",
        fn: (_s, { handles }) =>
          handles.reportError?.(new Error("socket dropped")),
      },
      { op: "settle" },
      {
        op: "run",
        label: "evict",
        fn: (system) => system.evict(100),
      },
      { op: "checkpoint", label: "evicted" },
    ],
  );
});
