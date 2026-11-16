/**
 * The L9 gate's triggers, `$like` class and step ops, each with the spec
 * that has it and the nearest spec that does not:
 *
 * - `traceRing` (row (bi)): the trace on with a ring of 1 or 3;
 * - `disableRetracts` (row t's error shape under `disable`, deep case
 *   1:all#4038): a resolver with a timeout that can reject, under "disable";
 * - `batchWriteRetracts` (row t's batch path, deep case 24301:all#3397): the
 *   batched handler writes below the bar of a source that reads that fact;
 * - `traceRunWithResolvers`: a settled run that started a resolver;
 * - `stepOps` reads a fuzz history step's op from its run label, so
 *   `during` can name it.
 */

import { describe, expect, it } from "vitest";
import { FUZZ_STEP_OPS, FUZZ_TRIGGERS } from "../../lib/fuzz.js";
import { LIKE } from "../fingerprint.js";
import { type FuzzSpec, specTriggers } from "../fuzz/model.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import { stepOps } from "../scenario.js";

const constraint = (more: Record<string, unknown> = {}) => ({
  fact: 0,
  atLeast: 0,
  crossAtLeast: null,
  priority: 0,
  writes: 1,
  value: 1,
  delay: 0,
  fails: 0,
  retry: 0,
  timeout: null,
  ...more,
});

const spec = (more: Record<string, unknown> = {}, c = constraint()) =>
  ({
    modules: [
      {
        facts: 2,
        date: false,
        derivations: [],
        events: [],
        constraints: [c],
        effects: [],
        source: null,
      },
    ],
    boundary: null,
    history: false,
    trace: false,
    steps: [],
    batch: null,
    ...more,
  }) as unknown as FuzzSpec;

const has = (name: string, s: FuzzSpec) =>
  specTriggers(s).includes(name as never);

const batch = (more: Record<string, unknown> = {}) => ({
  sources: [{ fact: 2, atLeast: 0, items: 3, abortOn: false }],
  handler: "batch",
  failing: "some",
  windowMs: 1,
  maxSize: 2,
  delay: 0,
  fails: 0,
  retry: 0,
  timeout: null,
  writes: 0,
  value: -1,
  ...more,
});

describe("the L9 gate's triggers", () => {
  it("are known trigger names", () => {
    for (const name of [
      "traceRing",
      "disableRetracts",
      "batchWriteRetracts",
      "batchClobbered",
    ]) {
      expect(FUZZ_TRIGGERS).toContain(name);
    }
  });

  it("traceRing: the trace on with maxRuns 1 or 3, not 100, not unset, not off", () => {
    expect(has("traceRing", spec({ trace: true, maxRuns: 1 }))).toBe(true);
    expect(has("traceRing", spec({ trace: true, maxRuns: 3 }))).toBe(true);
    expect(has("traceRing", spec({ trace: true, maxRuns: 100 }))).toBe(false);
    expect(has("traceRing", spec({ trace: true }))).toBe(false);
    expect(has("traceRing", spec({ trace: false, maxRuns: 1 }))).toBe(false);
  });

  it("disableRetracts: under disable, a resolver with a timeout that can reject", () => {
    const failing = constraint({ fails: 2, timeout: 3 });
    expect(has("disableRetracts", spec({ boundary: "disable" }, failing))).toBe(
      true,
    );
    // A timeout no longer than the wait rejects too.
    expect(
      has(
        "disableRetracts",
        spec({ boundary: "disable" }, constraint({ delay: 5, timeout: 5 })),
      ),
    ).toBe(true);
    // No timeout: the run leaves flight before the pass that retracts it.
    expect(
      has(
        "disableRetracts",
        spec({ boundary: "disable" }, constraint({ fails: 2 })),
      ),
    ).toBe(false);
    // A timeout that never fires and a resolver that never throws.
    expect(
      has(
        "disableRetracts",
        spec({ boundary: "disable" }, constraint({ delay: 1, timeout: 5 })),
      ),
    ).toBe(false);
    // Another strategy.
    expect(has("disableRetracts", spec({ boundary: "skip" }, failing))).toBe(
      false,
    );
  });

  it("batchWriteRetracts: the batch writes below the bar of a source that reads that fact", () => {
    // fact 2 of a two-fact module is f0, the fact the handler writes.
    expect(has("batchWriteRetracts", spec({ batch: batch() }))).toBe(true);
    // At the bar, the write keeps the lowest item.
    expect(
      has("batchWriteRetracts", spec({ batch: batch({ value: 0 }) })),
    ).toBe(false);
    // To the other fact.
    expect(
      has("batchWriteRetracts", spec({ batch: batch({ writes: 1 }) })),
    ).toBe(false);
    expect(has("batchWriteRetracts", spec())).toBe(false);
  });
});

