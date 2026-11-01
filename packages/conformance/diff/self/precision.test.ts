/**
 * Fuzz divergence entries are precise enough to cover one approved quirk in
 * every case that shows it, and nothing else. Each test proves one edge:
 *
 * - kinded externals: the fuzz model records a resolver's start and write
 *   under their own kinds ("start", "wrote"), so the comparison never pairs
 *   a start with a write (as it did when both had the resolver's tag);
 * - `when`: an entry applies only to the fuzz cases whose triggers
 *   (diff/fuzz/model.ts `specTriggers`) include every one it lists, never to
 *   a hand scenario, and the census rejects an unknown trigger, `when` on a
 *   hand-scenario entry and an `ends` entry without `when`;
 * - `group`: the census finds an entry of a group stale only when no entry
 *   of the group was used, and rejects a group whose entries differ in
 *   approvedBy or when.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkDivergences } from "../../lib/census.js";
import { compareContract } from "../compare.js";
import { type EngineHandle, engines } from "../engines.js";
import {
  type FuzzConstraint,
  type FuzzSpec,
  specTriggers,
  toScenario,
} from "../fuzz/model.js";
import type { Json } from "../normalize.js";
import type { TraceEntry } from "../record.js";
import {
  type BuildContext,
  type Divergence,
  FUZZ_SCENARIO,
  type ScenarioDef,
  explain,
  runScenario,
} from "../scenario.js";

/** One step of `external` records. */
function trace(...records: Json[][]): TraceEntry[] {
  return [
    { k: "step", i: 0, step: "step 0" },
    ...records.map((data): TraceEntry => ({ k: "external", data })),
    { k: "async", i: 0 },
  ];
}

const entry = (
  id: string,
  kind: string,
  more: Partial<Divergence> = {},
): Divergence => ({
  id,
  scenario: FUZZ_SCENARIO,
  stream: "external",
  kind,
  engine: "v2",
  reason: "an approved quirk, for this self-test",
  approvedBy: "Jason",
  date: "2026-11-02",
  ...more,
});

const constraint = (more: Partial<FuzzConstraint> = {}): FuzzConstraint => ({
  fact: 0,
  atLeast: 0,
  crossAtLeast: null,
  priority: 0,
  writes: 0,
  // Writes -1 so its constraint (f0 >= 0) retracts: the case settles.
  value: -1,
  delay: 0,
  fails: 0,
  retry: 0,
  timeout: null,
  ...more,
});

const spec = (more: Partial<FuzzSpec> = {}, c = [constraint()]): FuzzSpec => ({
  modules: [
    {
      facts: 1,
      date: false,
      derivations: [],
      events: [{ target: 0, add: false }],
      constraints: c,
      effects: [],
      source: null,
    },
  ],
  boundary: null,
  history: false,
  trace: false,
  steps: [{ op: "settle" }],
  ...more,
});

// ---------------------------------------------------------------------------

describe("the fuzz records starts and writes under their own kinds", () => {
  it("a resolver's start and write are [kind, tag, attempt] on every engine", async () => {
    const result = await runScenario(toScenario(spec()));
    const records = (t: TraceEntry[]) =>
      t.flatMap((e) =>
        e.k === "external" && Array.isArray(e.data) && e.data[1] === "a.r0"
          ? [e.data]
          : [],
      );

    expect(result.report).toBe("");
    expect(records(result.traces.reference)).toEqual([
      ["start", "a.r0", 1],
      ["wrote", "a.r0", 1],
    ]);
    expect(records(result.traces.candidate)).toEqual(
      records(result.traces.reference),
    );
  });

  it("control: under the resolver's tag, a missing start pairs with the write", () => {
    const diffs = compareContract(
      trace(["a.r0", "start", 1], ["a.r0", "wrote", 1]),
      trace(["a.r0", "wrote", 1]),
      "v2",
    );

    expect(diffs.map((d) => `${d.kind} ${d.op} ${d.path ?? ""}`)).toContain(
      "a.r0 changed data[1]",
    );
  });

  it("kinded, a missing start is a missing start: it never pairs with a write", () => {
    const diffs = compareContract(
      trace(["start", "a.r0", 1], ["wrote", "a.r0", 1]),
      trace(["wrote", "a.r0", 1]),
      "v2",
    );

    expect(diffs.map((d) => `${d.kind} ${d.op}`)).toEqual(["start missing"]);
  });
});

