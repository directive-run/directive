/**
 * The fuzz harness's shared wait at a `settle` step (diff/scenario.ts
 * `SettleDrain`, the reading in diff/fuzz/model.ts `batchDrain`; Jason,
 * 2026-11-07: "One shared wait (Recommended)"). It replaced the separate
 * drains of 1.35's batches (Jason, 2026-11-06: "Wait out 1.35's batches
 * (Recommended)") and of 2.0's detached batch runs (Jason, 2026-11-07:
 * "Wait out 2.0's detached batches too (Recommended)"): after `settle()`
 * resolves, both engines' fake clocks advance together until neither has a
 * batch still running (on 1.35 any batch, on 2.0 a detached run), capped
 * at 5 s. Each test proves one edge: 1.35 really does checkpoint with a
 * batch running; the wait makes that case compare equal (on the workspace
 * engine too) with both clocks ending at the same time (seed 4's drift
 * case among them); a 2.0 whose `settle()` resolves early on an attached
 * batch still differs; both engines live at the cap (built in the test, a
 * batch live on each) is discarded; only 2.0 live at the cap fails, as a 2.0
 * bug, unless an approved `ends` entry had stopped 2.0's comparison before
 * 2.0 outworked the reference (seeds 8 and 2: discarded after the stop, toward the
 * runaway limit, naming the entry; Jason, 2026-11-08: "Use 'Discard after the stop' (Recommended)"), while a stop after the
 * reference finished still fails; and the cap counting. A case discarded because it never settles counts on its
 * own, at most max(1% of the seed's cases, 3) (Jason, 2026-11-07:
 * "Discard, own count (Recommended)"; the cap, Jason, 2026-11-07: "Cap at
 * 1% of cases, min 3 (Recommended)").
 */

import { describe, expect, it } from "vitest";
import {
  type FuzzRun,
  checkFuzzRuns,
  describeNeverSettles,
} from "../../lib/census.js";
import {
  FUZZ_BATCH_REPORT_ENV,
  FUZZ_FLOOR,
  MIN_NEVER_SETTLES,
  batchReportMode,
  maxNeverSettles,
  onFailingCase,
} from "../../lib/fuzz.js";
import { type EngineHandle, engines } from "../engines.js";
import { type FuzzSpec, specTriggers, toScenario } from "../fuzz/model.js";
import type { TraceEntry } from "../record.js";
import {
  DRAIN_ENGINES,
  type FuzzTally,
  type ScenarioResult,
  type SettleWait,
  drains,
  drainsDetached,
  newFuzzTally,
  nextTargets,
  readDivergences,
  runBudgeted,
  runScenario,
  tallyCase,
} from "../scenario.js";

/**
 * One module; a write raises one batched requirement, whose handler waits
 * 5 ms and writes the source fact back below its threshold. Steps: start,
 * the write, then the case's closing `settle` (step 2).
 */
const spec: FuzzSpec = {
  modules: [
    {
      facts: 3,
      date: false,
      derivations: [],
      events: [],
      constraints: [],
      effects: [],
      source: null,
    },
  ],
  boundary: null,
  history: false,
  trace: false,
  steps: [{ op: "set", module: 0, fact: 0, value: 5 }],
  batch: {
    sources: [{ fact: 0, atLeast: 1, items: 1, abortOn: false }],
    handler: "batch",
    failing: "all",
    windowMs: 0,
    maxSize: null,
    delay: 5,
    fails: 0,
    retry: 0,
    timeout: null,
    writes: 0,
    value: -1,
  },
};
const SETTLE_STEP = 2;

const [, local, v2] = engines() as [EngineHandle, EngineHandle, EngineHandle];

/** Seed 4 (PR count, up to L7): its settle checkpoints drifted 12 ms against 250 ms under the separate drains. */
const SEED_4: FuzzSpec = JSON.parse(
  '{"modules": [{"facts": 1, "date": true, "derivations": [{"facts": [0], "derived": [], "threshold": -2, "throwsAt": 3}, {"facts": [0], "derived": [0], "threshold": 3, "throwsAt": null}], "events": [{"target": 0, "add": false}, {"target": 0, "add": true}, {"target": 0, "add": true}], "constraints": [{"fact": 0, "atLeast": 2, "crossAtLeast": null, "priority": 1, "writes": 0, "value": 1, "delay": 5, "fails": 0, "retry": 1, "timeout": 3}, {"fact": 0, "atLeast": 0, "crossAtLeast": null, "priority": 2, "writes": 0, "value": 2, "delay": 5, "fails": 2, "retry": 0, "timeout": null}], "effects": [], "source": {"gated": true}}], "boundary": "disable", "history": false, "trace": false, "steps": [{"op": "dispatch", "module": 0, "event": 1842972639, "value": 1}, {"op": "settle"}, {"op": "settle"}, {"op": "publish", "event": "cross", "value": 5}, {"op": "destroy"}, {"op": "publish", "event": "unknown", "value": 4}, {"op": "set", "module": 0, "fact": 845476302, "value": -2}], "batch": {"sources": [{"fact": 2, "atLeast": 0, "items": 1, "abortOn": true}, {"fact": 2, "atLeast": 2, "items": 3, "abortOn": true}], "handler": "batch", "failing": "some", "windowMs": 5, "maxSize": 1, "delay": 5, "fails": 2, "retry": 1, "timeout": 10, "writes": 0, "value": 5}}',
);

