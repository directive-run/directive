/**
 * A signed divergence names exactly what it excuses (P3-F1;
 * diff/fingerprint.ts). Before, `covers` matched an entry's class only
 * (scenario, stream, kind, step, op, path prefix), so one entry excused any
 * number of same-kind records in its step, and a changed entry any value at
 * its path. Each case below fails if the fingerprint check is taken out of
 * `covers` or the count out of `explain`.
 */

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkExcuses } from "../../lib/census.js";
import { compareContract } from "../compare.js";
import { LIKE, generalizeValue, pathFits } from "../fingerprint.js";
import {
  type FuzzBatch,
  type FuzzBatchSource,
  type FuzzSpec,
  specTriggers,
} from "../fuzz/model.js";
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

  it("an attempt's error is one class, a rejection or a timeout; another error in the step is not", () => {
    // Quirk b's records carry the error the retracted attempt ended with.
    const quirkB = fuzz({
      kind: "error",
      op: "missing",
      bound: {
        match: [
          record(
            "error",
            "resolver",
            { $like: "resolver" },
            { $like: "attemptError" },
          ),
        ],
      },
    });
    const timedOut = [
      "error",
      "resolver",
      "a::r1",
      'Resolver "a::r1" timed out after 10ms',
    ];
    const rejected = ["error", "resolver", "r0", "a.r0 attempt 2"];
    expect(
      unexplained([timedOut, rejected], [], quirkB, FUZZ_SCENARIO),
    ).toEqual([]);
    for (const other of [
      ["error", "resolver", "a::r1", "a.d0 throws at 4"], // a derivation's throw
      ["error", "resolver", "a::r1", "a.x0 throws at 4"], // an effect's throw
      [
        "error",
        "resolver",
        "a::r1",
        "[Directive] settle() timed out after 5000ms.",
      ],
      ["error", "resolver", "a::r1", 'Resolver "load" timed out after 10ms'], // not a fuzz resolver
      ["error", "resolver", "a::r1", 'Resolver "a::r1" timed out after 10ms!'],
      ["error", "effect", "a::r1", 'Resolver "a::r1" timed out after 10ms'], // another source
    ] as Json[][]) {
      expect(unexplained([timedOut, other], [], quirkB, FUZZ_SCENARIO)).toEqual(
        [`missing ${JSON.stringify(record(...other))}`],
      );
    }
  });
});