// ---------------------------------------------------------------------------

describe("a fuzz case's triggers come from its spec, exactly", () => {
  it("a plain case with a resolver has only settleStop", () => {
    expect(specTriggers(spec())).toEqual(["settleStop"]);
    expect(specTriggers(spec({ boundary: "skip" }))).toEqual(["settleStop"]);
  });

  it("resolverRetry and resolverRetryLater need the strategy and a resolver", () => {
    expect(specTriggers(spec({ boundary: "retry" }))).toEqual([
      "resolverRetry",
      "settleStop",
    ]);
    expect(specTriggers(spec({ boundary: "retry-later" }))).toEqual([
      "resolverRetryLater",
      "settleStop",
    ]);
    expect(specTriggers(spec({ boundary: "retry" }, []))).toEqual([]);
    expect(specTriggers(spec({ boundary: "retry-later" }, []))).toEqual([]);
  });

  it("constraintRetryLater is never set: the model's constraints skip", () => {
    for (const boundary of [
      "skip",
      "retry",
      "retry-later",
      "disable",
      "throw",
    ] as const) {
      expect(specTriggers(spec({ boundary }))).not.toContain(
        "constraintRetryLater",
      );
    }
  });

  it("retryPolicy and timeout need a resolver with one", () => {
    expect(specTriggers(spec({}, [constraint({ retry: 1 })]))).toEqual([
      "retryPolicy",
      "settleStop",
    ]);
    expect(specTriggers(spec({}, [constraint({ timeout: 10 })]))).toEqual([
      "timeout",
      "settleStop",
    ]);
  });

  it("resolverRejects needs a resolver that fails or can time out first; settleStop needs a resolver", () => {
    expect(specTriggers(spec({}, [constraint({ fails: 1 })]))).toEqual([
      "resolverRejects",
      "settleStop",
    ]);
    // A timeout no longer than the wait can fire before the write.
    expect(
      specTriggers(spec({}, [constraint({ delay: 5, timeout: 5 })])),
    ).toEqual(["timeout", "resolverRejects", "settleStop"]);
    expect(
      specTriggers(spec({}, [constraint({ delay: 5, timeout: 6 })])),
    ).toEqual(["timeout", "settleStop"]);
    // No resolver: neither.
    expect(specTriggers(spec({}, []))).toEqual([]);
  });
  it("restart needs a stop with a start after it and no destroy", () => {
    const steps = (...ops: Array<"stop" | "start" | "settle" | "destroy">) =>
      specTriggers(spec({ steps: ops.map((op) => ({ op })) }));

    expect(steps("stop", "start")).toEqual(["settleStop", "restart"]);
    expect(steps("stop", "settle", "start")).toEqual(["settleStop", "restart"]);
    expect(steps("start", "stop", "start")).toEqual(["settleStop", "restart"]);
    expect(steps("start", "stop")).toEqual(["settleStop"]);
    expect(steps("start", "start")).toEqual(["settleStop"]);
    expect(steps("destroy", "start")).toEqual(["settleStop"]);
    // A destroy between the stop and the start: the start is ignored.
    expect(steps("stop", "destroy", "start")).toEqual(["settleStop"]);
    // A destroyed system is never restarted, whatever follows.
    expect(steps("destroy", "stop", "start")).toEqual(["settleStop"]);
  });

  const effect = {
    reads: [0],
    explicitDeps: false,
    cleanup: false,
    throwsAt: null,
  };
  const withEffect = (boundary: FuzzSpec["boundary"], c = [constraint()]) => {
    const s = spec({ boundary }, c);

    return {
      ...s,
      modules: s.modules.map((m) => ({ ...m, effects: [effect] })),
    };
  };

  it("disable and throw are their strategies, on a resolver that exists", () => {
    expect(specTriggers(spec({ boundary: "disable" }))).toEqual([
      "settleStop",
      "disable",
    ]);
    expect(specTriggers(spec({ boundary: "throw" }))).toEqual([
      "settleStop",
      "throw",
    ]);
    // No resolver and no effect: the strategy applies to nothing.
    expect(specTriggers(spec({ boundary: "disable" }, []))).toEqual([]);
    expect(specTriggers(spec({ boundary: "throw" }, []))).toEqual([]);
  });

  it("disable also counts an effect; throw does not (effects skip then)", () => {
    expect(specTriggers(withEffect("disable", []))).toEqual(["disable"]);
    expect(specTriggers(withEffect("throw", []))).toEqual([]);
    expect(specTriggers(withEffect("throw"))).toEqual(["settleStop", "throw"]);
  });

  it("toScenario gives the case its triggers", () => {
    const s = spec({ boundary: "retry" }, [constraint({ timeout: 3 })]);

    expect(toScenario(s).triggers).toEqual([
      "resolverRetry",
      "timeout",
      "settleStop",
    ]);
  });
});

