/**
 * L5-pre pins (packages/core-next/docs/rfc-l5-sources.md, "Untested L5
 * behaviours"): U1 a failed gated attach on a quiet system, U2 a failed re-key
 * with linger, U3 coalesced payloads around the closing write, U4 the three
 * evict deadline paths, U9 a return to the old key inside a retry's linger
 * window. Each records 1.35's behaviour; candidates (aa), (ab) and (ac) would
 * change U1 to U3 and U9 only with a signed divergences.json entry.
 */

import type { Build, Step } from "../scenario.js";
import { scenario, suite } from "../scenario.js";

/** U3: a gated, coalesced source whose `tick` handler counts. */
const coalescing: Build = ({
  core: { createModule, t },
  external,
  handles,
}) => ({
  module: createModule("m", {
    schema: {
      facts: { open: t.boolean(), last: t.number(), count: t.number() },
      derivations: {},
      events: { tick: { n: t.number() } },
    },
    init: (facts: any) => {
      facts.open = true;
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
        active: (facts: any) => facts.open,
        coalesce: "lastWriteWins",
        attach: (publish: any) => {
          handles.publish = publish;

          return () => external("detach");
        },
      },
    },
  } as any),
});

/** U3: two publishes and the closing write, in one tick, in either order. */
const coalesceSteps = (closeFirst: boolean): Step[] => [
  { op: "start" },
  { op: "settle" },
  {
    op: "run",
    label: closeFirst
      ? "close the gate, then publish twice"
      : "publish twice, then close the gate",
    fn: (system, { handles }) => {
      if (closeFirst) {
        system.facts.open = false;
      }
      handles.publish("tick", { n: 1 });
      handles.publish("tick", { n: 2 });
      if (!closeFirst) {
        system.facts.open = false;
      }
    },
  },
  { op: "settle" },
  { op: "advance", ms: 5 },
  { op: "checkpoint", label: "flushed" },
];

/** U4: one source whose onEvict takes 200 ms. */
const evicting: Build = ({ core: { createModule, t }, external }) => ({
  module: createModule("m", {
    schema: { facts: { up: t.boolean() }, derivations: {}, events: {} },
    init: (facts: any) => {
      facts.up = true;
    },
    sources: {
      slow: {
        attach: () => () => external("unsubscribed"),
        onEvict: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          external("onEvict done");
        },
      },
    },
  } as any),
});

/**
 * U4: evict with a deadline 500 ms past, 50 ms ahead, or none. The harness
 * fakes Date from 0, so the deadline is read from Date.now() after a second.
 */
const evictSteps = (deadline: "past" | "future" | "none"): Step[] => [
  { op: "start" },
  { op: "settle" },
  { op: "advance", ms: 1_000 },
  {
    op: "run",
    label: `evict, deadline ${deadline}`,
    fn: async (system, { external }) => {
      const now = Date.now();
      await system.evict(
        deadline === "past"
          ? now - 500
          : deadline === "future"
            ? now + 50
            : undefined,
      );
      external(["evict returned", Date.now() - now]);
    },
  },
  { op: "advance", ms: 300 },
  { op: "checkpoint", label: "after the work" },
];