/**
 * Seed 8 (PR count, up to L7): a.r1's write retracts the batch's
 * requirements and aborts its calls, and each aborted call still writes,
 * raising them again (scratchpad/l7-seed8/seed8.md). Only 2.0 enters the
 * chase, through approved quirk a's re-dispatch.
 */
const SEED_8: FuzzSpec = JSON.parse(
  '{"modules":[{"facts":2,"date":false,"derivations":[{"facts":[0],"derived":[],"threshold":5,"throwsAt":7}],"events":[{"target":0,"add":true}],"constraints":[{"fact":0,"atLeast":2,"crossAtLeast":null,"priority":3,"writes":1,"value":1,"delay":0,"fails":1,"retry":1,"timeout":50},{"fact":1,"atLeast":0,"crossAtLeast":null,"priority":2,"writes":1,"value":-1,"delay":1,"fails":2,"retry":1,"timeout":3}],"effects":[],"source":null},{"facts":2,"date":true,"derivations":[{"facts":[1],"derived":[],"threshold":0,"throwsAt":null}],"events":[{"target":0,"add":true}],"constraints":[{"fact":1,"atLeast":0,"crossAtLeast":null,"priority":2,"writes":0,"value":2,"delay":20,"fails":0,"retry":2,"timeout":3},{"fact":0,"atLeast":1,"crossAtLeast":2,"priority":3,"writes":0,"value":-2,"delay":0,"fails":1,"retry":2,"timeout":10}],"effects":[],"source":{"gated":true}}],"boundary":"retry","history":false,"trace":false,"steps":[{"op":"set","module":0,"fact":481019608,"value":2}],"batch":{"sources":[{"fact":0,"atLeast":0,"items":3,"abortOn":false},{"fact":1,"atLeast":1,"items":3,"abortOn":false}],"handler":"batch","failing":"some","windowMs":0,"maxSize":1,"delay":5,"fails":0,"retry":0,"timeout":10,"writes":1,"value":2}}',
);

/**
 * Deep seed 2 (DIFF_FUZZ_RUNS=5000): rb's write and r0's chase each other
 * (scratchpad/l7-deep-triage/triage.md); only 2.0 enters the chase, through
 * approved quirk a's re-dispatch of the failed r0 under "retry", and 1.35
 * runs the same chase once r0 writes. No write is made under an aborted
 * signal (the one abort is rb's own, `abortOn` firing on its write).
 */
const SEED_2: FuzzSpec = JSON.parse(
  '{"modules":[{"facts":1,"date":false,"derivations":[],"events":[{"target":0,"add":false}],"constraints":[{"fact":0,"atLeast":1,"crossAtLeast":null,"priority":0,"writes":0,"value":0,"delay":0,"fails":1,"retry":0,"timeout":null}],"effects":[],"source":null},{"facts":2,"date":false,"derivations":[],"events":[{"target":0,"add":false}],"constraints":[],"effects":[],"source":null}],"boundary":"retry","history":false,"trace":false,"steps":[{"op":"settle"}],"batch":{"sources":[{"fact":0,"atLeast":0,"items":3,"abortOn":true},{"fact":0,"atLeast":0,"items":1,"abortOn":false}],"handler":"fallback","failing":"all","windowMs":0,"maxSize":1,"delay":5,"fails":0,"retry":0,"timeout":null,"writes":0,"value":1}}',
);

/**
 * Deep seed 24301 (DIFF_FUZZ_RUNS=5000): both engines' `settle()` resolve
 * at 1 ms settled, with nothing in flight; in that same millisecond r1's
 * canceled attempt ignores its abort, writes, and raises attempt 2 on both.
 */
const SEED_24301: FuzzSpec = JSON.parse(
  '{"modules":[{"facts":2,"date":false,"derivations":[],"events":[{"target":0,"add":false}],"constraints":[{"fact":0,"atLeast":0,"crossAtLeast":null,"priority":0,"writes":0,"value":0,"delay":1,"fails":0,"retry":0,"timeout":null},{"fact":0,"atLeast":1,"crossAtLeast":null,"priority":0,"writes":0,"value":1,"delay":1,"fails":0,"retry":0,"timeout":null}],"effects":[],"source":null},{"facts":2,"date":false,"derivations":[],"events":[{"target":0,"add":false}],"constraints":[],"effects":[],"source":null}],"boundary":null,"history":false,"trace":false,"steps":[{"op":"dispatch","module":0,"event":0,"value":1},{"op":"publish","event":"own","value":0}],"batch":{"sources":[{"fact":0,"atLeast":0,"items":1,"abortOn":false}],"handler":"batch","failing":"all","windowMs":5,"maxSize":null,"delay":0,"fails":0,"retry":0,"timeout":null,"writes":0,"value":0}}',
);

/**
 * Seed 12 (PR count, every layer): 1.35's batch call times out (3 ms, its
 * handler waits 5) at the very fake time its settle step's wait reached.
 */