describe("an entry with `when` applies only to cases with all its triggers", () => {
  const diffs = compareContract(trace(["q", 0]), trace(["q", 1]), "v2");
  const covered = (
    div: Divergence,
    triggers?: string[],
    name = FUZZ_SCENARIO,
  ) => explain(name, diffs, [div], triggers).unexplained.length === 0;

  it("control: an entry without `when` covers in every case", () => {
    expect(covered(entry("q", "q"))).toBe(true);
    expect(covered(entry("q", "q"), [])).toBe(true);
  });

  it("covers in a case with every listed trigger, and only there", () => {
    const scoped = entry("q", "q", { when: ["timeout", "restart"] });

    expect(covered(scoped, ["restart", "timeout", "throw"])).toBe(true);
    expect(covered(scoped, ["timeout"])).toBe(false);
    expect(covered(scoped, [])).toBe(false);
    expect(covered(scoped, undefined)).toBe(false);
  });

  it("never covers in a hand scenario", () => {
    expect(
      covered(
        entry("q", "q", { scenario: "a hand one", when: ["timeout"] }),
        ["timeout"],
        "a hand one",
      ),
    ).toBe(false);
  });

  it("an `ends` entry with `when` stops only a case with its triggers", () => {
    const stop = entry("q-ends", "q", {
      ends: true,
      op: "changed",
      path: "data[1]",
      when: ["timeout"],
    });
    const two = compareContract(
      trace(["q", 0], ["c", 0]),
      trace(["q", 1], ["c", 1]),
      "v2",
    );

    expect(explain(FUZZ_SCENARIO, two, [stop], ["timeout"])).toMatchObject({
      unexplained: [],
      ended: [{ id: "q-ends" }],
    });
    expect(
      explain(FUZZ_SCENARIO, two, [stop], []).unexplained.map((d) => d.kind),
    ).toEqual(["q", "c"]);
  });
});

const CANDIDATE = "__precisionSelfTestCandidate";

/** A fuzz-named case that reports ["q", 0] on the reference and ["q", 1] on the candidate. */
const fuzzCase = (triggers: string[]): ScenarioDef => ({
  name: FUZZ_SCENARIO,
  build: ({ core: { createModule, t } }: BuildContext) => ({
    module: createModule("m", {
      schema: { facts: { n: t.number() }, derivations: {}, events: {} },
      init: (facts: any) => {
        facts.n = 0;
      },
    } as any),
  }),
  steps: [
    { op: "start" },
    {
      op: "run",
      label: "report",
      fn: (_system, ctx) =>
        ctx.external([
          "q",
          (ctx.core as Record<string, unknown>)[CANDIDATE] ? 1 : 0,
        ]),
    },
  ],
  seed: 1,
  triggers,
});

function candidate(): EngineHandle {
  const local = engines()[1] as EngineHandle;

  return {
    ...local,
    name: "v2",
    async load() {
      return { ...(await local.load()), [CANDIDATE]: true };
    },
  };
}

