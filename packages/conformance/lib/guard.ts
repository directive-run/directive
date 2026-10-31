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
 *    engine it judges. One exception (Jason, 2026-11-01): signed divergences.
 *    The harness files such a PR changes may be only diff/divergences.json,
 *    with or without harness.lock.json (the lock never changes alone), and
 *    every entry it adds or changes (same id, any field different, compared
 *    with the base) must have a non-empty `approvedBy`, and a changed entry
 *    must be signed afresh (its `approvedBy` or `date` differs from the
 *    base's). Removing an entry is
 *    allowed: it only tightens the oracle (an engine fix that closes a
 *    divergence must drop its entry, or the entry goes stale), and the census
 *    fails the PR if the difference is still there. The census still fails an
 *    entry that covers no real difference,
 *    and rule 2's label still applies. Both ends of divergences.json are read
 *    as data; anything the guard cannot parse fails closed.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCK_FILE, isHarnessPath } from "./harness.js";
import { oracleLockHash } from "./lockfile.js";
import { RATCHET_FILE, type Ratchet, checkShrink } from "./ratchet.js";

export const BASELINE_FILE = "oracle-baseline.json";
export const LABEL = "oracle-change";
const PREFIX = "packages/conformance/";
export const DIVERGENCES_FILE = "diff/divergences.json";

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
 * the text at the base and head of pnpm-lock.yaml, v2-passing.json and
 * diff/divergences.json when the PR changes them (null: absent at that end).
 */
export function checkPullRequest(
  changedFiles: string[],
  labels: string[],
  lockfile?: { base: string; head: string },
  ratchet?: { base: string | null; head: string },
  divergences?: { base: string | null; head: string | null },
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
    failures.push(...checkEngineHarness(conformance, divergences));
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

/**
 * Rule 3 for a PR that changes packages/core-next and the harness files
 * `conformance` (repo-relative): only signed divergences may ride along.
 */
function checkEngineHarness(
  conformance: string[],
  divergences?: { base: string | null; head: string | null },
): string[] {
  const signedFile = `${PREFIX}${DIVERGENCES_FILE}`;
  const others = conformance.filter(
    (f) => f !== signedFile && f !== `${PREFIX}${LOCK_FILE}`,
  );
  if (others.length > 0) {
    return [
      `this PR changes packages/core-next and the conformance harness (${others.join(", ")}); land oracle changes in their own PR (only signed ${DIVERGENCES_FILE} entries, with ${LOCK_FILE}, may change alongside the engine)`,
    ];
  }
  if (!conformance.includes(signedFile)) {
    return [
      `this PR changes packages/core-next and ${LOCK_FILE} without ${DIVERGENCES_FILE}; alongside the engine the lock may change only for a signed divergence`,
    ];
  }

  return checkSignedDivergences(divergences);
}

type ById = Map<string, Record<string, unknown>>;

/** Entries keyed by id, or why the guard cannot trust the text. */
function divergencesById(text: string, end: string): ById | string {
  let entries: unknown;
  try {
    entries = JSON.parse(text);
  } catch {
    return `${DIVERGENCES_FILE} is not valid JSON at the ${end}`;
  }
  if (!Array.isArray(entries)) {
    return `${DIVERGENCES_FILE} must be an array at the ${end}`;
  }
  const out: ById = new Map();
  for (const [i, raw] of entries.entries()) {
    const id = (raw as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !id) {
      return `${DIVERGENCES_FILE} entry ${i} has no id at the ${end}`;
    }
    if (out.has(id)) {
      return `${DIVERGENCES_FILE} has duplicate id ${id} at the ${end}`;
    }
    out.set(id, raw as Record<string, unknown>);
  }

  return out;
}

/** Key-order-independent JSON, so a reordered entry is not a changed one. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

/**
 * Every entry added or changed between the base and head is signed
 * (non-empty approvedBy). A removed entry needs no signature: it only
 * tightens the oracle. Fails closed on anything it cannot read.
 */
function checkSignedDivergences(divergences?: {
  base: string | null;
  head: string | null;
}): string[] {
  const why = `alongside packages/core-next, ${DIVERGENCES_FILE} may only add or change signed entries, or remove entries`;
  if (!divergences) {
    return [
      `${DIVERGENCES_FILE} changed but its base and head were not provided`,
    ];
  }
  if (divergences.head === null) {
    return [`${DIVERGENCES_FILE} is deleted at the head; ${why}`];
  }
  const head = divergencesById(divergences.head, "head");
  const base =
    divergences.base === null
      ? new Map()
      : divergencesById(divergences.base, "base");
  if (typeof head === "string" || typeof base === "string") {
    return [
      `${[head, base].filter((x) => typeof x === "string").join("; ")}; the guard cannot check its signatures`,
    ];
  }
  const failures: string[] = [];
  for (const [id, entry] of head) {
    const before = base.get(id);
    if (before !== undefined && canonical(before) === canonical(entry)) {
      continue;
    }
    const signed =
      typeof entry.approvedBy === "string" && entry.approvedBy.trim() !== "";
    if (!signed) {
      failures.push(
        `${DIVERGENCES_FILE} ${before === undefined ? "adds" : "changes"} ${id} without approvedBy; ${why}`,
      );
    } else if (
      before !== undefined &&
      entry.approvedBy === before.approvedBy &&
      entry.date === before.date
    ) {
      // A changed entry is signed afresh: an edit that keeps the old
      // signature and date (say, dropping `op` to widen it) was never
      // signed off.
      failures.push(
        `${DIVERGENCES_FILE} changes ${id} but keeps its old approvedBy and date; a changed entry needs a fresh sign-off; ${why}`,
      );
    }
  }

  return failures;
}
