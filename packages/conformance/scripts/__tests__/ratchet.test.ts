/**
 * The v2 ratchet (lib/ratchet.ts): a listed test that stops passing on
 * core-next's source or its dist fails; the list only grows; a removal needs
 * a reason and the oracle-change label.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRepoRoot } from "../../lib/core-entries.js";
import { checkPullRequest } from "../../lib/guard.js";
import {
  type Passed,
  RATCHET_FILE,
  type Ratchet,
  checkRatchet,
  checkShape,
  checkShrink,
  grow,
  passedIn,
} from "../../lib/ratchet.js";

const conformanceRoot = join(defaultRepoRoot, "packages/conformance");
const FILE = "tests/core/facts.test.ts";
const baseline = (): Ratchet => ({
  tests: { "conformance:v2": { [FILE]: ["a > one", "a > two"] } },
  removed: [],
});
const allPass = (): Passed => ({
  "conformance:v2": { [FILE]: ["a > one", "a > two", "a > three"] },
  "conformance:v2:dist": { [FILE]: ["a > one", "a > two", "a > three"] },
  "conformance:v2:prod": {},
  "conformance:v2:dist:prod": {},
});

describe("ratchet", () => {
  it("accepts a run where every listed test passed on source and dist", () => {
    expect(checkRatchet(baseline(), allPass())).toEqual([]);
  });

  it("fails a listed test that stopped passing on the source", () => {
    const passed = allPass();
    passed["conformance:v2"] = { [FILE]: ["a > one"] };
    expect(checkRatchet(baseline(), passed).join("\n")).toMatch(
      /conformance:v2: tests\/core\/facts\.test\.ts > "a > two" .*no longer passes/,
    );
  });

  it("fails a listed test that passes on the source but not the dist", () => {
    const passed = allPass();
    passed["conformance:v2:dist"] = { [FILE]: ["a > two"] };
    expect(checkRatchet(baseline(), passed).join("\n")).toMatch(
      /conformance:v2:dist: .*"a > one" .*no longer passes/,
    );
  });

  it("fails a run that is missing a project's report", () => {
    const { "conformance:v2:dist:prod": _dropped, ...passed } = allPass();
    expect(checkRatchet(baseline(), passed)).toContain(
      "conformance:v2:dist:prod produced no report",
    );
  });

  it("grows by tests that pass on source and dist, and never shrinks", () => {
    const passed = allPass();
    passed["conformance:v2"] = { [FILE]: ["a > three", "a > four"] };
    passed["conformance:v2:dist"] = { [FILE]: ["a > three"] };
    const { next, added } = grow(baseline(), passed);
    expect(added).toBe(1);
    expect(next.tests["conformance:v2"]?.[FILE]).toEqual([
      "a > one",
      "a > three",
      "a > two",
    ]);
  });

  it("rejects an unknown project, a non-port, a duplicate and a bare removal", () => {
    const layers = JSON.parse(
      readFileSync(join(conformanceRoot, "layers.json"), "utf8"),
    );
    expect(checkShape(baseline(), layers)).toEqual([]);
    const bad: Ratchet = {
      tests: {
        "conformance:v2:dist": { [FILE]: ["x"] },
        "conformance:v2": {
          "tests/nope.test.ts": ["x"],
          [FILE]: ["x", "x"],
        },
      },
      removed: [
        { project: "conformance:v2", file: FILE, test: "x", reason: "" },
      ],
    };
    const failures = checkShape(bad, layers).join("\n");
    expect(failures).toMatch(/conformance:v2:dist is not a v2 source project/);
    expect(failures).toMatch(/tests\/nope\.test\.ts, which is not a port/);
    expect(failures).toMatch(/lists a test twice/);
    expect(failures).toMatch(/needs project, file, test and a reason/);
  });

  it("reads the passing ported tests from a JSON report", () => {
    const report = {
      testResults: [
        {
          name: join(conformanceRoot, FILE),
          assertionResults: [
            { ancestorTitles: ["a"], title: "one", status: "passed" },
            { ancestorTitles: ["a"], title: "two", status: "failed" },
            { ancestorTitles: ["a"], title: "three", status: "skipped" },
          ],
        },
        {
          name: join(conformanceRoot, "self/engine-identity.test.ts"),
          assertionResults: [
            { ancestorTitles: [], title: "x", status: "passed" },
          ],
        },
      ],
    };
    expect(passedIn(report, conformanceRoot)).toEqual({ [FILE]: ["a > one"] });
  });

  it("the committed ratchet is well formed", () => {
    const layers = JSON.parse(
      readFileSync(join(conformanceRoot, "layers.json"), "utf8"),
    );
    const committed = JSON.parse(
      readFileSync(join(conformanceRoot, RATCHET_FILE), "utf8"),
    ) as Ratchet;
    expect(checkShape(committed, layers)).toEqual([]);
  });
});

describe("ratchet: removals in a pull request", () => {
  const head = (): Ratchet => ({
    tests: { "conformance:v2": { [FILE]: ["a > one"] } },
    removed: [],
  });

  it("accepts growth without the label", () => {
    const grown: Ratchet = {
      tests: { "conformance:v2": { [FILE]: ["a > one", "a > two", "a > z"] } },
    };
    expect(checkShrink(baseline(), grown, false)).toEqual([]);
  });

  it("fails a removal with no reason, even with the label", () => {
    expect(checkShrink(baseline(), head(), true).join("\n")).toMatch(
      /"a > two" was removed without a `removed` entry/,
    );
  });

  it("fails a removal with a reason but no label", () => {
    const withReason = head();
    withReason.removed = [
      {
        project: "conformance:v2",
        file: FILE,
        test: "a > two",
        reason: "the test was rewritten upstream under a new name",
      },
    ];
    expect(checkShrink(baseline(), withReason, false).join("\n")).toMatch(
      /needs the oracle-change label/,
    );
    expect(checkShrink(baseline(), withReason, true)).toEqual([]);
  });

  it("the PR guard applies the rule when the file changes", () => {
    const changed = [`packages/conformance/${RATCHET_FILE}`];
    const failures = checkPullRequest(changed, [], undefined, {
      base: JSON.stringify(baseline()),
      head: JSON.stringify(head()),
    });
    expect(failures.join("\n")).toMatch(/was removed without/);
    expect(checkPullRequest(changed, [], undefined).join("\n")).toMatch(
      /base and head were not provided/,
    );
    expect(
      checkPullRequest(changed, [], undefined, {
        base: null,
        head: JSON.stringify(head()),
      }),
    ).toEqual([]);
  });
});
