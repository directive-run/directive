/**
 * A run past its timer budget stalls nowhere (L8 gate: deep seed 24301,
 * case 508 of its up-to-L8 phase). Past the budget the harness clears every
 * timer and drops every callback (diff/scenario.ts `installBudget`), so at a
 * later `settle` step a batched call is left live with no timer: the harness
 * did that, not the engine. The shared wait used to report it as a stall, so
 * the case failed on the harness's own doing (in report mode it was written
 * out, traces and all: 536 MB for this case) instead of being judged as a
 * runaway: a hang, or discarded after an `ends` stop
 * (diff/self/runaway-after-stop.test.ts).
 *
 * In this case the batch handler ignores its abort, and 2.0 livelocks at
 * 35 ms: constraint c0 writes 4, c1 writes -1, the aborted handler still
 * writes 2, and c0 fires again. 1.35 settles after 14 timer callbacks. A
 * budget of 100 makes 2.0 a runaway in a fraction of a second.
 */

import { expect, it } from "vitest";
import { CASE_TRACE_LIMIT, caseFile } from "../../lib/fuzz.js";
import { type FuzzSpec, toScenario } from "../fuzz/model.js";
import { runScenario } from "../scenario.js";

const SPEC: FuzzSpec = {
  modules: [
    {
      facts: 1,
      date: false,
      derivations: [],
      events: [{ target: 0, add: false }],
      constraints: [
        {
          fact: 0,
          atLeast: 0,
          crossAtLeast: null,
          priority: 1,
          writes: 0,
          value: 4,
          delay: 0,
          fails: 1,
          retry: 1,
          timeout: null,
        },
        {
          fact: 0,
          atLeast: 4,
          crossAtLeast: null,
          priority: 2,
          writes: 0,
          value: -1,
          delay: 0,
          fails: 1,
          retry: 0,
          timeout: 3,
        },
      ],
      effects: [],
      source: null,
      snapshotEvents: [],
    },
    {
      facts: 1,
      date: true,
      derivations: [
        { facts: [0], derived: [], threshold: -1, throwsAt: 3 },
        { facts: [0], derived: [], threshold: -2, throwsAt: null },
        { facts: [0], derived: [1], threshold: 5, throwsAt: 3 },
      ],
      events: [{ target: 0, add: false }],
      constraints: [
        {
          fact: 0,
          atLeast: 3,
          crossAtLeast: 2,
          priority: 2,
          writes: 0,
          value: 5,
          delay: 5,
          fails: 0,
          retry: 1,
          timeout: 10,
        },
        {
          fact: 0,
          atLeast: 2,
          crossAtLeast: 0,
          priority: 3,
          writes: 0,
          value: 1,
          delay: 5,
          fails: 1,
          retry: 2,
          timeout: 10,
        },
        {
          fact: 0,
          atLeast: 1,
          crossAtLeast: 2,
          priority: 1,
          writes: 0,
          value: -1,
          delay: 20,
          fails: 2,
          retry: 0,
          timeout: 50,
        },
      ],
      effects: [],
      source: { gated: true },
      snapshotEvents: [],
    },
  ],
  boundary: "retry",
  history: true,
  trace: false,
  steps: [
    { op: "dispatch", module: 0, event: 303351579, value: 3 },
    { op: "advance", ms: 200 },
    {
      op: "batch",
      module: 0,
      writes: [
        [1121864902, 0],
        [992337705, 2],
        [977137274, 3],
      ],
    },
    { op: "dispatch", module: 1, event: 511253809, value: 2 },
    { op: "forward", steps: 3 },
    { op: "date", module: 0, ms: 2 },
    { op: "advance", ms: 1 },
    { op: "set", module: 1, fact: 1602551665, value: 5 },
    { op: "set", module: 1, fact: 1183473948, value: 5 },
    { op: "set", module: 0, fact: 1469025120, value: 3 },
  ],
  batch: {
    sources: [
      { fact: 1, atLeast: 2, items: 3, abortOn: false },
      { fact: 1, atLeast: 0, items: 1, abortOn: true },
    ],
    handler: "fallback",
    failing: "all",
    windowMs: 5,
    maxSize: 2,
    delay: 5,
    fails: 1,
    retry: 0,
    timeout: 3,
    writes: 0,
    value: 2,
  },
  maxSnapshots: 20,
  respectsAbort: false,
} as unknown as FuzzSpec;

it("a run past its budget is judged as a runaway, with no stall reported after it", async () => {
  const result = await runScenario({ ...toScenario(SPEC), budget: 100 });
  // The reference settles: only 2.0 runs away.
  expect(result.runaway).toBe(false);
  expect(result.report).not.toMatch(/stalled/);
  expect([...result.hung, ...result.discarded]).toEqual(["v2"]);
});

it("a case file keeps the head of each trace, and the full length of each it cut", () => {
  const long = Array.from({ length: CASE_TRACE_LIMIT + 5 }, (_, i) => ({ i }));
  const short = [{ i: 0 }];
  const file = caseFile(
    { seed: 1 },
    {
      report: "r",
      traces: { reference: short, candidate: [] },
      engineTraces: { v2: long },
      unexplained: [],
    },
  ) as {
    traces: { reference: unknown[]; candidate: unknown[] };
    truncated?: unknown;
  };
  expect(file.traces.reference).toEqual(short);
  expect(file.traces.candidate).toHaveLength(CASE_TRACE_LIMIT);
  expect(file.traces.candidate[0]).toEqual({ i: 0 });
  expect(file.truncated).toEqual({ candidate: CASE_TRACE_LIMIT + 5 });
});
