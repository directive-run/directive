/**
 * The fuzz model obeys its abort only where the engines' aborts agree.
 * Jason, 2026-11-14: "Obey only where aborts agree (Recommended)": "The
 * random tests draw obeying resolvers only in cases with no timeout and no
 * batch. Those cases get the ignoring resolvers that today's signed
 * exceptions cover. One handwritten test pins row n's effect on an obeying
 * resolver."
 *
 * Why: 2.0 aborts where 1.35 does not (row n: a timed-out attempt's signal;
 * quirk g: a batch's), so an obeying handler stops on 2.0 and writes late on
 * 1.35, and the late-write entries (which list `ignoresAbort`) cannot cover
 * what follows. Each test here pins one part of the rule: a timeout case and
 * a batched case never draw `respectsAbort: true`, a case with neither still
 * can, and setting it false leaves the random stream and every other field
 * of every case as drawn before the rule.
 */

import { createHash } from "node:crypto";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type FuzzBatch,
  type FuzzSpec,
  abortsAgree,
  specArbitrary,
  specTriggers,
} from "../fuzz/model.js";

const sample = (ceiling?: string, numRuns = 2000): FuzzSpec[] =>
  fc.sample(specArbitrary(ceiling === undefined ? {} : { ceiling }), {
    seed: 4242,
    numRuns,
  });

const histories = () => sample("L8").filter((s) => s.history);

/** A case with one resolver: `timeout` on its constraint, `batch` as given. */
const spec = (
  timeout: number | null,
  batch: FuzzBatch | null = null,
): FuzzSpec => ({
  modules: [
    {
      facts: 2,
      date: false,
      derivations: [],
      events: [{ target: 0, add: false }],
      constraints: [
        {
          fact: 0,
          atLeast: 1,
          crossAtLeast: null,
          priority: 0,
          writes: 1,
          value: 5,
          delay: 20,
          fails: 0,
          retry: 0,
          timeout,
        },
      ],
      effects: [],
      source: null,
    },
  ],
  boundary: null,
  history: true,
  trace: false,
  steps: [{ op: "settle" }],
  maxSnapshots: 20,
  respectsAbort: true,
  batch,
});

const batchOf = (timeout: number | null): FuzzBatch => ({
  sources: [{ fact: 0, atLeast: 1, items: 1, abortOn: false }],
  handler: "batch",
  failing: "all",
  windowMs: 1,
  maxSize: null,
  delay: 0,
  fails: 0,
  retry: 0,
  timeout,
  writes: 0,
  value: 0,
});

/** A digest of a sample with `respectsAbort` left out of every case. */
const streamDigest = (specs: FuzzSpec[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(specs.map((s) => ({ ...s, respectsAbort: undefined }))),
    )
    .digest("hex")
    .slice(0, 16);

describe("abortsAgree", () => {
  it("is false for a resolver with a timeout, and for the batched resolver, with or without one", () => {
    expect(abortsAgree(spec(10))).toBe(false);
    expect(abortsAgree(spec(null, batchOf(null)))).toBe(false);
    expect(abortsAgree(spec(null, batchOf(10)))).toBe(false);
    expect(abortsAgree(spec(10, batchOf(null)))).toBe(false);
  });

  it("is true for a case with neither", () => {
    expect(abortsAgree(spec(null))).toBe(true);
    expect(abortsAgree({ ...spec(null), batch: undefined })).toBe(true);
  });

  it("reads the same facts as the `timeout` and `batched` triggers", () => {
    for (const s of sample(undefined, 600)) {
      const t = specTriggers(s);
      expect(abortsAgree(s)).toBe(
        !t.includes("timeout") && !t.includes("batched"),
      );
    }
  });
});

describe("the drawn respectsAbort (the L8 RFC's rule 9)", () => {
  it("is never true in a case with a timeout or a batch, so every such case ignores its abort", () => {
    const covered = histories().filter((s) => {
      const t = specTriggers(s);

      return t.includes("timeout") || t.includes("batched");
    });
    // Not vacuous: the draw reaches both kinds of case.
    expect(
      covered.filter((s) => specTriggers(s).includes("timeout")).length,
    ).toBeGreaterThan(100);
    expect(
      covered.filter((s) => specTriggers(s).includes("batchTimeout")).length,
    ).toBeGreaterThan(20);
    expect(
      covered.filter((s) => specTriggers(s).includes("batched")).length,
    ).toBeGreaterThan(100);
    for (const s of covered) {
      expect(s.respectsAbort).toBe(false);
      expect(specTriggers(s)).toContain("ignoresAbort");
    }
  });

  it("is still drawn true in a case with neither, three times in four", () => {
    const plain = histories().filter((s) => abortsAgree(s));
    const respecting = plain.filter((s) => s.respectsAbort === true).length;
    const ignoring = plain.filter((s) => s.respectsAbort === false).length;
    expect(respecting + ignoring).toBe(plain.length);
    expect(plain.length).toBeGreaterThan(100);
    expect(ignoring).toBeGreaterThan(0);
    expect(respecting).toBeGreaterThan(ignoring * 2);
    for (const s of plain.filter((x) => x.respectsAbort === true)) {
      expect(specTriggers(s)).not.toContain("ignoresAbort");
    }
  });

  it("leaves the random stream, and every other field of every case, as drawn before the rule", () => {
    // Digests of the samples with `respectsAbort` left out, taken from the
    // generator as it was before the rule: the rule sets the field false
    // after drawing it, so these cannot move. A change to some other draw
    // moves them on purpose; update them with that change, never for this.
    expect(streamDigest(sample("L8", 600))).toBe("bc4d238dd8d6d869");
    expect(streamDigest(sample(undefined, 600))).toBe("897d2f9752054a7c");
  });

  it("never draws it below L8 or without history, as before", () => {
    expect(
      sample("L7", 600).filter((s) => s.respectsAbort !== undefined),
    ).toEqual([]);
    expect(
      sample("L8", 600).filter(
        (s) => !s.history && s.respectsAbort !== undefined,
      ),
    ).toEqual([]);
  });
});