suite("L5 source pins", () => {
  // U1 (probe P1, review probe R5): the backoff is checked only when a gate
  // is evaluated, so the second attempt waits for an unrelated write.
  scenario(
    "a failed gated attach on a quiet system waits for an unrelated write to retry",
    ({ core: { createModule, t }, external }) => {
      let attempts = 0;

      return {
        module: createModule("m", {
          schema: {
            facts: { open: t.boolean(), other: t.number() },
            derivations: {},
            events: {},
          },
          init: (facts: any) => {
            facts.open = true;
            facts.other = 0;
          },
          sources: {
            feed: {
              active: (facts: any) => facts.open,
              attach: () => {
                attempts += 1;
                external(["attempt", attempts]);
                if (attempts === 1) {
                  throw new Error("transport down");
                }

                return () => external("detach");
              },
            },
          },
        } as any),
      };
    },
    [
      { op: "start" },
      { op: "settle" },
      { op: "advance", ms: 400 },
      { op: "checkpoint", label: "quiet, past the backoff" },
      { op: "set", key: "other", value: 1 },
      { op: "settle" },
      { op: "checkpoint", label: "after an unrelated write" },
    ],
  );

  // U2 (probe P3): a re-key whose attach fails keeps the old key committed,
  // so the retry is another re-key and waits one more linger window.
  scenario(
    "a failed re-key with gateLingerMs retries only after another linger window",
    ({ core: { createModule, t }, external, handles }) => {
      let failB = true;
      handles.allowB = () => {
        failB = false;
      };

      return {
        module: createModule("m", {
          schema: {
            facts: { room: t.string(), other: t.number() },
            derivations: {},
            events: {},
          },
          init: (facts: any) => {
            facts.room = "a";
            facts.other = 0;
          },
          sources: {
            chat: {
              key: (facts: any) => facts.room,
              gateLingerMs: 50,
              attach: (_publish: any, _reportError: any, ctx: any) => {
                external(["attach", ctx.key]);
                if (ctx.key === "b" && failB) {
                  throw new Error("room b down");
                }

                return () => external(["detach", ctx.key]);
              },
            },
          },
        } as any),
      };
    },
    [
      { op: "start" },
      { op: "settle" },
      { op: "set", key: "room", value: "b" },
      { op: "settle" },
      { op: "advance", ms: 80 },
      { op: "checkpoint", label: "re-keyed, b failed" },
      { op: "advance", ms: 300 },
      {
        op: "run",
        label: "b comes back",
        fn: (_s, { handles }) => handles.allowB(),
      },
      { op: "set", key: "other", value: 1 },
      { op: "settle" },
      { op: "checkpoint", label: "after an unrelated write" },
      { op: "advance", ms: 80 },
      { op: "checkpoint", label: "one window later" },
    ],
  );

  // U3 (probe P2 and review probe R3): payloads queued after the closing
  // write are thrown away uncounted; payloads queued before it are flushed.
  scenario(
    "coalesced publishes queued after the closing write are dropped uncounted",
    coalescing,
    coalesceSteps(true),
  );
  scenario(
    "coalesced publishes queued before the closing write are dispatched",
    coalescing,
    coalesceSteps(false),
  );

  // U4 (probe P4): a deadline already past starts the work and returns at
  // once; a future one waits up to the deadline; none waits for all of it.
  // The harness fakes Date from 0, so the deadline is read from Date.now().
  scenario(
    "evict with a deadline already past returns at once",
    evicting,
    evictSteps("past"),
  );
  scenario(
    "evict with a future deadline waits only until the deadline",
    evicting,
    evictSteps("future"),
  );
  scenario(
    "evict with no deadline waits for every onEvict",
    evicting,
    evictSteps("none"),
  );

  // U9 (review probe R4): inside a retry's linger window, a return to the
  // old key cancels the timer but attaches nothing; the source stays dark
  // until another unrelated write.
  scenario(
    "a return to the old key inside a retry's linger window leaves the source dark",
    ({ core: { createModule, t }, external }) => ({
      module: createModule("m", {
        schema: {
          facts: { room: t.string(), other: t.number() },
          derivations: {},
          events: {},
        },
        init: (facts: any) => {
          facts.room = "a";
          facts.other = 0;
        },
        sources: {
          chat: {
            key: (facts: any) => facts.room,
            gateLingerMs: 50,
            attach: (_publish: any, _reportError: any, ctx: any) => {
              external(["attach", ctx.key]);
              if (ctx.key === "b") {
                throw new Error("room b down");
              }

              return () => external(["detach", ctx.key]);
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
      { op: "advance", ms: 80 },
      { op: "advance", ms: 300 },
      { op: "set", key: "other", value: 1 },
      { op: "settle" },
      { op: "checkpoint", label: "retry linger armed" },
      { op: "set", key: "room", value: "a" },
      { op: "settle" },
      { op: "checkpoint", label: "back to a" },
      { op: "advance", ms: 400 },
      { op: "checkpoint", label: "400 ms of quiet" },
      { op: "set", key: "other", value: 2 },
      { op: "settle" },
      { op: "checkpoint", label: "after another unrelated write" },
    ],
  );
});