const SEED_12: FuzzSpec = JSON.parse(
  '{"modules": [{"facts": 1, "date": true, "derivations": [{"facts": [0], "derived": [], "threshold": null, "throwsAt": 7}], "events": [{"target": 0, "add": true}], "constraints": [{"fact": 0, "atLeast": 2, "crossAtLeast": null, "priority": 1, "writes": 0, "value": 5, "delay": 1, "fails": 0, "retry": 0, "timeout": 3}, {"fact": 0, "atLeast": 2, "crossAtLeast": null, "priority": 1, "writes": 0, "value": -1, "delay": 5, "fails": 1, "retry": 0, "timeout": 3}], "effects": [{"reads": [0], "explicitDeps": false, "cleanup": true, "throwsAt": 4}], "source": null}], "boundary": "skip", "history": false, "trace": false, "steps": [{"op": "settle"}, {"op": "settle"}, {"op": "set", "module": 0, "fact": 595195548, "value": 5}, {"op": "publish", "event": "unknown", "value": 3}, {"op": "set", "module": 0, "fact": 2106050436, "value": 4}, {"op": "dispatch", "module": 0, "event": 133779519, "value": 0}, {"op": "dispatch", "module": 0, "event": 1504678319, "value": 3}, {"op": "settle"}, {"op": "tick"}, {"op": "set", "module": 0, "fact": 1539898074, "value": 2}], "batch": {"sources": [{"fact": 1, "atLeast": 2, "items": 1, "abortOn": true}, {"fact": 2, "atLeast": 0, "items": 1, "abortOn": true}], "handler": "batch", "failing": "some", "windowMs": 0, "maxSize": 1, "delay": 5, "fails": 1, "retry": 0, "timeout": 3, "writes": 1, "value": 2}}',
);

/**
 * Seed 19 (PR count, up to L7): a write clobbers the batch's write and
 * aborts its calls' signals (abortOn) while their 10 ms timeouts are
 * pending; each timeout still fires on 1.35, and each run end asks a pass.
 */
const SEED_19: FuzzSpec = JSON.parse(
  '{"modules": [{"facts": 3, "date": true, "derivations": [{"facts": [2], "derived": [], "threshold": 4, "throwsAt": null}, {"facts": [1, 0], "derived": [0], "threshold": -1, "throwsAt": 7}, {"facts": [2], "derived": [], "threshold": 1, "throwsAt": 8}], "events": [{"target": 1, "add": true}, {"target": 2, "add": true}, {"target": 0, "add": true}], "constraints": [{"fact": 2, "atLeast": 0, "crossAtLeast": null, "priority": 1, "writes": 2, "value": 6, "delay": 5, "fails": 2, "retry": 2, "timeout": 50}, {"fact": 2, "atLeast": 0, "crossAtLeast": null, "priority": 1, "writes": 0, "value": 2, "delay": 0, "fails": 2, "retry": 0, "timeout": 50}], "effects": [{"reads": [2, 1], "explicitDeps": false, "cleanup": true, "throwsAt": 6}], "source": {"gated": false}}, {"facts": 3, "date": false, "derivations": [], "events": [{"target": 0, "add": true}], "constraints": [{"fact": 0, "atLeast": 4, "crossAtLeast": 3, "priority": 0, "writes": 2, "value": 4, "delay": 20, "fails": 0, "retry": 2, "timeout": 10}], "effects": [{"reads": [2], "explicitDeps": true, "cleanup": false, "throwsAt": 3}], "source": null}], "boundary": "skip", "history": false, "trace": false, "steps": [{"op": "dispatch", "module": 0, "event": 2060111229, "value": -2}, {"op": "settle"}, {"op": "batch", "module": 1, "writes": [[197571838, 4], [2123076522, 6]]}, {"op": "dispatch", "module": 1, "event": 308157108, "value": 6}, {"op": "advance", "ms": 1}, {"op": "tick"}, {"op": "date", "module": 1, "ms": 0}, {"op": "settle"}, {"op": "set", "module": 1, "fact": 189948781, "value": 3}, {"op": "publish", "event": "unknown", "value": -2}, {"op": "set", "module": 0, "fact": 1362201528, "value": 6}], "batch": {"sources": [{"fact": 2, "atLeast": 0, "items": 2, "abortOn": true}], "handler": "batch", "failing": "some", "windowMs": 1, "maxSize": 1, "delay": 20, "fails": 1, "retry": 2, "timeout": 10, "writes": 0, "value": -1}}',
);

/** The step of each `hook` record (each `onError` naming every one of `parts`, if given). */
function stepsOfHook(
  trace: TraceEntry[],
  hook: string,
  parts: string[] = [],
): number[] {
  const steps: number[] = [];
  let step = -1;
  for (const entry of trace) {
    if (entry.k === "step") {
      step = entry.i;
    } else if (
      entry.k === "hook" &&
      entry.hook === hook &&
      parts.every((part) => JSON.stringify(entry.args).includes(part))
    ) {
      steps.push(step);
    }
  }

  return steps;
}

/** Marks a system of `keepsDetachedAlive`'s v2 once its settle() has resolved. */
const KEEP = Symbol("keeps a detached batch alive");

/**
 * v2 that keeps a detached batch run going once its `settle()` has resolved
 * (a 2.0 bug the shared wait must fail): its system reads as live to the
 * test's rule, and a timer every 100 ms keeps its clock moving. With
 * `sayAt`, it also prints one `console.info` record (an extra record, for a
 * test `ends` entry to stop at) at the first point its fake clock is at or
 * past `sayAt` once its settle() resolved: at once for 0.
 */