describe("the committed fuzz entries excuse only their quirk's records", () => {
  const committed = JSON.parse(
    readFileSync(join(import.meta.dirname, "../divergences.json"), "utf8"),
  ) as Divergence[];
  const real = (id: string) => {
    const e = committed.find((x) => x.id === id);
    expect(e, id).toBeDefined();

    return e as Divergence;
  };
  /** The differences one step of `reference` against `candidate` leaves unexplained. */
  const left = (
    reference: TraceEntry[],
    candidate: TraceEntry[],
    id: string | Divergence,
    triggers: string[],
  ) => {
    const step = (records: TraceEntry[]): TraceEntry[] => [
      { k: "step", i: 0, step: "step 0" },
      ...records,
      { k: "async", i: 0 },
    ];

    return explain(
      FUZZ_SCENARIO,
      compareContract(step(reference), step(candidate), "v2"),
      [typeof id === "string" ? real(id) : id],
      triggers,
    ).unexplained.map((d) => `${d.op} ${d.kind} ${d.path ?? ""}`);
  };

  /** A one-argument console warning. */
  const warning = (text: string): TraceEntry => ({
    k: "console",
    level: "warn",
    args: [text],
  });
  /** The non-JSON warning both engines print for a Date written to `fact`. */
  const dateWarning = (fact: string) =>
    warning(
      `[Directive] Fact "${fact}" assigned a Date instance.\nFacts must be JSON-roundtrippable for reactivity to work correctly.\nDate mutations are not tracked.\nUse .getTime() for timestamps instead.\nSee: https://directive.run/docs/facts#json-rule`,
    );
  /** The source-gate warning (P3-F6), which both engines print. */
  const gateWarning = warning(
    '[Directive] Module "b" read undeclared property "f0" in a source gate. This module declares crossModuleDeps, so gate facts are namespaced: use "facts.self.f0" for its own fact, or add the module to crossModuleDeps.',
  );

  it("row o's warning is excused only in a case with a namespaced Date write, and only as missing on 2.0", () => {
    const warn = dateWarning("a::when");
    const id = "l3-quirk-o-fuzz-console-warn-missing";
    // Control: 1.35's second warning, missing on 2.0, where a Date is
    // written to a namespaced fact.
    expect(left([warn], [], id, ["namespacedDateWrite"])).toEqual([]);
    // Without a namespaced Date write, a warning 2.0 lacks is unexplained,
    // whatever other triggers the case has.
    expect(left([warn], [], id, [])).toEqual(["missing warn "]);
    expect(
      left([warn], [], id, ["resolverRejects", "settleStop", "restart"]),
    ).toEqual(["missing warn "]);
    // An extra warning on 2.0 is never row o.
    expect(left([], [warn], id, ["namespacedDateWrite"])).toEqual([
      "extra warn ",
    ]);
  });

  it("a console record left unpaired is the one the other engine did not print, so a $text entry for its neighbour does not excuse it", () => {
    // 1.35 prints [X, Y] and 2.0 prints [Y] (X: the source-gate warning;
    // Y: row o's Date warning by key). Paired by masked keys alone, 2.0's Y
    // took X's place and Y was reported missing, so row o's `$text` entry
    // for Y excused a missing X.
    const id = "l3-quirk-o-fuzz-console-warn-missing";
    const reference = [gateWarning, dateWarning("a::when")];
    const candidate = [dateWarning("a::when")];
    const step = (records: TraceEntry[]): TraceEntry[] => [
      { k: "step", i: 0, step: "step 0" },
      ...records,
      { k: "async", i: 0 },
    ];
    const diffs = compareContract(step(reference), step(candidate), "v2");
    expect(diffs.map((d) => [d.op, d.raw])).toEqual([
      ["missing", gateWarning as unknown as Json],
    ]);
    expect(left(reference, candidate, id, ["namespacedDateWrite"])).toEqual([
      "missing warn ",
    ]);
    // The same pair in the other order: still X.
    expect(
      left([dateWarning("a::when"), gateWarning], candidate, id, [
        "namespacedDateWrite",
      ]),
    ).toEqual(["missing warn "]);
  });

  it("row o's Date warning 2.0 lacks is excused where other warnings of the step pair around it", () => {
    const id = "l3-quirk-o-fuzz-console-warn-missing";
    // As at fuzz seed 24301: 1.35 warns by `a.when` and `a::when`, then the
    // source gate's warning; 2.0 by `a.when`, then the gate's.
    expect(
      left(
        [dateWarning("a.when"), dateWarning("a::when"), gateWarning],
        [dateWarning("a.when"), gateWarning],
        id,
        ["namespacedDateWrite"],
      ),
    ).toEqual([]);
    // Module b's Date fact, and both modules' at once.
    expect(
      left(
        [
          dateWarning("a.when"),
          dateWarning("a::when"),
          dateWarning("b.when"),
          dateWarning("b::when"),
        ],
        [dateWarning("a.when"), dateWarning("b.when")],
        id,
        ["namespacedDateWrite"],
      ),
    ).toEqual([]);
    // The warning by the module-qualified name is not row o's: 2.0 prints it.
    expect(
      left([dateWarning("a.when")], [], id, ["namespacedDateWrite"]),
    ).toEqual(["missing warn "]);
  });

  it("row o's entry does not excuse a missing source-gate warning, in a namespaced Date case", () => {
    const id = "l3-quirk-o-fuzz-console-warn-missing";
    expect(left([gateWarning], [], id, ["namespacedDateWrite"])).toEqual([
      "missing warn ",
    ]);
    // Beside row o's own missing warning, which is still excused.
    expect(
      left(
        [dateWarning("a.when"), dateWarning("a::when"), gateWarning],
        [dateWarning("a.when")],
        id,
        ["namespacedDateWrite"],
      ),
    ).toEqual(["missing warn "]);
  });

  it("quirk z's timer counts: 2.0 holding fewer timers is excused, more is not", () => {
    const timers = (at: string, pending: number): TraceEntry => ({
      k: "timers",
      at,
      pending,
    });
    for (const [id, at] of [
      ["l3-quirk-z-fuzz-timers-teardown-changed", "teardown"],
      ["l3-quirk-z-fuzz-timers-destroy-changed", "destroy"],
    ] as const) {
      // Control: 1.35 still holds the waiting settle()'s maxWait timer.
      expect(
        left([timers(at, 1)], [timers(at, 0)], id, ["settleStop"]),
      ).toEqual([]);
      expect(
        left([timers(at, 3)], [timers(at, 1)], id, ["settleStop"]),
      ).toEqual([]);
      // A 2.0 timer leak is not quirk z.
      for (const [from, to] of [
        [1, 9],
        [0, 3],
        [2, 2 + 1],
      ]) {
        expect(
          left([timers(at, from as number)], [timers(at, to as number)], id, [
            "settleStop",
          ]),
        ).toEqual([`changed ${at} pending`]);
      }
    }
  });

  it("quirk b's onError entry excuses the pairing shift of the extra attempt, not a derivation's change", () => {
    const onError = (error: Json): TraceEntry => ({
      k: "hook",
      hook: "onError",
      args: [error],
    });
    const thrown = (message: string, sourceId: string) => ({
      $error: {
        name: "DirectiveError",
        message,
        context: { $undefined: true },
        recoverable: true,
        source: "derivation",
        sourceId,
      },
    });
    const attempt = {
      $error: {
        name: "DirectiveError",
        message: "b.r0 attempt 1",
        context: {
          fromConstraint: "b::c0",
          id: "B0:{}",
          requirement: { type: "B0" },
        },
        recoverable: true,
        source: "resolver",
        sourceId: "b::r0",
      },
    };
    const id = "l3-quirk-b-fuzz-hook-onError-changed";
    const d0 = thrown("b.d0 throws at 3", "b::d0");
    // Control (deep seed 24301): 1.35's extra attempt error pairs with
    // 2.0's next error, a derivation's; the case ends there.
    expect(
      left([onError(attempt), onError(d0)], [onError(d0)], id, [
        "resolverRejects",
      ]),
    ).toEqual([]);
    // A derivation's error that changed is not quirk b, nor is 2.0's
    // attempt error where 1.35 had a derivation's.
    expect(
      left([onError(d0)], [onError(thrown("b.d0 throws at 4", "b::d0"))], id, [
        "resolverRejects",
      ]),
    ).toEqual(["changed onError args[0].$error.message"]);
    expect(
      left([onError(d0)], [onError(attempt)], id, ["resolverRejects"]),
    ).not.toEqual([]);
  });

  it("quirk b's onErrorRecovery entry does not excuse a derivation's or effect's error", () => {
    const recovery = (error: Json, strategy: string): TraceEntry => ({
      k: "hook",
      hook: "onErrorRecovery",
      args: [error, strategy],
    });
    const derivation = {
      $error: {
        name: "DirectiveError",
        message: "a.d0 throws at 4",
        context: { $undefined: true },
        recoverable: true,
        source: "derivation",
        sourceId: "d0",
      },
    };
    expect(
      left(
        [recovery(derivation, "skip")],
        [],
        "l2-quirk-b-hook-onErrorRecovery-missing",
        ["resolverRejects"],
      ),
    ).toEqual(["missing onErrorRecovery "]);
  });

  // P4-F2: quirk b's console entry was signed for one development warning,
  // the one a resolver's unhandled error prints, but its bound read only the
  // masked record ({ "$incidental": "string" }), so in every case where a
  // resolver can reject it excused any warning 2.0 lacked or added. Narrowed
  // to `$text: "resolverThrew"` it covered no fuzz case at all (quirk b's
  // other entries `end` the comparison before its shifted warning appears,
  // and on main it had been covering row o's warnings), so the census
  // rejected it as stale and it was removed. The `$text` mechanism stays, for
  // row o's entry to narrow with; these tests keep it covered through a
  // synthetic entry with the bound quirk b's entry had.
  const resolverThrewEntry: Divergence = {
    id: "synthetic-resolver-threw-console-warn",
    scenario: FUZZ_SCENARIO,
    stream: "console",
    kind: "warn",
    engine: "v2",
    when: ["resolverRejects"],
    bound: {
      match: [
        {
          k: "console",
          level: "warn",
          args: [{ $text: "resolverThrew" }],
        },
      ],
    },
    reason: "Synthetic: a self-test entry for the $text bound; not committed.",
    approvedBy: "test",
    date: "2026-11-05",
  };
  const warn = (text: string): TraceEntry => ({
    k: "console",
    level: "warn",
    args: [text],
  });
  const tail =
    "The default error strategy skips it silently. Configure errorBoundary.onResolverError (or errorBoundary.onError) to handle it; this warning shows once per source and only in development.";

  it("a $text: resolverThrew bound excuses the resolver-threw warning, missing or extra", () => {
    const id = resolverThrewEntry;
    for (const text of [
      `[Directive] resolver "r0" threw: a.r0 attempt 1. Requirement "A0" stays unmet. ${tail}`,
      `[Directive] resolver "a::r2" threw: a.r2 attempt 2. ${tail}`,
      `[Directive] resolver "b::r1" threw: Resolver "b::r1" timed out after 3ms. Requirement "B1" stays unmet. ${tail}`,
    ]) {
      expect(left([warn(text)], [], id, ["resolverRejects"])).toEqual([]);
      expect(left([], [warn(text)], id, ["resolverRejects"])).toEqual([]);
      // Its `when` still applies.
      expect(left([warn(text)], [], id, ["settleStop"])).toEqual([
        "missing warn ",
      ]);
    }
  });

  it("a $text: resolverThrew bound does not excuse another development warning, where a resolver can reject", () => {
    const id = resolverThrewEntry;
    for (const text of [
      // The cross-module gate warning (P3-F6): its own row, not quirk b.
      '[Directive] Module "b" read undeclared property "f0" in a source gate. This module declares crossModuleDeps, so gate facts are namespaced: use "facts.self.f0" for its own fact, or add the module to crossModuleDeps.',
      // Row o's non-JSON write warning.
      '[Directive] Fact "a::when" assigned a Date instance.',
      // Another source's unhandled error, in the same wording.
      `[Directive] derivation "d0" threw: a.d0 throws at 8. ${tail.replace("onResolverError", "onDerivationError")}`,
      // A resolver's warning of another kind.
      '[Directive] resolver "a::r0" failed 3 retries in a row; it will run again when its requirement changes.',
      // The resolver-threw wording around an error no fuzz resolver throws,
      // or with anything added.
      `[Directive] resolver "r0" threw: boom. ${tail}`,
      `[Directive] resolver "r0" threw: a.r0 attempt 1. ${tail} (again)`,
    ]) {
      expect(left([warn(text)], [], id, ["resolverRejects"])).toEqual([
        "missing warn ",
      ]);
      expect(left([], [warn(text)], id, ["resolverRejects"])).toEqual([
        "extra warn ",
      ]);
    }
    // The wording is read from the first argument only, where it is: a
    // second argument is another record shape.
    expect(
      left(
        [
          {
            k: "console",
            level: "warn",
            args: [
              `[Directive] resolver "r0" threw: a.r0 attempt 1. ${tail}`,
              "x",
            ],
          },
        ],
        [],
        id,
        ["resolverRejects"],
      ),
    ).toEqual(["missing warn "]);
  });

  it("no committed entry is left for quirk b's resolver-threw console warning", () => {
    // It covered 0 fuzz cases (seed 24301 PR count, deep seed 1), which the
    // census rejects as stale; a stale entry returning would fail it again.
    expect(committed.map((e) => e.id)).not.toContain("l2-quirk-b-console-warn");
  });

  it("row t's cancel 2.0 lacks is excused only in a case whose resolver's write retracts its own constraint", () => {
    // One module, f0 and f1; c0 needs f0 >= 1 and its resolver writes `value`
    // to fact `writes`.
    const caseOf = (writes: number, value: number): string[] =>
      specTriggers({
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
                writes,
                value,
                delay: 0,
                fails: 0,
                retry: 0,
                timeout: null,
              },
            ],
            effects: [],
            source: null,
          },
        ],
        boundary: null,
        history: false,
        trace: false,
        steps: [{ op: "settle" }],
      } as FuzzSpec);
    const records: [string, TraceEntry][] = [
      [
        "l3-cand-t-fuzz-hook-onResolverCancel-missing",
        {
          k: "hook",
          hook: "onResolverCancel",
          args: [
            "r0",
            { fromConstraint: "c0", id: "A0:{}", requirement: { type: "A0" } },
          ],
        },
      ],
      [
        "l3-cand-t-fuzz-hook-onRequirementCanceled-missing",
        {
          k: "hook",
          hook: "onRequirementCanceled",
          args: [
            { fromConstraint: "c0", id: "A0:{}", requirement: { type: "A0" } },
          ],
        },
      ],
      [
        "l3-cand-t-fuzz-observe-requirement-canceled-missing",
        {
          k: "observe",
          event: { type: "requirement.canceled", id: "A0:{}" },
        },
      ],
    ];
    // The write to f0 of 0 makes f0 >= 1 false: the run retracts itself.
    expect(caseOf(0, 0)).toContain("ownWriteRetracts");
    // A write to another fact, or of a value that keeps the condition true,
    // cannot retract its own constraint.
    expect(caseOf(1, 0)).not.toContain("ownWriteRetracts");
    expect(caseOf(0, 1)).not.toContain("ownWriteRetracts");
    for (const [id, cancel] of records) {
      const kind = cancel.k === "hook" ? cancel.hook : "requirement.canceled";
      expect(left([cancel], [], id, caseOf(0, 0)), id).toEqual([]);
      expect(left([cancel], [], id, caseOf(1, 0)), id).toEqual([
        `missing ${kind} `,
      ]);
      expect(left([cancel], [], id, caseOf(0, 1)), id).toEqual([
        `missing ${kind} `,
      ]);
    }
  });
});