describe("runScenario reads the case's triggers", () => {
  const scoped = [entry("q", "q", { when: ["timeout"] })];

  it("a case with the trigger is covered", async () => {
    const result = await runScenario(fuzzCase(["timeout"]), {
      candidates: [candidate()],
      divergences: scoped,
    });

    expect(result.report).toBe("");
    expect(result.used).toEqual(["q"]);
  });

  it("a case without it is not", async () => {
    const result = await runScenario(fuzzCase(["restart"]), {
      candidates: [candidate()],
      divergences: scoped,
    });

    expect(result.ok).toBe(false);
    expect(result.used).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("the census checks `when` and `group`", () => {
  const root = mkdtempSync(join(tmpdir(), "conformance-precision-"));
  mkdirSync(join(root, "diff"), { recursive: true });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const census = (entries: unknown[], used: string[] | null = null) => {
    writeFileSync(join(root, "diff/divergences.json"), JSON.stringify(entries));

    return checkDivergences(root, used ? new Set(used) : null).join("\n");
  };
  const stop = (id: string, more: Partial<Divergence> = {}) =>
    entry(id, "q", { ends: true, op: "missing", ...more });

  it("control: known triggers, and an `ends` entry with `when`, pass", () => {
    expect(
      census([entry("q", "q", { when: ["timeout", "resolverRetry"] })], ["q"]),
    ).toBe("");
    expect(census([stop("q-ends", { when: ["restart"] })], ["q-ends"])).toBe(
      "",
    );
  });

  it("rejects an unknown, empty or repeated `when`", () => {
    expect(census([entry("q", "q", { when: ["timeOut"] })])).toMatch(
      /q when has unknown trigger "timeOut"/,
    );
    expect(census([entry("q", "q", { when: [] })])).toMatch(
      /q when must be a non-empty list/,
    );
    expect(census([entry("q", "q", { when: ["timeout", "timeout"] })])).toMatch(
      /q when lists a trigger twice/,
    );
  });

  it("rejects `when` on an entry for a hand scenario", () => {
    expect(
      census([entry("q", "q", { scenario: "a hand one", when: ["timeout"] })]),
    ).toMatch(/q has when, which only a fuzz entry may have/);
  });

  it("rejects an `ends` entry without `when`", () => {
    expect(census([stop("q-ends")], ["q-ends"])).toMatch(
      /q-ends has ends, so it must say when/,
    );
  });

  const member = (id: string, more: Partial<Divergence> = {}) =>
    entry(id, id, { group: "quirk-a", when: ["resolverRetry"], ...more });

  it("one entry of a group used: none of the group is stale", () => {
    expect(census([member("g1"), member("g2")], ["g1"])).toBe("");
  });

  it("no entry of a group used: every one is stale", () => {
    const text = census([member("g1"), member("g2")], []);

    expect(text).toMatch(
      /g1 covers no difference .* group "quirk-a" \(stale\)/,
    );
    expect(text).toMatch(
      /g2 covers no difference .* group "quirk-a" \(stale\)/,
    );
  });

  it("control: without a group each entry is checked alone", () => {
    expect(census([entry("g1", "g1"), entry("g2", "g2")], ["g1"])).toMatch(
      /g2 covers no difference in this run \(stale\)/,
    );
    expect(
      census([member("g1"), member("h1", { group: "quirk-p" })], ["g1"]),
    ).toMatch(/h1 covers no difference .* group "quirk-p" \(stale\)/);
  });

  it("rejects a group whose entries differ in approvedBy or when", () => {
    expect(
      census([member("g1"), member("g2", { approvedBy: "Someone" })], ["g1"]),
    ).toMatch(/g2 is in group "quirk-a" but its approvedBy or when differs/);
    expect(
      census([member("g1"), member("g2", { when: ["timeout"] })], ["g1"]),
    ).toMatch(/g2 is in group "quirk-a" but its approvedBy or when differs/);
    expect(
      census([member("g1"), member("g2", { when: undefined })], ["g1"]),
    ).toMatch(/g2 is in group "quirk-a" but its approvedBy or when differs/);
  });

  it("rejects `group` on an entry for a hand scenario", () => {
    expect(census([member("g1", { scenario: "a hand one" })])).toMatch(
      /g1 has group, which only a fuzz entry may have/,
    );
  });
});