function keepsDetachedAlive(
  engine: EngineHandle,
  sayAt?: number,
): EngineHandle {
  return {
    ...engine,
    name: "v2+keepalive",
    async load() {
      const core = await engine.load();

      return {
        ...core,
        createSystem(config: unknown) {
          const system = (core as any).createSystem(config);
          let alive = false;

          return new Proxy(system, {
            get(target, key) {
              if (key === KEEP) {
                return alive;
              }
              if (key === "settle") {
                return async () => {
                  await target.settle();
                  alive = true;
                  let said = false;
                  const tick = () => {
                    if (!said && sayAt !== undefined && Date.now() >= sayAt) {
                      said = true;
                      console.info("keepalive");
                    }
                    setTimeout(tick, 100);
                  };
                  tick();
                };
              }
              const value = Reflect.get(target, key, target);

              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      } as typeof core;
    },
  };
}

/** v2 with 1.35's `settle()`: it resolves after a microtask, batch or not. */
function settlesEarly(engine: EngineHandle): EngineHandle {
  return {
    ...engine,
    async load() {
      const core = await engine.load();

      return {
        ...core,
        createSystem(config: unknown) {
          const system = (core as any).createSystem(config);

          return new Proxy(system, {
            get(target, key) {
              if (key === "settle") {
                return async () => {
                  await Promise.resolve();
                };
              }
              const value = Reflect.get(target, key, target);

              return typeof value === "function" ? value.bind(target) : value;
            },
          });
        },
      } as typeof core;
    },
  };
}

describe("the fuzz shared wait at a settle step", () => {
  it("without it, 1.35 checkpoints with the batch still running and differs", async () => {
    const def = { ...toScenario(spec), settleDrain: undefined };
    const result = await runScenario(def, {
      candidates: [v2],
      divergences: [],
    });
    expect(result.ok).toBe(false);
    expect(result.unexplained.some((d) => d.step === SETTLE_STEP)).toBe(true);
  });

  it("with it, the same case compares equal, on the workspace engine too", async () => {
    const result = await runScenario(toScenario(spec), {
      candidates: [local, v2],
      divergences: [],
    });
    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    expect(result.drained).toBe(1);
    expect(result.settleTimes).toEqual({ v1: [5], local: [5], v2: [5] });
  });

  it("(d) a 2.0 whose settle() resolves early on an attached batch still differs: it takes no part in the wait", async () => {
    expect(DRAIN_ENGINES.has("v2")).toBe(false);
    expect([drains({ name: "v2" }), drains({ name: "local+control" })]).toEqual(
      [false, true],
    );
    expect([drainsDetached({ name: "v2" }), drainsDetached(local)]).toEqual([
      true,
      false,
    ]);
    const early = settlesEarly(v2);
    expect(early.name).toBe("v2");
    const result = await runScenario(toScenario(spec), {
      candidates: [early],
      divergences: [],
    });
    expect(result.ok).toBe(false);
    expect(result.unexplained.some((d) => d.step === SETTLE_STEP)).toBe(true);
    expect(result.drainedDetached).toBe(0);
    // It took no part: its clock stayed where its settle() resolved.
    expect(result.settleTimes).toEqual({ v1: [5], v2: [0] });
  });

  it("v2's attached work is read the instant its settle() resolves: deep seed 24301's post-settle timer, in the same millisecond, starts work both engines wait out, and they compare equal", async () => {
    const def = toScenario(SEED_24301);
    const own = await runBudgeted(v2, def);
    expect(own.waits.map((w) => [w.resolvedAt, w.attached])).toEqual([
      [1, undefined],
    ]);
    const result = await runScenario(def, { candidates: [local, v2] });
    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    expect(result.settleTimes!.v2).toEqual(result.settleTimes!.v1);
    expect(result.settleTimes!.v1).toEqual([2]);
  });

  it("v2's detached batch run is waited out in the same wait as 1.35's batch; kept out of it, v2 differs", async () => {
    // A bound batch (abortOn the handler's write key, f1): its requirement is
    // retracted (f0 back to 0) while the call waits its 5 ms, so v2 detaches
    // the run (RFC-0003) and its settle() resolves at once; 1.35's drain
    // waits the call out. Steps: start, raise, open the window, retract,
    // settle (step 4).
    const detachedSpec: FuzzSpec = {
      ...spec,
      steps: [
        { op: "set", module: 0, fact: 0, value: 5 },
        { op: "advance", ms: 1 },
        { op: "set", module: 0, fact: 0, value: 0 },
      ],
      batch: {
        ...spec.batch!,
        sources: [{ fact: 0, atLeast: 1, items: 1, abortOn: true }],
        writes: 1,
      },
    };
    const def = toScenario(detachedSpec);
    const withRule = await runScenario(def, {
      candidates: [v2],
      divergences: [],
    });
    expect(withRule.report).toBe("");
    expect(withRule.ok).toBe(true);
    expect([withRule.drained, withRule.drainedDetached]).toEqual([1, 1]);

    expect(withRule.settleTimes).toEqual({ v1: [5], v2: [5] });

    // Kept out of the wait (as an early settle() is), v2 differs there.
    const without = await runScenario(
      {
        ...def,
        settleDrain: { ...def.settleDrain!, attached: () => "kept out" },
      },
      { candidates: [v2], divergences: [] },
    );
    expect(without.ok).toBe(false);
    expect(without.drainedDetached).toBe(0);
    expect(without.unexplained.some((d) => d.step === 4)).toBe(true);
  });

  it("(a) the clocks end equal: seed 4's drift case takes a second round and then compares equal", async () => {
    const def = toScenario(SEED_4);
    // Their own waits, without the shared targets, end at different times.
    const own = async (engine: EngineHandle): Promise<SettleWait[]> =>
      (await runBudgeted(engine, def)).waits;
    const [ref] = engines() as [EngineHandle];
    const mine = await own(ref);
    const theirs = await own(v2);
    expect(mine.map((w) => w.endAt)).not.toEqual(theirs.map((w) => w.endAt));
    expect(nextTargets(mine, theirs, new Map())).toBeDefined();

    const result = await runScenario(def, { candidates: [local, v2] });
    expect(result.report).toBe("");
    expect(result.ok).toBe(true);
    expect(result.sharedRounds).toBeGreaterThan(1);
    const times = result.settleTimes!;
    expect(times.v2).toEqual(times.v1);
    expect(times.local).toEqual(times.v1);
  });

  it("a timer due exactly at a call's timeout is inside the wait: seed 12's batch timeout is reported at its settle step on 1.35, as on 2.0", async () => {
    const def = toScenario(SEED_12);
    const [ref] = engines() as [EngineHandle];
    const timedOut = ["Batch resolver", "rb", "timed out after 3ms"];
    const mine = stepsOfHook(
      (await runBudgeted(ref, def)).trace,
      "onError",
      timedOut,
    );
    const theirs = stepsOfHook(
      (await runBudgeted(v2, def)).trace,
      "onError",
      timedOut,
    );
    // Step 8 is the settle step (`start` is step 0).
    expect(def.steps[8]).toEqual({ op: "settle" });
    expect(theirs).toContain(8);
    expect(mine).toEqual(theirs);
  });

  it("an aborted call is live while its timeout timer is pending: seed 19's clobbered calls time out inside the wait, so 1.35's passes fall in the steps 2.0's do", async () => {
    const def = toScenario(SEED_19);
    const [ref] = engines() as [EngineHandle];
    const mine = stepsOfHook(
      (await runBudgeted(ref, def)).trace,
      "onReconcileStart",
    );
    const theirs = stepsOfHook(
      (await runBudgeted(v2, def)).trace,
      "onReconcileStart",
    );
    expect(mine).toEqual(theirs);
    const result = await runScenario(def, { candidates: [local, v2] });
    expect(
      result.unexplained.filter((d) => d.kind === "onReconcileStart"),
    ).toEqual([]);
  });

  it("(b) both engines live at the cap (built here: a batch live on each): discarded as never settling, on its own count, within the cap", async () => {
    // Built, not found: the rule under test is what the wait does with a
    // case both engines are live in at the cap, not what any engine does
    // with one spec (seed 10's mutual-write loop was this case on 2.0 until
    // a batched requirement re-raised while its batch runs was queued
    // again). A batch is live on each engine for the whole wait: 1.35's own
    // 5 ms timer carries its clock past the 2 ms cap; v2, whose settle()
    // waited the spec's batch out, keeps a timer every 100 ms
    // (`keepsDetachedAlive`) and is live at the cap too.
    const def = {
      ...toScenario(spec),
      settleDrain: { boundMs: 2, busy: () => "a test batch is live" },
    };
    const result = await runScenario(def, {
      candidates: [keepsDetachedAlive(v2)],
      divergences: [],
    });
    expect(result.neverSettles).toBe(true);
    expect(result.bothLive).toBe(true);
    expect(result.runaway).toBe(false);
    expect(result.twoOnlyLive).toBeUndefined();
    expect(result.compared).toEqual([]);
    expect(result.report).toMatch(
      /^never settles in scenario "fuzz": on the reference \(v1\) the shared wait at step 2 passed its cap: a test batch is live, \d+ ms after settle\(\) resolved \(cap 2 ms\), and on v2\+keepalive too \(at step 2: a test batch is live, \d+ ms after settle\(\) resolved \(cap 2 ms\)\), so the case is discarded, not compared$/,
    );

    // On its own count: not a runaway, and within the cap (max(1% of the
    // seed's cases, 3)) it fails nothing; the census prints it on its own
    // line.
    const compared = await runScenario(toScenario(spec), {
      candidates: [local, v2],
      divergences: [],
    });
    expect(compared.ok).toBe(true);
    const tally: FuzzTally = newFuzzTally();
    for (let i = 0; i < FUZZ_FLOOR; i++) {
      tallyCase(tally, compared);
    }
    tallyCase(tally, result);
    expect(tally).toMatchObject({
      ran: FUZZ_FLOOR + 1,
      runaway: 0,
      afterStop: 0,
      neverSettles: 1,
      bothLive: 1,
      onV2: FUZZ_FLOOR,
    });
    const run: FuzzRun = {
      seed: 1,
      runs: tally.ran - tally.runaway - tally.neverSettles,
      runaway: tally.runaway,
      runawayAfterStop: tally.afterStop,
      neverSettles: tally.neverSettles,
      v2: tally.onV2,
    };
    expect(checkFuzzRuns([run], true)).toEqual([]);
    expect(describeNeverSettles([run])).toMatch(/seed 1: 1 of at most 3$/);
  });

  it("(c) only 2.0 live at the cap while 1.35 settled in the same time: the case fails, as a 2.0 bug, naming what kept it live", async () => {
    const def = toScenario(spec);
    const base = def.settleDrain!;
    const result = await runScenario(
      {
        ...def,
        settleDrain: {
          ...base,
          busy: (ctx, system) =>
            (system as any)[KEEP]
              ? "a detached batch run of v2+keepalive is live"
              : base.busy(ctx, system),
        },
      },
      { candidates: [keepsDetachedAlive(v2)], divergences: [] },
    );
    expect(result.neverSettles).toBeFalsy();
    expect(result.discarded).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.twoOnlyLive).toMatch(
      /^2\.0-only live: at step 2 v2\+keepalive still had a batch live at the shared wait's cap \(a detached batch run of v2\+keepalive is live, \d+ ms after settle\(\) resolved \(cap 5000 ms\)\) while the reference's batches had finished by 5 ms \(its handlers wrote 0 time\(s\) after an abort during the wait\), with no `ends` stop before it; a 2\.0 bug/,
    );
    expect(result.report).toContain(
      'v2+keepalive in scenario "fuzz": 2.0-only live',
    );
    // With the nightly's report flag on, this batched case still fails:
    // the verdict is already a 2.0 bug, which "blocks at once" (Jason,
    // 2026-11-09). Without the verdict, the same failing case is reported.
    const triggers = specTriggers(spec);
    expect(triggers).toContain("batched");
    const flagOn = batchReportMode({ [FUZZ_BATCH_REPORT_ENV]: "1" });
    expect(flagOn).toBe(true);
    expect(onFailingCase(triggers, flagOn, result.twoOnlyLive)).toBe("fail");
    expect(onFailingCase(triggers, flagOn)).toBe("report");
    // 1.35's clock ran as long as v2's, and its batch had still finished.
    expect(result.settleTimes!.v1).toEqual(result.settleTimes!["v2+keepalive"]);
  });

  it("seeds 8 and 2: only 2.0 live at the cap, after an approved `ends` stop (quirk a's re-dispatch) that came before 2.0 outworked the reference: discarded after the stop, naming the entry", async () => {
    const stops: string[] = [];
    for (const [label, s] of [
      ["seed 8", SEED_8],
      ["seed 2", SEED_2],
    ] as const) {
      const result = await runScenario(toScenario(s), {
        candidates: [local, v2],
      });
      expect([label, result.twoOnlyLive]).toEqual([label, undefined]);
      expect(result.neverSettles).toBeFalsy();
      expect(result.runaway).toBe(false);
      expect(result.discarded).toEqual(["v2"]);
      expect(result.afterStop).toEqual([
        { engine: "v2", id: expect.any(String), wait: true },
      ]);
      const id = result.afterStop![0]!.id;
      // The stop is an approved, signed `ends` entry (the earliest `ends`
      // difference on v2, the seed's own: quirk a's or row (at)'s).
      const entry = readDivergences().find((e) => e.id === id);
      expect([label, entry?.ends, entry?.approvedBy]).toEqual([
        label,
        true,
        "Jason Comes",
      ]);
      stops.push(`${label}: ${id}`);
      expect(result.ended.find((e) => e.engine === "v2")?.id).toBe(id);
      expect(
        result.advisories.filter((a) =>
          a.startsWith(`2.0-only live after the stop by ${id}: at step `),
        ),
      ).toHaveLength(1);
      // Its differences before the stop were still checked, and pass.
      expect([label, result.unexplained]).toEqual([label, []]);
      expect(result.ok).toBe(true);
      const tally = newFuzzTally();
      tallyCase(tally, result);
      expect(tally).toMatchObject({
        runaway: 1,
        afterStop: 1,
        afterStopAtWait: 1,
        afterStopBy: { [id]: 1 },
        neverSettles: 0,
        twoOnlyLive: 0,
      });
    }
    console.info(
      `[settle-drain] discarded after the stop by: ${stops.join("; ")}`,
    );
  });

  it("only 2.0 live at the cap after an `ends` stop: discarded when the stop came before 2.0's clock reached the reference's wait end, failed when it came after", async () => {
    const def = toScenario(spec);
    const base = def.settleDrain!;
    const tampered = {
      ...def,
      settleDrain: {
        ...base,
        busy: (ctx: any, system: any) =>
          system[KEEP]
            ? "a detached batch run of v2+keepalive is live"
            : base.busy(ctx, system),
      },
    };
    const stopAtTheRecord = {
      id: "test-keepalive-console-ends",
      scenario: "fuzz",
      stream: "console",
      kind: "info",
      engine: "v2+keepalive",
      op: "extra" as const,
      ends: true,
      reason: "test only: stops the comparison at the keepalive's record",
      approvedBy: "test",
      date: "2026-11-08",
    };
    // Its record at once (before 1.35's batch had finished, at 5 ms):
    // the stop came first, so the case is discarded after it.
    const early = await runScenario(tampered, {
      candidates: [keepsDetachedAlive(v2, 0)],
      divergences: [stopAtTheRecord],
    });
    expect(early.ended.map((e) => e.id)).toEqual([stopAtTheRecord.id]);
    expect(early.twoOnlyLive).toBeUndefined();
    expect(early.discarded).toEqual(["v2+keepalive"]);
    expect(early.ok).toBe(true);
    // Its record at 1 s, after 1.35's batch had finished: the stop is the
    // loop's own, so the case still fails as 2.0-only live.
    const late = await runScenario(tampered, {
      candidates: [keepsDetachedAlive(v2, 1000)],
      divergences: [stopAtTheRecord],
    });
    expect(late.ended.map((e) => e.id)).toEqual([stopAtTheRecord.id]);
    expect(late.discarded).toEqual([]);
    expect(late.ok).toBe(false);
    expect(late.twoOnlyLive).toMatch(
      /^2\.0-only live: .*, and the stop by test-keepalive-console-ends came only after v2\+keepalive had outworked the reference; a 2\.0 bug/,
    );
  });

  it("a handler's write after its signal is aborted is counted, for a single resolver and for the batched handler, on both engines", async () => {
    // A write raises the run (r0, and the batch's one item), a second
    // retracts it while the handler waits 5 ms: both runs are canceled and
    // their signals aborted, and each handler still writes.
    const steps: FuzzSpec["steps"] = [
      { op: "set", module: 0, fact: 0, value: 5 },
      { op: "advance", ms: 1 },
      { op: "set", module: 0, fact: 0, value: 0 },
      { op: "advance", ms: 10 },
    ];
    const single: FuzzSpec = {
      ...spec,
      modules: [
        {
          ...spec.modules[0]!,
          constraints: [
            {
              fact: 0,
              atLeast: 1,
              crossAtLeast: null,
              priority: 1,
              writes: 1,
              value: 3,
              delay: 5,
              fails: 0,
              retry: 0,
              timeout: null,
            },
          ],
        },
      ],
      steps,
      // The batch never raises here.
      batch: {
        ...spec.batch!,
        sources: [{ fact: 0, atLeast: 100, items: 1, abortOn: false }],
      },
    };
    const batched: FuzzSpec = {
      ...spec,
      steps,
      batch: { ...spec.batch!, writes: 2, value: 4 },
    };
    const counts: Record<string, number> = {};
    for (const [label, s] of [
      ["single", single],
      ["batch", batched],
    ] as const) {
      for (const engine of [engines()[0]!, v2]) {
        const def = toScenario(s);
        const base = def.settleDrain!;
        let seen: unknown;
        const run = await runBudgeted(engine, {
          ...def,
          settleDrain: {
            ...base,
            busy: (ctx, system) => {
              seen = ctx;

              return base.busy(ctx, system);
            },
          },
        });
        counts[`${label} ${engine.name}`] = base.writeAfterAbort!(seen as any);
        // The writes landed before the closing settle: none during its wait.
        expect(run.waits.map((w) => w.writeAfterAbort)).toEqual([0]);
      }
    }
    expect(counts).toEqual({
      "single v1": 1,
      "single v2": 1,
      "batch v1": 1,
      "batch v2": 1,
    });
  });

  it("the targets: the later end time wins, later steps' targets drop, and a live engine sets the other's clock", () => {
    const w = (step: number, endAt: number, extra: Partial<SettleWait> = {}) =>
      ({ step, resolvedAt: 0, endAt, waited: true, ...extra }) as SettleWait;
    expect(nextTargets([w(2, 5)], [w(2, 5)], new Map())).toBeUndefined();
    expect(
      nextTargets(
        [w(2, 12), w(5, 20)],
        [w(2, 250), w(5, 300)],
        new Map([
          [2, 9],
          [5, 30],
        ]),
      ),
    ).toEqual({ targets: new Map([[2, 250]]), judge: new Set() });
    expect(
      nextTargets([w(2, 5), w(5, 20)], [w(2, 5), w(5, 9)], new Map([[2, 5]])),
    ).toEqual({
      targets: new Map([
        [2, 5],
        [5, 20],
      ]),
      judge: new Set(),
    });
    // v2 kept out (attached work) sets nothing.
    expect(
      nextTargets([w(2, 5)], [w(2, 0, { attached: "x" })], new Map()),
    ).toBeUndefined();
    // Both live at the cap, each at its own: judged, never advanced again.
    expect(
      nextTargets(
        [w(2, 5004, { live: "x" })],
        [w(2, 5017, { live: "y" })],
        new Map([[2, 5017]]),
      ),
    ).toBeUndefined();
    // v2 live at the cap: 1.35's clock must run as long before it is judged.
    expect(
      nextTargets([w(2, 5)], [w(2, 5003, { live: "x" })], new Map()),
    ).toEqual({ targets: new Map([[2, 5003]]), judge: new Set([2]) });
    expect(
      nextTargets(
        [w(2, 5003)],
        [w(2, 5003, { live: "x" })],
        new Map([[2, 5003]]),
      ),
    ).toBeUndefined();
  });

  it("only 1.35 live at the cap while 2.0 finished: the case never settles on 1.35: discarded, not compared, and not a runaway", async () => {
    const def = {
      ...toScenario(spec),
      // Always live: 1.35 passes its 2 ms cap at the batch's 5 ms timer;
      // v2, whose settle() waited that batch out, has no timer left.
      settleDrain: { boundMs: 2, busy: () => "a test batch is live" },
    };
    const result = await runScenario(def, {
      candidates: [v2],
      divergences: [],
    });
    expect(result.neverSettles).toBe(true);
    expect(result.bothLive).toBe(false);
    expect(result.runaway).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.compared).toEqual([]);
    expect(result.report).toMatch(
      /never settles in scenario "fuzz": on the reference \(v1\) the shared wait at step 2 passed its cap: a test batch is live, \d+ ms after settle\(\) resolved \(cap 2 ms\), so the case is discarded/,
    );
  });

  it("past its cap on the workspace engine only, the wait still fails the case, naming why", async () => {
    // The order runScenario builds systems in: v1, v1 again, then local.
    const seen = new Map<unknown, number>();
    const def = {
      ...toScenario(spec),
      settleDrain: {
        boundMs: 2,
        busy: (_ctx: unknown, system: unknown) => {
          if (!seen.has(system)) {
            seen.set(system, seen.size);
          }

          return (seen.get(system) ?? 0) >= 2 ? "a test batch is live" : false;
        },
      },
    };
    const result = await runScenario(def, {
      candidates: [local],
      divergences: [],
    });
    expect(result.neverSettles).toBeFalsy();
    expect(result.ok).toBe(false);
    expect(result.report).toMatch(
      /local in scenario "fuzz": the shared wait at step 2 passed its cap: a test batch is live/,
    );
  });

  it("(e) the never-settles cap is max(1% of the seed's cases, 3)", () => {
    expect(MIN_NEVER_SETTLES).toBe(3);
    expect(
      [0, 205, 299, 300, 399, 400, 1010, 7000].map(maxNeverSettles),
    ).toEqual([3, 3, 3, 3, 3, 4, 10, 70]);
  });

  it("(e) both-live and 1.35-only discards share the never-settles count; a 2.0-only live case is compared and fails, never discarded", () => {
    const base = {
      name: "fuzz",
      nondeterministic: [],
      differences: [],
      unexplained: [],
      advisories: [],
      used: [],
      ended: [],
      hung: [],
      discarded: [],
      fired: 1,
      report: "",
      runaway: false,
      traces: { reference: [], candidate: [] },
    } as unknown as ScenarioResult;
    const tally = newFuzzTally();
    tallyCase(tally, {
      ...base,
      ok: false,
      compared: [],
      neverSettles: true,
      bothLive: true,
    });
    tallyCase(tally, {
      ...base,
      ok: false,
      compared: [],
      neverSettles: true,
      bothLive: false,
    });
    tallyCase(tally, {
      ...base,
      ok: false,
      compared: ["local", "v2"],
      twoOnlyLive: "2.0-only live: x",
    });
    tallyCase(tally, {
      ...base,
      ok: true,
      compared: ["local", "v2"],
      sharedRounds: 2,
      drained: 1,
      drainedDetached: 1,
    });
    expect(tally).toMatchObject({
      ran: 4,
      runaway: 0,
      neverSettles: 2,
      bothLive: 1,
      twoOnlyLive: 1,
      afterStop: 0,
      onV2: 2,
      sharedRerun: 1,
      drained: 1,
      drainedDetached: 1,
    });
  });

  it("never-settles cases count on their own: discarded under the cap, and one over it fails the run", async () => {
    const never = await runScenario(
      {
        ...toScenario(spec),
        settleDrain: { boundMs: 2, busy: () => "a test batch is live" },
      },
      { candidates: [v2], divergences: [] },
    );
    const compared = await runScenario(toScenario(spec), {
      candidates: [local, v2],
      divergences: [],
    });
    expect([never.neverSettles, compared.ok]).toEqual([true, true]);

    const runOf = (
      extra: number,
      base = FUZZ_FLOOR,
    ): { tally: FuzzTally; run: FuzzRun } => {
      const tally: FuzzTally = newFuzzTally();
      for (let i = 0; i < base; i++) {
        tallyCase(tally, compared);
      }
      for (let i = 0; i < extra; i++) {
        tallyCase(tally, never as ScenarioResult);
      }

      return {
        tally,
        run: {
          seed: 1,
          runs: tally.ran - tally.runaway - tally.neverSettles,
          runaway: tally.runaway,
          runawayAfterStop: tally.afterStop,
          neverSettles: tally.neverSettles,
          v2: tally.onV2,
        },
      };
    };

    // At the minimum cap (203 cases: 1% is 2, so 3): discarded, never a
    // runaway, nothing fails.
    const within = runOf(3);
    expect(maxNeverSettles(within.tally.ran)).toBe(3);
    expect(within.tally).toMatchObject({
      ran: FUZZ_FLOOR + 3,
      runaway: 0,
      afterStop: 0,
      neverSettles: 3,
      onV2: FUZZ_FLOOR,
    });
    expect(within.run.runs).toBe(FUZZ_FLOOR);
    expect(checkFuzzRuns([within.run], true)).toEqual([]);
    expect(describeNeverSettles([within.run])).toMatch(
      /seed 1: 3 of at most 3$/,
    );

    // One over the cap: the fuzz test's limit and the census fail it, and the
    // runaway limit (max(1% of cases, 2) = 2 here) is not what fires.
    const over = runOf(4);
    expect(over.tally).toMatchObject({ runaway: 0, neverSettles: 4 });
    expect(over.tally.neverSettles).toBeGreaterThan(
      maxNeverSettles(over.tally.ran),
    );
    expect(checkFuzzRuns([over.run], true)).toEqual([
      'conformance:diff: 4 fuzz cases whose reference never settles (seed 1); at most 3 allowed (max(1% of cases, 3); Jason, 2026-11-07: "Cap at 1% of cases, min 3 (Recommended)")',
    ]);

    // A deep seed: 1% of its cases. 1,000 compared and 10 discarded is 1,010
    // cases, a cap of 10: it passes; an 11th (1,011 cases, cap 10) fails.
    const deep = runOf(10, 1000);
    expect(deep.tally.neverSettles).toBe(maxNeverSettles(deep.tally.ran));
    expect(checkFuzzRuns([deep.run], true)).toEqual([]);
    expect(describeNeverSettles([deep.run])).toMatch(
      /seed 1: 10 of at most 10$/,
    );
    const deepOver = runOf(11, 1000);
    expect(checkFuzzRuns([deepOver.run], true)).toEqual([
      'conformance:diff: 11 fuzz cases whose reference never settles (seed 1); at most 10 allowed (max(1% of cases, 3); Jason, 2026-11-07: "Cap at 1% of cases, min 3 (Recommended)")',
    ]);
  });
});
