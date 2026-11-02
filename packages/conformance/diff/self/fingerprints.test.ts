/**
 * A signed divergence names exactly what it excuses (P3-F1;
 * diff/fingerprint.ts). Before, `covers` matched an entry's class only
 * (scenario, stream, kind, step, op, path prefix), so one entry excused any
 * number of same-kind records in its step, and a changed entry any value at
 * its path. Each case below fails if the fingerprint check is taken out of
 * `covers` or the count out of `explain`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkExcuses } from "../../lib/census.js";
import { compareContract } from "../compare.js";
import { pathFits } from "../fingerprint.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import { type Divergence, FUZZ_SCENARIO, explain } from "../scenario.js";

const HAND = "a hand one";

/** One step of `external` records. */
function trace(...records: Json[][]): TraceEntry[] {
  return [
    { k: "step", i: 0, step: "step 0" },
    ...records.map((data): TraceEntry => ({ k: "external", data })),
    { k: "async", i: 0 },
  ];
}

const entry = (more: Partial<Divergence>): Divergence => ({
  id: "q",
  scenario: HAND,
  stream: "external",
  kind: "q",
  engine: "v2",
  step: 0,
  op: "extra",
  reason: "an approved quirk, for this self-test",
  approvedBy: "Jason",
  date: "2026-11-02",
  ...more,
});

/** The kinds of the differences `div` leaves unexplained. */
const unexplained = (
  reference: Json[][],
  candidate: Json[][],
  div: Divergence,
  name = HAND,
  triggers?: string[],
) =>
  explain(
    name,
    compareContract(trace(...reference), trace(...candidate), "v2"),
    [div],
    triggers,
  ).unexplained.map(
    (d) => `${d.op} ${JSON.stringify(d.candidate ?? d.reference)}`,
  );

const record = (...data: Json[]) => ({ k: "external", data });
const excused = entry({ excuses: [{ count: 1, record: record("q", 1) }] });

describe("a hand entry excuses only the records it names", () => {
  it("control: the named record is excused", () => {
    expect(unexplained([], [["q", 1]], excused)).toEqual([]);
  });

  it("an unrelated same-kind record in the covered step fails", () => {
    expect(unexplained([], [["q", 2]], excused)).toEqual([
      'extra {"k":"external","data":["q",2]}',
    ]);
    expect(
      unexplained(
        [],
        [
          ["q", 1],
          ["q", 2],
        ],
        excused,
      ),
    ).toEqual(['extra {"k":"external","data":["q",2]}']);
  });

  it("a second copy fails, unless the count says two", () => {
    expect(
      unexplained(
        [],
        [
          ["q", 1],
          ["q", 1],
        ],
        excused,
      ),
    ).toEqual(['extra {"k":"external","data":["q",1]}']);
    const two = entry({ excuses: [{ count: 2, record: record("q", 1) }] });
    expect(
      unexplained(
        [],
        [
          ["q", 1],
          ["q", 1],
        ],
        two,
      ),
    ).toEqual([]);
    expect(
      unexplained(
        [],
        [
          ["q", 1],
          ["q", 1],
          ["q", 1],
        ],
        two,
      ),
    ).toHaveLength(1);
  });

  it("a missing entry names the 1.35 record", () => {
    const missing = entry({
      op: "missing",
      excuses: [{ count: 1, record: record("q", 1) }],
    });
    expect(unexplained([["q", 1]], [], missing)).toEqual([]);
    expect(unexplained([["q", 3]], [], missing)).toHaveLength(1);
  });

  it("a changed entry names both values: a different value under its path fails", () => {
    const changed = entry({
      op: "changed",
      path: "data",
      excuses: [{ count: 1, path: "data[1]", from: 0, to: 1 }],
    });
    expect(unexplained([["q", 0]], [["q", 1]], changed)).toEqual([]);
    // Another 2.0 value, another 1.35 value, another field under the path.
    expect(unexplained([["q", 0]], [["q", 2]], changed)).toHaveLength(1);
    expect(unexplained([["q", 5]], [["q", 1]], changed)).toHaveLength(1);
    expect(unexplained([["q", 0, 7]], [["q", 1, 8]], changed)).toHaveLength(1);
    // A side with no value is named by leaving it out.
    const added = entry({
      op: "changed",
      excuses: [{ count: 1, path: "data[2]", to: 9 }],
    });
    expect(unexplained([["q", 0]], [["q", 0, 9]], added)).toEqual([]);
    expect(unexplained([["q", 0, 8]], [["q", 0, 9]], added)).toHaveLength(1);
  });

  it("without excuses an entry is the old wildcard, which the census rejects", () => {
    const wildcard = entry({});
    expect(
      unexplained(
        [],
        [
          ["q", 1],
          ["q", 2],
          ["q", 3],
        ],
        wildcard,
      ),
    ).toEqual([]);
    expect(census([wildcard])).toMatch(/q needs excuses/);
  });
});

