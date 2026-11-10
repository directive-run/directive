/**
 * Report mode (lib/fuzz.ts `FUZZ_BATCH_REPORT_ENV`): the nightly's deep runs
 * report a failing case with a batched resolver instead of failing (Jason,
 * 2026-11-09: "Gate on short seeds; deep runs report (Recommended)"). Here:
 * the flag is off unless it is exactly "1"; with it on, only a case with
 * the batched resolver is reported and every other failing case still
 * fails; and only the nightly workflow sets it, so the PR-count fuzz (run by
 * the census in CI) stays fully blocking.
 */

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FUZZ_BATCH_REPORT_ENV,
  batchReportMode,
  onFailingCase,
} from "../../lib/fuzz.js";
import { type FuzzSpec, specTriggers } from "../fuzz/model.js";

const PINNED = JSON.parse(
  readFileSync(new URL("../fuzz/pinned.json", import.meta.url), "utf8"),
) as { group: string; spec: FuzzSpec }[];
const batched = PINNED.filter((p) => p.spec.batch != null);
const single = PINNED.filter((p) => p.spec.batch == null);

const WORKFLOWS = new URL("../../../../.github/workflows/", import.meta.url);
const NIGHTLY = "diff-fuzz-nightly.yml";

describe("report mode for batched cases (deep runs)", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(batchReportMode({})).toBe(false);
    for (const value of ["", "0", "true", "yes", " 1", "1 "]) {
      expect(batchReportMode({ [FUZZ_BATCH_REPORT_ENV]: value })).toBe(false);
    }
    expect(batchReportMode({ [FUZZ_BATCH_REPORT_ENV]: "1" })).toBe(true);
  });

  it("reports only a case with the batched resolver, and only with the flag on", () => {
    expect(batched.length).toBeGreaterThan(0);
    expect(single.length).toBeGreaterThan(0);
    for (const { spec } of batched) {
      const triggers = specTriggers(spec);
      expect(triggers).toContain("batched");
      expect(onFailingCase(triggers, true)).toBe("report");
      expect(onFailingCase(triggers, false)).toBe("fail");
    }
    for (const { spec } of single) {
      const triggers = specTriggers(spec);
      expect(triggers).not.toContain("batched");
      expect(onFailingCase(triggers, true)).toBe("fail");
      expect(onFailingCase(triggers, false)).toBe("fail");
    }
  });

  it("is set by the nightly workflow only, so PR CI stays blocking", () => {
    const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));
    expect(files).toContain(NIGHTLY);
    expect(files).toContain("ci.yml");
    const setting = files.filter((f) =>
      readFileSync(new URL(f, WORKFLOWS), "utf8").includes(
        FUZZ_BATCH_REPORT_ENV,
      ),
    );
    expect(setting).toEqual([NIGHTLY]);
    expect(readFileSync(new URL(NIGHTLY, WORKFLOWS), "utf8")).toMatch(
      new RegExp(`^\\s+${FUZZ_BATCH_REPORT_ENV}: "1"$`, "m"),
    );
  });
});
