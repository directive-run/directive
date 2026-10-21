/**
 * Rules for changing the oracle itself.
 *
 * 1. The correctness baseline only tightens. `oracle-baseline.json` records
 *    the pinned files, their instruments and allowAbove reasons, and the
 *    layer of every test in a pinned file. Without regenerating the baseline,
 *    pins and instruments may only grow, allowAbove may only shrink, and no
 *    pinned test may move to a higher layer.
 * 2. A pull request that changes any harness file needs the `oracle-change`
 *    label. The harness is the conformance package's own (lib/harness.ts,
 *    including its lock and this baseline) plus what decides how it runs
 *    from outside: the workflows, the root package.json, pnpm-workspace.yaml,
 *    .npmrc, and the pnpm-lock.yaml entries that resolve directive-v1 and
 *    vitest (lib/lockfile.ts).
 * 3. A pull request that touches packages/core-next may not also touch the
 *    harness: the oracle changes in its own pull request, never alongside the
 *    engine it judges.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isHarnessPath } from "./harness.js";
import { oracleLockHash } from "./lockfile.js";
import { RATCHET_FILE, type Ratchet, checkShrink } from "./ratchet.js";

export const BASELINE_FILE = "oracle-baseline.json";
export const LABEL = "oracle-change";
const PREFIX = "packages/conformance/";

interface Rules {
  rules: Record<
    string,
    {
      rule: string;
      pin?: boolean;
      instruments?: string[];
      allowAbove?: Record<string, string>;
    }
  >;
}
interface Layers {
  files: Record<string, { tests: Record<string, { layer: string }> }>;
}

export interface Baseline {
  pins: string[];
  instruments: Record<string, string[]>;
  allowAbove: Record<string, string[]>;
  layers: Record<string, Record<string, string>>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function baselineFrom(conformanceRoot: string): Baseline {
  const rules = readJson<Rules>(join(conformanceRoot, "layers.rules.json"));
  const layers = readJson<Layers>(join(conformanceRoot, "layers.json"));
  const pins = Object.entries(rules.rules)
    .filter(([, r]) => r.pin)
    .map(([f]) => f)
    .sort();

  return {
    pins,
    instruments: Object.fromEntries(
      pins.map((f) => [f, [...(rules.rules[f]?.instruments ?? [])].sort()]),
    ),
    allowAbove: Object.fromEntries(
      pins.map((f) => [
        f,
        Object.keys(rules.rules[f]?.allowAbove ?? {}).sort(),
      ]),
    ),
    layers: Object.fromEntries(
      pins.map((f) => [
        f,
        Object.fromEntries(
          Object.entries(layers.files[f]?.tests ?? {}).map(([k, t]) => [
            k,
            t.layer,
          ]),
        ),
      ]),
    ),
  };
}

const index = (layer: string) => Number(layer.slice(1));

/** Ways the current rules are looser than the committed baseline. */
export function checkBaseline(conformanceRoot: string): string[] {
  const path = join(conformanceRoot, BASELINE_FILE);
  if (!existsSync(path)) {
    return [`${BASELINE_FILE} is missing`];
  }
  const base = readJson<Baseline>(path);
  const now = baselineFrom(conformanceRoot);
  const failures: string[] = [];
  for (const file of base.pins) {
    if (!now.pins.includes(file)) {
      failures.push(`${file} was unpinned`);
      continue;
    }
    for (const f of base.instruments[file] ?? []) {
      if (!now.instruments[file]?.includes(f)) {
        failures.push(`${file}: instrument "${f}" was dropped`);
      }
    }
    for (const f of now.allowAbove[file] ?? []) {
      if (!base.allowAbove[file]?.includes(f)) {
        failures.push(`${file}: allowAbove "${f}" was added`);
      }
    }
    for (const [test, layer] of Object.entries(base.layers[file] ?? {})) {
      const current = now.layers[file]?.[test];
      if (current === undefined) {
        failures.push(`${file}: correctness test "${test}" is gone`);
      } else if (index(current) > index(layer)) {
        failures.push(
          `${file}: "${test}" moved up from ${layer} to ${current}`,
        );
      }
    }
  }
  if (failures.length > 0) {
    failures.push(
      `the correctness baseline only tightens; loosening it means regenerating ${BASELINE_FILE} in a PR labelled ${LABEL}`,
    );
  }

  return failures;
}

/** Repo-level files that decide how the suite runs. */
function isOutsideHarness(path: string): boolean {
  return (
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path) ||
    path === "package.json" ||
    path === "pnpm-workspace.yaml" ||
    path === ".npmrc"
  );
}

function isConformanceHarness(path: string): boolean {
  return path.startsWith(PREFIX) && isHarnessPath(path.slice(PREFIX.length));
}

/**
 * Pull-request rules over the changed paths (repo-relative), the labels, and
 * pnpm-lock.yaml at the base and head when the PR changes it.
 */
export function checkPullRequest(
  changedFiles: string[],
  labels: string[],
  lockfile?: { base: string; head: string },
  ratchet?: { base: string | null; head: string },
): string[] {
  const failures: string[] = [];
  // The v2 ratchet only grows: a removal needs a reason and the label.
  if (changedFiles.includes(`${PREFIX}${RATCHET_FILE}`)) {
    if (!ratchet) {
      failures.push(
        `${RATCHET_FILE} changed but its base and head were not provided`,
      );
    } else if (ratchet.base !== null) {
      try {
        failures.push(
          ...checkShrink(
            JSON.parse(ratchet.base) as Ratchet,
            JSON.parse(ratchet.head) as Ratchet,
            labels.includes(LABEL),
            LABEL,
          ),
        );
      } catch {
        failures.push(`${RATCHET_FILE} is not valid JSON at the base or head`);
      }
    }
  }
  const conformance = changedFiles.filter(isConformanceHarness);
  const engine = changedFiles.filter((f) =>
    f.startsWith("packages/core-next/"),
  );
  if (engine.length > 0 && conformance.length > 0) {
    failures.push(
      `this PR changes packages/core-next and the conformance harness (${conformance.join(", ")}); land oracle changes in their own PR`,
    );
  }

  const harness = [...conformance, ...changedFiles.filter(isOutsideHarness)];
  if (changedFiles.includes("pnpm-lock.yaml")) {
    if (!lockfile) {
      failures.push(
        "pnpm-lock.yaml changed but its base and head were not provided",
      );
    } else if (
      oracleLockHash(lockfile.base) !== oracleLockHash(lockfile.head)
    ) {
      harness.push("pnpm-lock.yaml (directive-v1 / vitest entries)");
    }
  }
  if (harness.length > 0 && !labels.includes(LABEL)) {
    failures.push(
      `this PR changes the oracle (${harness.join(", ")}) and needs the ${LABEL} label`,
    );
  }

  return failures;
}