describe("a fuzz entry excuses only payloads its bound admits", () => {
  const fuzz = (more: Partial<Divergence>): Divergence =>
    entry({ scenario: FUZZ_SCENARIO, step: undefined, ...more });
  const timeout = fuzz({
    kind: "timeout",
    bound: {
      match: [
        record("timeout", { $like: "resolverTag" }, { $like: "integer" }),
      ],
    },
  });

  it("control: a record of the pattern, on any resolver and attempt, is excused", () => {
    expect(
      unexplained(
        [],
        [
          ["timeout", "a.r0", 1],
          ["timeout", "b.r2", 3],
        ],
        timeout,
        FUZZ_SCENARIO,
      ),
    ).toEqual([]);
  });

  it("an unrelated key, value or shape of the same kind fails", () => {
    for (const data of [
      ["timeout", "a.x0", 1], // an effect's tag, not a resolver's
      ["timeout", "a.r0", "1"], // not an attempt count
      ["timeout", "a.r0", 1, true], // an extra element
    ] as Json[][]) {
      expect(unexplained([], [data], timeout, FUZZ_SCENARIO)).toHaveLength(1);
    }
    expect(
      unexplained(
        [],
        [["timeout", "a.r0", 1]],
        fuzz({
          kind: "timeout",
          bound: {
            match: [
              {
                k: "external",
                data: [
                  "timeout",
                  { $like: "resolverTag" },
                  { $like: "integer" },
                ],
                extra: 1,
              },
            ],
          },
        }),
        FUZZ_SCENARIO,
      ),
    ).toHaveLength(1);
  });

  it("a changed bound names the field and both sides' classes", () => {
    const attempt = fuzz({
      kind: "timeout",
      op: "changed",
      path: "data",
      bound: {
        match: [
          {
            path: "data[2]",
            from: { $like: "integer" },
            to: { $like: "integer" },
          },
        ],
      },
    });
    expect(
      unexplained(
        [["timeout", "a.r0", 1]],
        [["timeout", "a.r0", 2]],
        attempt,
        FUZZ_SCENARIO,
      ),
    ).toEqual([]);
    // Another field under the entry's path (the tag) is not excused.
    expect(
      unexplained(
        [["timeout", "a.r0", 1]],
        [["timeout", "a.r1", 1]],
        attempt,
        FUZZ_SCENARIO,
      ),
    ).toHaveLength(1);
    expect(pathFits("args[0].inflight[*]", "args[0].inflight[12]")).toBe(true);
    expect(pathFits("args[0].inflight[*]", "args[1].inflight[0]")).toBe(false);
    expect(pathFits("args[0].inflight[*]", "args[0].inflight[0].id")).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// The census

const root = mkdtempSync(join(tmpdir(), "conformance-fingerprints-"));
mkdirSync(join(root, "diff"), { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));
function census(entries: unknown[], uses: Map<string, number> | null = null) {
  writeFileSync(join(root, "diff/divergences.json"), JSON.stringify(entries));

  return checkExcuses(root, uses).join("\n");
}

describe("the census requires every entry to name what it excuses", () => {
  const bounded = entry({
    scenario: FUZZ_SCENARIO,
    step: undefined,
    bound: { match: [record("q", { $like: "integer" })] },
  });

  it("control: a named hand entry and a bounded fuzz entry pass", () => {
    expect(census([excused, { ...bounded, id: "f" }])).toBe("");
    expect(census([excused], new Map([["q\t0", 1]]))).toBe("");
  });

  it("rejects a hand entry without excuses, with a bound, or without an op", () => {
    expect(census([entry({})])).toMatch(/q needs excuses/);
    expect(census([{ ...excused, bound: bounded.bound }])).toMatch(
      /q has a bound/,
    );
    expect(census([{ ...excused, op: undefined }])).toMatch(/q needs an op/);
  });

  it("rejects malformed excuses", () => {
    const bad = (x: unknown, more: Partial<Divergence> = {}) =>
      census([entry({ excuses: [x] as never, ...more })]);
    expect(bad({ count: 0, record: record("q", 1) })).toMatch(
      /positive integer count/,
    );
    expect(bad({ count: 1 })).toMatch(/must have count and record/);
    expect(bad({ count: 1, record: 1, path: "data" })).toMatch(
      /must have count and record/,
    );
    expect(bad({ count: 1, path: "data[1]" }, { op: "changed" })).toMatch(
      /from and\/or to/,
    );
    expect(
      bad({ count: 1, path: "x", to: 1 }, { op: "changed", path: "data" }),
    ).toMatch(/outside the entry's path/);
    expect(
      census([
        entry({
          excuses: [
            { count: 1, record: record("q", 1) },
            { count: 1, record: record("q", 1) },
          ],
        }),
      ]),
    ).toMatch(/names the same record as an earlier excuse/);
  });

  it("finds an excuse stale when it excused fewer records than its count", () => {
    const two = entry({ excuses: [{ count: 2, record: record("q", 1) }] });
    expect(census([two], new Map([["q\t0", 1]]))).toMatch(
      /excuse 0 excused 1 record\(s\) in this run, not its count 2/,
    );
  });

  it("rejects a fuzz entry without a bound, with excuses, or with an unknown class", () => {
    expect(census([{ ...bounded, bound: undefined }])).toMatch(
      /q needs a bound/,
    );
    expect(census([{ ...bounded, excuses: excused.excuses }])).toMatch(
      /q has excuses/,
    );
    expect(
      census([
        { ...bounded, bound: { match: [record("q", { $like: "anything" })] } },
      ]),
    ).toMatch(/unknown \$like "anything"/);
    expect(
      census([
        {
          ...bounded,
          op: "changed",
          bound: { match: [{ path: "data[1]", to: 1 }] },
        },
      ]),
    ).toMatch(/must be \{ path, from, to \}/);
  });

  it("accepts the committed divergences", () => {
    expect(checkExcuses(join(import.meta.dirname, "../.."), null)).toEqual([]);
  });
});
