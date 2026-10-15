/** L5: sources — attach, publish, gates, drops and detach. */

import { scenario, suite } from "../scenario.js";

suite("L5 sources", () => {
  scenario(
    "sources: attach, publish, active gate and detach",
    ({ core: { createModule, t }, external, handles }) => ({
      module: createModule("m", {
        schema: {
          facts: { open: t.boolean(), ticks: t.number(), last: t.string() },
          derivations: {},
          events: { tick: { label: t.string() } },
        },
        init: (facts: any) => {
          facts.open = false;
          facts.ticks = 0;
          facts.last = "";
        },
        events: {
          tick: (facts: any, event: any) => {
            facts.ticks += 1;
            facts.last = event.label;
          },
        },
        sources: {
          always: {
            attach: (publish: any) => {
              handles.always = publish;
              external("attach always");

              return () => external("detach always");
            },
          },
          gated: {
            active: (facts: any) => facts.open === true,
            attach: (publish: any) => {
              handles.gated = publish;
              external("attach gated");

              return () => external("detach gated");
            },
          },
        },
      } as any),
    }),
    [
      { op: "start" },
      {
        op: "run",
        label: "publish always",
        fn: (_system, { handles }) => handles.always("tick", { label: "a" }),
      },
      { op: "settle" },
      { op: "set", key: "open", value: true },
      { op: "settle" },
      {
        op: "run",
        label: "publish gated + unknown",
        fn: (_system, { handles }) => {
          handles.gated("tick", { label: "g" });
          handles.gated("nope");
        },
      },
      { op: "settle" },
      { op: "set", key: "open", value: false },
      { op: "settle" },
      { op: "stop" },
    ],
  );

  scenario(
    "sources: a publish naming another module's event is dropped",
    ({ core: { createModule, t }, handles }) => {
      const other = createModule("other", {
        schema: {
          facts: { hit: t.boolean() },
          derivations: {},
          events: { poke: {} },
        },
        init: (facts: any) => {
          facts.hit = false;
        },
        events: {
          poke: (facts: any) => {
            facts.hit = true;
          },
        },
      } as any);
      const mine = createModule("mine", {
        schema: {
          facts: { hit: t.boolean() },
          derivations: {},
          events: { poke: {} },
        },
        init: (facts: any) => {
          facts.hit = false;
        },
        events: {
          poke: (facts: any) => {
            facts.hit = true;
          },
        },
        sources: {
          feed: {
            attach: (publish: any) => {
              handles.feed = publish;

              return () => undefined;
            },
          },
        },
      } as any);

      return { modules: { other, mine } };
    },
    [
      { op: "start" },
      {
        op: "run",
        label: "publish cross-module then own",
        fn: (_system, { handles }) => {
          handles.feed("other::poke");
          handles.feed("poke");
        },
      },
      { op: "settle" },
    ],
  );
});
