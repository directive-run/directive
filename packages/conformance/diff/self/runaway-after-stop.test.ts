/**
 * An engine under test that runs away after an `ends` divergence on that
 * same engine has already stopped its comparison is discarded, not failed
 * (Jason, 2026-11-02, answering in chat: "Discard after the stop", the
 * option that reads: once an approved stop rule, an `ends` divergence, has
 * ended the comparison, a 2.0 runaway past it is discarded like a 1.35
 * runaway, inside the existing 1% runaway limit, and reported in the census
 * line; a 2.0 runaway with no stop rule before it still fails). Each test
 * proves one edge of how wide that is: the runaway after a stop is
 * discarded and counted; one with no stop, an ordinary entry or a hand
 * scenario is still a hang; one before the stop (in a later step, or in the
 * same step before the stop's record, or in the same segment as a missing
 * stop) is still a hang; one on an engine the stop is not on is still a
 * hang; and discarded cases count toward the one runaway limit, which still
 * fails the run. The runaway starts where the engine's timer callbacks pass
 * the reference's own total, not where the budget ran out (diff/scenario.ts
 * `stopsBefore`), so (e) a loop whose own records match the `ends` entry,
 * and a loop that started before the stop, are still hangs; the stop must
 * be strictly before that point; and a discarded case still fails on a
 * difference before its stop.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type FuzzRun,
  checkFuzzRuns,
  describeFuzzRun,
} from "../../lib/census.js";
import { FUZZ_FLOOR, maxRunaways } from "../../lib/fuzz.js";
import { type EngineHandle, engines } from "../engines.js";
import {
  type BuildContext,
  type Divergence,
  FUZZ_SCENARIO,
  type FuzzTally,
  type ScenarioDef,
  newFuzzTally,
  runScenario,
  tallyCase,
} from "../scenario.js";

type Step = ScenarioDef["steps"][number];

/** What a marked candidate does differently from the reference. */
interface Marks {
  /** Reports q as 1 (the reference reports 0): a `changed` difference. */
  diff?: boolean;
  /** Does not report q: a `missing` difference. */
  omit?: boolean;
  /** Starts an endless timer chain in the spin steps. */
  spin?: boolean;
  /** Reports z as 1 (the reference 0): a difference no entry explains. */
  z?: boolean;
  /** The endless chain reports q (an extra record) in every callback. */
  loopQ?: boolean;
  /** In the TICKS step: reports q (extra) in this tick, then spins. */
  qAt?: number;
}

const MARK = "__runawayAfterStopSelfTest";

/** The workspace engine as `name`, carrying `marks` for the steps to read. */
function marked(name: string, marks: Marks): EngineHandle {
  const local = engines()[1] as EngineHandle;

  return {
    ...local,
    name,
    async load() {
      return { ...(await local.load()), [MARK]: marks };
    },
  };
}

const marksOf = (ctx: BuildContext): Marks =>
  ((ctx.core as Record<string, unknown>)[MARK] as Marks | undefined) ?? {};

/** Two timers per firing, like resolvers re-triggering each other. */
function spawn(): void {
  setTimeout(spawn, 1);
  setTimeout(spawn, 1);
}

function reportQ(ctx: BuildContext): void {
  const marks = marksOf(ctx);
  ctx.external(["a", 0]);
  if (!marks.omit) {
    ctx.external(["q", marks.diff ? 1 : 0]);
  }
  ctx.external(["b", 0]);
}

/** Runs away inside the step it is called in, when the engine spins. */
function spinNow(ctx: BuildContext): void {
  if (marksOf(ctx).spin) {
    spawn();
    vi.advanceTimersByTime(100);
  }
}

const REPORT: Step = {
  op: "run",
  label: "report",
  fn: (_system, ctx) => reportQ(ctx),
};
/** Starts the chain; the advance step after it runs away. */
const SPIN: Step = {
  op: "run",
  label: "spin",
  fn: (_system, ctx) => {
    if (marksOf(ctx).spin) {
      spawn();
    }
  },
};
const ADVANCE: Step = { op: "advance", ms: 100 };

function fuzzCase(steps: Step[], name = FUZZ_SCENARIO): ScenarioDef {
  return {
    name,
    build: ({ core: { createModule, t } }: BuildContext) => ({
      module: createModule("m", {
        schema: { facts: { n: t.number() }, derivations: {}, events: {} },
        init: (facts: any) => {
          facts.n = 0;
        },
      } as any),
    }),
    steps: [{ op: "start" }, ...steps],
    seed: 1,
    // Small, so each runaway is short.
    budget: 2000,
  };
}

