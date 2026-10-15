/** L0: timer facts (the pure timer helpers driven through a system) and clocks. */

import { scenario, suite } from "../scenario.js";

suite("L0 timers and clocks", () => {
  scenario(
    "timer facts start, pause, resume, tick and complete",
    ({ core }) => {
      const c = core as any;

      return {
        module: c.createModule("game", {
          schema: {
            facts: { round: c.t.object() },
            derivations: { left: c.t.number() },
            events: {
              start: { at: c.t.number() },
              pause: { at: c.t.number() },
              resume: { at: c.t.number() },
              tick: { at: c.t.number() },
              done: {},
              reset: {},
            },
          },
          init: (facts: any) => {
            facts.round = c.initialTimerState();
          },
          derive: {
            left: (facts: any) => c.remainingMs(facts.round, 500, 1000),
          },
          events: {
            start: (facts: any, e: any) => {
              facts.round = c.startTimer(facts.round, e.at);
            },
            pause: (facts: any, e: any) => {
              facts.round = c.pauseTimer(facts.round, e.at);
            },
            resume: (facts: any, e: any) => {
              facts.round = c.resumeTimer(facts.round, e.at);
            },
            tick: (facts: any, e: any) => {
              const signal = c.tickTimer(facts.round, e.at, { ms: 1000 });
              facts.round =
                signal.kind === "complete"
                  ? c.completeTimer(facts.round)
                  : signal.kind === "repeat"
                    ? c.registerRepeat(facts.round, e.at, {
                        ms: 1000,
                        mode: "repeat",
                      })
                    : facts.round;
            },
            done: (facts: any) => {
              facts.round = c.completeTimer(facts.round);
            },
            reset: (facts: any) => {
              facts.round = c.resetTimer();
            },
          },
        }),
      };
    },
    [
      { op: "start" },
      { op: "dispatch", event: { type: "start", at: 0 } },
      { op: "dispatch", event: { type: "tick", at: 200 } },
      { op: "dispatch", event: { type: "pause", at: 300 } },
      { op: "dispatch", event: { type: "resume", at: 600 } },
      { op: "dispatch", event: { type: "tick", at: 1500 } },
      { op: "settle" },
      {
        op: "run",
        label: "elapsed and ops",
        fn: (system, { core, external }) => {
          const c = core as any;
          external(["elapsed", c.elapsedMs(system.facts.round, 900)]);
          try {
            external([
              "ops",
              Object.keys(c.timerOps({ ms: 1000, mode: "repeat" })).sort(),
            ]);
          } catch (error) {
            external(["ops", "threw", error]);
          }
        },
      },
      { op: "dispatch", event: { type: "done" } },
      { op: "dispatch", event: { type: "reset" } },
      { op: "settle" },
    ],
  );

  scenario(
    "virtual and real clocks",
    ({ core: { createModule, t } }) => ({
      module: createModule("m", {
        schema: { facts: { n: t.number() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.n = 0;
        },
      } as any),
    }),
    [
      {
        op: "run",
        label: "clocks",
        fn: (_s, { core, external }) => {
          const c = core as any;
          const v = c.virtualClock(100);
          const before = v.now();
          v.advanceBy?.(50);
          external(["virtual", before, v.now()]);
          external(["real", typeof c.realClock().now()]);
          external([
            "default is virtual under vitest",
            c.defaultClock().now() === 0 || typeof c.defaultClock().now(),
          ]);
        },
      },
    ],
  );
});