describe("row o's hand entry pins the warning count the fuzz entry cannot", () => {
  const id = "l1-quirk-o-namespaced-date-console-warn-missing-step0";
  const name = "a Date written to a namespaced fact warns once";
  const committed = (
    JSON.parse(
      readFileSync(join(import.meta.dirname, "../divergences.json"), "utf8"),
    ) as Divergence[]
  ).filter((x) => x.scenario === name);
  const warn = (key: string): TraceEntry => ({
    k: "console",
    level: "warn",
    args: [`[Directive] Fact "${key}" assigned a Date instance.`],
  });
  /** 1.35's two warnings (step 0) against 2.0's `warnings` there. */
  const run = (...warnings: string[]) =>
    explain(
      name,
      compareContract(
        [
          { k: "step", i: 0, step: { op: "start" } },
          warn("a.when"),
          warn("a::when"),
          { k: "async", i: 0 },
        ],
        [
          { k: "step", i: 0, step: { op: "start" } },
          ...warnings.map(warn),
          { k: "async", i: 0 },
        ],
        "v2",
      ),
      committed,
    );

  it("is the scenario's only entry", () => {
    expect(committed.map((x) => x.id)).toEqual([id]);
  });

  it("control: 2.0 warning once is excused, by this entry", () => {
    const once = run("a.when");
    expect(once.unexplained).toEqual([]);
    expect(once.used).toEqual([id]);
  });

  it("2.0 warning zero times fails: the second missing warning is past the count", () => {
    expect(run().unexplained.map((d) => `${d.op} ${d.kind}`)).toEqual([
      "missing warn",
    ]);
  });

  it("2.0 warning twice covers nothing, so the census finds the entry stale", () => {
    const twice = run("a.when", "a::when");
    expect(twice.unexplained).toEqual([]);
    expect(twice.used).toEqual([]);
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

  it("checks $text: a known class, in a missing or extra console entry only", () => {
    const text = (more: Partial<Divergence>, name = "resolverThrew") =>
      census([
        entry({
          scenario: FUZZ_SCENARIO,
          step: undefined,
          stream: "console",
          kind: "warn",
          op: undefined,
          bound: {
            match: [{ k: "console", level: "warn", args: [{ $text: name }] }],
          },
          ...more,
        }),
      ]);
    expect(text({})).toBe("");
    expect(text({ op: "missing" })).toBe("");
    expect(text({}, "nope")).toMatch(/names an unknown \$text "nope"/);
    expect(text({ stream: "external", kind: "q" })).toMatch(/uses \$text/);
    expect(
      census([
        entry({
          scenario: FUZZ_SCENARIO,
          step: undefined,
          stream: "console",
          kind: "warn",
          op: "changed",
          path: "args",
          bound: {
            match: [
              {
                path: "args[0]",
                from: { $text: "resolverThrew" },
                to: { $text: "resolverThrew" },
              },
            ],
          },
        }),
      ]),
    ).toMatch(/uses \$text/);
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

  it("reads $lt only as a changed pattern's to: { $lt: from }", () => {
    const changed = {
      ...bounded,
      op: "changed",
      path: "data",
      bound: {
        match: [
          { path: "data[1]", from: { $like: "integer" }, to: { $lt: "from" } },
        ],
      },
    };
    expect(census([changed])).not.toMatch(/\$lt/);
    for (const bad of [
      {
        ...changed,
        op: "missing",
        bound: { match: [record("q", { $lt: "from" })] },
      },
      {
        ...changed,
        bound: {
          match: [
            {
              path: "data[1]",
              from: { $lt: "from" },
              to: { $like: "integer" },
            },
          ],
        },
      },
      {
        ...changed,
        bound: { match: [{ path: "data[1]", from: 1, to: { $lt: "to" } }] },
      },
    ]) {
      expect(census([bad])).toMatch(/uses \$lt other than/);
    }
  });

  it("accepts the committed divergences", () => {
    expect(checkExcuses(join(import.meta.dirname, "../.."), null)).toEqual([]);
  });
});

describe("the batch triggers and classes (L7) name only the batched resolver's features", () => {
  // One module with one fact and no constraint of its own, so every
  // resolver trigger below can come only from the batched resolver.
  const one: FuzzBatchSource = {
    fact: 0,
    atLeast: 1,
    items: 1,
    abortOn: false,
  };
  const base: FuzzBatch = {
    sources: [one],
    handler: "batch",
    failing: "all",
    windowMs: 1,
    maxSize: null,
    delay: 0,
    fails: 0,
    retry: 0,
    timeout: null,
    writes: 0,
    value: 0,
  };
  const triggersOf = (batch: FuzzBatch | null): string[] =>
    specTriggers({
      modules: [
        {
          facts: 1,
          date: false,
          derivations: [],
          events: [{ target: 0, add: false }],
          constraints: [],
          effects: [],
          source: null,
        },
      ],
      boundary: null,
      history: false,
      trace: false,
      steps: [{ op: "settle" }],
      batch,
    } as FuzzSpec).filter((t) => t.startsWith("batch"));
  const two = [
    { fact: 0, atLeast: 1, items: 1, abortOn: false },
    { fact: 0, atLeast: 1, items: 1, abortOn: true },
  ];

  it("a case with no batch has none of them; the plainest batch has only batched", () => {
    expect(triggersOf(null)).toEqual([]);
    expect(triggersOf(base)).toEqual(["batched"]);
  });

  it("each trigger is the spec feature its row needs, and no wider", () => {
    expect(triggersOf({ ...base, handler: "results" })).toEqual([
      "batched",
      "batchWithResults",
    ]);
    expect(triggersOf({ ...base, handler: "fallback" })).toEqual([
      "batched",
      "batchFallback",
    ]);
    // Quirk k needs two sources and an abortOn; each alone is its own trigger.
    expect(triggersOf({ ...base, sources: two })).toEqual([
      "batched",
      "batchMixed",
      "batchAbortOn",
      "batchSiblings",
    ]);
    expect(triggersOf({ ...base, sources: [{ ...one, items: 2 }] })).toEqual([
      "batched",
      "batchSiblings",
    ]);
    // A failing with-results call: every item (h, (ar)) or every second (i).
    expect(triggersOf({ ...base, handler: "results", fails: 1 })).toEqual([
      "batched",
      "batchWithResults",
      "batchFails",
      "batchAllFail",
    ]);
    // "some" fails every second item, so one item can never fail: not i.
    expect(
      triggersOf({ ...base, handler: "results", failing: "some", fails: 1 }),
    ).toEqual(["batched", "batchWithResults", "batchFails"]);
    expect(
      triggersOf({
        ...base,
        handler: "results",
        failing: "some",
        fails: 1,
        sources: [{ ...one, items: 2 }],
      }),
    ).toEqual([
      "batched",
      "batchWithResults",
      "batchSiblings",
      "batchFails",
      "batchSomeFail",
    ]);
    // A thrown batch that fails is not an all-failed with-results batch.
    expect(triggersOf({ ...base, fails: 1 })).toEqual([
      "batched",
      "batchFails",
    ]);
    expect(triggersOf({ ...base, retry: 1 })).toEqual([
      "batched",
      "batchRetry",
    ]);
    expect(triggersOf({ ...base, timeout: 3 })).toEqual([
      "batched",
      "batchTimeout",
    ]);
    // Row (av)'s early flush needs a maxSize to fill (1 or 2).
    expect(triggersOf({ ...base, maxSize: 2 })).toEqual([
      "batched",
      "batchMaxSize",
    ]);
    expect(triggersOf({ ...base, maxSize: 1 })).toEqual([
      "batched",
      "batchMaxSize",
    ]);
  });

  it("each batch class matches the batch's identifiers only, never a single resolver's", () => {
    const cases: [string, Json, Json][] = [
      ["batchResolver", "a::rb", "a::r0"],
      ["batchConstraint", "b1", "c1"],
      ["batchRequirementType", "AB", "A0"],
      ["batchRequirementId", 'AB:{"item":"0.1"}', "A0:{}"],
      ["batchItem", "1.0", "x"],
      ["batchTag", "a.rb", "a.r0"],
      ["batchAttemptError", "a.rb 0.1 attempt 2", "a.r0 attempt 2"],
    ];
    for (const [name, yes, no] of cases) {
      expect(LIKE[name]?.(yes), name).toBe(true);
      expect(LIKE[name]?.(no), name).toBe(false);
      expect(generalizeValue(yes), name).toEqual({ $like: name });
    }
    expect(LIKE.batchAttemptError?.("a.rb attempt 1")).toBe(true);
    expect(
      LIKE.batchAttemptError?.('Batch resolver "rb" timed out after 3ms'),
    ).toBe(true);
    // A record of the batched resolver generalizes to the batch classes,
    // its kind and structure kept literal.
    expect(
      generalizeValue({
        k: "hook",
        hook: "onResolverCancel",
        args: [
          "rb",
          {
            fromConstraint: "b0",
            id: 'AB:{"item":"0.0"}',
            requirement: { item: "0.0", type: "AB" },
          },
        ],
      }),
    ).toEqual({
      k: "hook",
      hook: "onResolverCancel",
      args: [
        { $like: "batchResolver" },
        {
          fromConstraint: { $like: "batchConstraint" },
          id: { $like: "batchRequirementId" },
          requirement: {
            item: { $like: "batchItem" },
            type: { $like: "batchRequirementType" },
          },
        },
      ],
    });
  });
});
