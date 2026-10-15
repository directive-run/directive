/**
 * Rules for changing the oracle itself.
 *
 * 1. The correctness baseline only tightens. `oracle-baseline.json` records
 *    the pinned files, their instruments and allowAbove reasons, and the
 *    layer of every test in a pinned file. Without regenerating the baseline,
 *    pins and instruments may only grow, allowAbove may only shrink, and no
 *    pinned test may move to a higher layer.
 * 2. Regenerating the baseline or the harness lock needs the `oracle-change`
 *    label on the pull request.
 * 3. A pull request that touches packages/core-next may not also touch the
 *    harness: the oracle changes in its own pull request, never alongside the
 *    engine it judges.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCK_FILE, isHarnessPath } from "./harness.js";

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

/** Pull-request rules over the changed paths (repo-relative) and labels. */
export function checkPullRequest(
  changedFiles: string[],
  labels: string[],
): string[] {
  const failures: string[] = [];
  const harness = changedFiles.filter(
    (f) => f.startsWith(PREFIX) && isHarnessPath(f.slice(PREFIX.length)),
  );
  const engine = changedFiles.filter((f) =>
    f.startsWith("packages/core-next/"),
  );
  if (engine.length > 0 && harness.length > 0) {
    failures.push(
      `this PR changes packages/core-next and the conformance harness (${harness.join(", ")}); land oracle changes in their own PR`,
    );
  }
  const oracle = changedFiles.filter(
    (f) => f === `${PREFIX}${LOCK_FILE}` || f === `${PREFIX}${BASELINE_FILE}`,
  );
  if (oracle.length > 0 && !labels.includes(LABEL)) {
    failures.push(
      `this PR changes ${oracle.join(", ")}; that changes the oracle and needs the ${LABEL} label`,
    );
  }

  return failures;
}