/** The stop in step 1, the runaway in step 3. */
const AFTER = fuzzCase([REPORT, SPIN, ADVANCE]);

const entry = (
  id: string,
  more: Partial<Divergence> = {},
  scenario = FUZZ_SCENARIO,
): Divergence => ({
  id,
  scenario,
  stream: "external",
  kind: "q",
  reason: "an approved quirk, for this self-test",
  approvedBy: "Jason",
  date: "2026-11-02",
  ...more,
});

/** A narrow `ends` entry, as the census requires (engine v2, an op). */
const ends = (op: Divergence["op"] = "changed", scenario = FUZZ_SCENARIO) =>
  entry("q-ends", { ends: true, engine: "v2", op }, scenario);

const HANG =
  /hang in scenario "[^"]+": (v2|local) made more than 2000 timer callbacks/;

function expectHang(
  result: Awaited<ReturnType<typeof runScenario>>,
  engine: string,
) {
  expect(result.ok).toBe(false);
  expect(result.hung).toEqual([engine]);
  expect(result.discarded).toEqual([]);
  expect(result.report).toMatch(HANG);
  const tally: FuzzTally = newFuzzTally();
  tallyCase(tally, result);
  expect(tally).toMatchObject({ runaway: 0, afterStop: 0 });
}

describe("a runaway after an `ends` stop is discarded, and counted", () => {
  it("(a) v2 runs away after the stop: discarded, not a hang, and counted as a runaway after a stop", async () => {
    const result = await runScenario(AFTER, {
      candidates: [marked("v2", { diff: true, spin: true })],
      divergences: [ends()],
    });

    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    expect(result.runaway).toBe(false);
    expect(result.hung).toEqual([]);
    expect(result.discarded).toEqual(["v2"]);
    expect(result.ended).toMatchObject([{ engine: "v2", id: "q-ends" }]);
    expect(result.advisories.join("\n")).toMatch(
      /runaway on v2 after the stop by q-ends: more than 2000 timer callbacks/,
    );

    // Discarded like a reference runaway: counted, not compared.
    const tally: FuzzTally = newFuzzTally();
    tallyCase(tally, result);
    expect(tally).toMatchObject({ ran: 1, runaway: 1, afterStop: 1, onV2: 0 });
    expect(tally.ended).toBe(0);
  });

  it("(a) a missing stop in an earlier step than the runaway: discarded", async () => {
    const result = await runScenario(AFTER, {
      candidates: [marked("v2", { omit: true, spin: true })],
      divergences: [ends("missing")],
    });

    expect(result.report).toBe("");
    expect([result.ok, result.discarded, result.hung]).toEqual([
      true,
      ["v2"],
      [],
    ]);
  });

  it("(a) a stop earlier in the same step as the runaway: discarded", async () => {
    const result = await runScenario(
      fuzzCase([
        {
          op: "run",
          label: "report, then spin",
          fn: (_s, ctx) => {
            reportQ(ctx);
            spinNow(ctx);
          },
        },
      ]),
      {
        candidates: [marked("v2", { diff: true, spin: true })],
        divergences: [ends()],
      },
    );

    expect([result.ok, result.discarded, result.hung]).toEqual([
      true,
      ["v2"],
      [],
    ]);
  });

  it("(b) a runaway with no stop is still a hang: no entry, an ordinary entry, a hand scenario", async () => {
    const candidates = () => [marked("v2", { diff: true, spin: true })];

    expectHang(
      await runScenario(AFTER, { candidates: candidates(), divergences: [] }),
      "v2",
    );
    expectHang(
      await runScenario(AFTER, {
        candidates: candidates(),
        divergences: [entry("q", { engine: "v2", op: "changed" })],
      }),
      "v2",
    );
    // A hand scenario never stops, so its `ends` entry is just an entry.
    expectHang(
      await runScenario(fuzzCase([REPORT, SPIN, ADVANCE], "a hand scenario"), {
        candidates: candidates(),
        divergences: [ends("changed", "a hand scenario")],
      }),
      "v2",
    );
  });

  it("(c) a runaway before the stop is still a hang: an earlier step, earlier in the same step, the same segment as a missing stop", async () => {
    // The runaway in step 2, the stop in step 3.
    expectHang(
      await runScenario(fuzzCase([SPIN, ADVANCE, REPORT]), {
        candidates: [marked("v2", { diff: true, spin: true })],
        divergences: [ends()],
      }),
      "v2",
    );
    const spinThenReport: Step = {
      op: "run",
      label: "spin, then report",
      fn: (_s, ctx) => {
        spinNow(ctx);
        reportQ(ctx);
      },
    };
    // The stop's record comes after the runaway, in the same step.
    expectHang(
      await runScenario(fuzzCase([spinThenReport]), {
        candidates: [marked("v2", { diff: true, spin: true })],
        divergences: [ends()],
      }),
      "v2",
    );
    // A missing stop in the segment the runaway happened in: v2 may simply
    // not have reached it.
    expectHang(
      await runScenario(fuzzCase([spinThenReport]), {
        candidates: [marked("v2", { omit: true, spin: true })],
        divergences: [ends("missing")],
      }),
      "v2",
    );
  });

  it("(c) a runaway on another engine than the stop's is still a hang", async () => {
    // v2 stops; local runs away.
    const result = await runScenario(AFTER, {
      candidates: [
        marked("local", { spin: true }),
        marked("v2", { diff: true }),
      ],
      divergences: [ends()],
    });
    expect(result.ended).toMatchObject([{ engine: "v2", id: "q-ends" }]);
    expectHang(result, "local");

    // An `ends` entry for v2 does not stop local, whose difference it is.
    const local = await runScenario(AFTER, {
      candidates: [marked("local", { diff: true, spin: true })],
      divergences: [ends()],
    });
    expect(local.ended).toEqual([]);
    expectHang(local, "local");
  });

  it("(d) discarded cases count toward the one runaway limit, which still fails the run, and the census line shows them", async () => {
    const discarded = await runScenario(AFTER, {
      candidates: [marked("v2", { diff: true, spin: true })],
      divergences: [ends()],
    });
    const compared = await runScenario(AFTER, {
      candidates: [marked("v2", {})],
      divergences: [ends()],
    });
    expect([discarded.discarded, compared.ok, compared.discarded]).toEqual([
      ["v2"],
      true,
      [],
    ]);

    const runOf = (extra: number): { tally: FuzzTally; run: FuzzRun } => {
      const tally: FuzzTally = newFuzzTally();
      for (let i = 0; i < FUZZ_FLOOR; i++) {
        tallyCase(tally, compared);
      }
      for (let i = 0; i < extra; i++) {
        tallyCase(tally, discarded);
      }

      return {
        tally,
        run: {
          seed: 1,
          runs: tally.ran - tally.runaway,
          runaway: tally.runaway,
          runawayAfterStop: tally.afterStop,
          v2: tally.onV2,
        },
      };
    };

    const within = runOf(2);
    expect(within.tally).toMatchObject({ runaway: 2, afterStop: 2 });
    expect(within.tally.ran - within.tally.runaway).toBe(FUZZ_FLOOR);
    expect(within.tally.runaway).toBeLessThanOrEqual(
      maxRunaways(within.tally.ran),
    );
    expect(checkFuzzRuns([within.run], true)).toEqual([]);
    expect(describeFuzzRun(within.run)).toBe(
      `${FUZZ_FLOOR} cases compared (seed 1), ${FUZZ_FLOOR} of them on v2 too, 0 ended early by an \`ends\` divergence; 2 discarded after a stop (an engine under test ran away once an \`ends\` divergence had ended the comparison; counted toward the runaway limit)`,
    );

    // One more than max(1% of cases, 2): the fuzz test's limit and the census fail it.
    const over = runOf(3);
    expect(over.tally.runaway).toBeGreaterThan(maxRunaways(over.tally.ran));
    expect(checkFuzzRuns([over.run], true)).toEqual([
      "conformance:diff: 3 runaway fuzz cases (seed 1); at most 2 allowed (max(1% of cases, 2))",
    ]);
  });
});