describe("batchClobbered (row (ap))", () => {
  const bound = (more: Record<string, unknown> = {}) =>
    batch({
      sources: [{ fact: 0, atLeast: 0, items: 1, abortOn: true }],
      ...more,
    });

  it("an abortOn source, and a single resolver of module a writes the fact the batch writes", () => {
    expect(
      has(
        "batchClobbered",
        spec({ batch: bound() }, constraint({ writes: 2 })),
      ),
    ).toBe(true);
  });

  it("not without abortOn, and not when no single resolver writes that fact", () => {
    expect(
      has(
        "batchClobbered",
        spec(
          {
            batch: bound({
              sources: [{ fact: 0, atLeast: 0, items: 1, abortOn: false }],
            }),
          },
          constraint({ writes: 2 }),
        ),
      ),
    ).toBe(false);
    expect(
      has(
        "batchClobbered",
        spec({ batch: bound() }, constraint({ writes: 1 })),
      ),
    ).toBe(false);
    expect(has("batchClobbered", spec())).toBe(false);
  });
});

describe("traceRunWithResolvers", () => {
  const like = LIKE.traceRunWithResolvers as (v: Json | undefined) => boolean;
  const run = (more: Record<string, Json> = {}): Json => ({
    causalChain: "f0 changed → c0 constraint hit",
    constraintsHit: [],
    derivationsRecomputed: [],
    duration: { $time: "finite, at or above 0" },
    effectErrors: [],
    effectsRun: [],
    factChanges: [],
    id: { $incidental: "number" },
    requirementsAdded: [],
    requirementsRemoved: [],
    resolversCompleted: [],
    resolversErrored: [],
    resolversStarted: [
      { meta: null, requirementId: "A0:{}", resolver: "a::r0" },
    ],
    status: "settled",
    timestamp: { $time: "finite, at or above 0" },
    ...more,
  });

  it("a settled run that started a resolver", () => {
    expect(like(run())).toBe(true);
    expect(like(run({ anomalies: ["1 resolver(s) errored"] }))).toBe(true);
  });

  it("not a run with no resolver, a pending run, an extra key or an empty anomalies list", () => {
    expect(like(run({ resolversStarted: [] }))).toBe(false);
    expect(like(run({ status: "pending" }))).toBe(false);
    expect(like(run({ extra: 1 }))).toBe(false);
    expect(like(run({ anomalies: [] }))).toBe(false);
    expect(like(run({ factChanges: null }))).toBe(false);
    expect(like(null)).toBe(false);
  });
});

describe("stepOps reads a history step's op", () => {
  const trace: TraceEntry[] = [
    { k: "step", i: 0, step: { op: "run", label: '{"op":"back","steps":1}' } },
    {
      k: "step",
      i: 1,
      step: { op: "run", label: "listen for history changes" },
    },
    { k: "step", i: 2, step: { op: "run", label: '{"op":"unknown"}' } },
    { k: "step", i: 3, step: { op: "settle" } },
  ] as unknown as TraceEntry[];

  it("a history op from its JSON label; any other run step stays run", () => {
    expect([...stepOps(trace)]).toEqual([
      [0, "back"],
      [1, "run"],
      [2, "run"],
      [3, "settle"],
    ]);
  });

  it("the history ops are step ops an entry's during may name", () => {
    for (const op of ["back", "forward", "goTo", "replay", "roundtrip"]) {
      expect(FUZZ_STEP_OPS).toContain(op);
    }
  });
});