/** Like spawn, but every callback first reports q: the loop's own record. */
function spawnQ(ctx: BuildContext): void {
  const fire = () => {
    ctx.external(["q", 1]);
    setTimeout(fire, 1);
    setTimeout(fire, 1);
  };
  setTimeout(fire, 1);
  setTimeout(fire, 1);
}

/** The timer callbacks every engine makes in the TICKS step. */
const TICKS = 3;

/**
 * Every engine runs a chain of TICKS timer callbacks, so the reference
 * makes exactly TICKS. A spinning engine with `qAt` ticks on to `qAt`,
 * reports q there, then spins: q's record is the first one past the
 * reference's total when `qAt` is TICKS + 1, the last one before it when
 * `qAt` is TICKS.
 */
const TICK: Step = {
  op: "run",
  label: "ticks",
  fn: (_s, ctx) => {
    const { qAt = 0, spin } = marksOf(ctx);
    let k = 0;
    const tick = () => {
      k++;
      if (k === qAt) {
        ctx.external(["q", 1]);
      }
      if (k < TICKS || (spin && k < qAt)) {
        setTimeout(tick, 1);
      } else if (spin) {
        spawn();
      }
    };
    setTimeout(tick, 1);
    vi.advanceTimersByTime(100);
  },
};

describe("(e) the runaway starts where the engine outworks the reference, not where the budget runs out", () => {
  it("P1: a loop whose own records match the `ends` entry is still a hang", async () => {
    // The loop starts in step 1 and reports q in every callback; the first
    // q is an `ends` stop far below the point the budget ran out.
    const result = await runScenario(
      fuzzCase([
        {
          op: "run",
          label: "loop",
          fn: (_s, ctx) => {
            if (marksOf(ctx).loopQ) {
              spawnQ(ctx);
            }
          },
        },
        ADVANCE,
      ]),
      {
        candidates: [marked("v2", { loopQ: true })],
        divergences: [ends("extra")],
      },
    );
    expect(result.fired).toBe(0);
    expect(result.ended).toMatchObject([{ engine: "v2", id: "q-ends" }]);
    expectHang(result, "v2");
  });

  it("P3: a loop that started before the stop and ran out of budget after it is still a hang", async () => {
    const result = await runScenario(
      fuzzCase([
        {
          op: "run",
          label: "loop a little",
          fn: (_s, ctx) => {
            if (marksOf(ctx).spin) {
              // 2 + 4 + 8 callbacks: far below the budget.
              spawn();
              vi.advanceTimersByTime(3);
            }
          },
        },
        REPORT,
        ADVANCE,
      ]),
      {
        candidates: [marked("v2", { diff: true, spin: true })],
        divergences: [ends()],
      },
    );
    expect(result.fired).toBe(0);
    expect(result.ended).toMatchObject([{ engine: "v2", id: "q-ends" }]);
    expectHang(result, "v2");
  });

  it("the stop must be strictly before the point: the last record within the reference's callbacks is discarded, the first past them is a hang", async () => {
    const run = (qAt: number) =>
      runScenario(fuzzCase([TICK]), {
        candidates: [marked("v2", { qAt, spin: true })],
        divergences: [ends("extra")],
      });

    const within = await run(TICKS);
    expect(within.fired).toBe(TICKS);
    expect(within.ended).toMatchObject([{ engine: "v2", id: "q-ends" }]);
    expect([within.ok, within.discarded, within.hung]).toEqual([
      true,
      ["v2"],
      [],
    ]);

    // q is the first record of callback TICKS + 1: at the point, not before.
    const at = await run(TICKS + 1);
    expect(at.fired).toBe(TICKS);
    expect(at.ended).toMatchObject([{ engine: "v2", id: "q-ends" }]);
    expectHang(at, "v2");
  });

  it("P2: a discarded case still fails on a difference before its stop", async () => {
    // z differs in step 1, the stop is in step 2, the runaway in step 4.
    const Z: Step = {
      op: "run",
      label: "report z",
      fn: (_s, ctx) => ctx.external(["z", marksOf(ctx).z ? 1 : 0]),
    };
    const result = await runScenario(fuzzCase([Z, REPORT, SPIN, ADVANCE]), {
      candidates: [marked("v2", { z: true, diff: true, spin: true })],
      divergences: [ends()],
    });
    expect(result.discarded).toEqual(["v2"]);
    expect(result.hung).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.ended).toMatchObject([{ engine: "v2", id: "q-ends" }]);
    expect(result.unexplained).toMatchObject([
      { engine: "v2", op: "changed", stream: "external", step: 1 },
    ]);
    expect(result.report).toMatch(/engines differ/);
  });
});
