/**
 * Per-test gate, loaded as a setup file by every engine project.
 *
 * - Every ported test must have an entry in layers.json under the name vitest
 *   gives it. A test the generator could not see fails here rather than
 *   silently running on an engine whose layer it never checked.
 * - v1 skips the tests in aheadOfV1.json: behaviour the workspace has and no
 *   release has shipped yet.
 * - v2 skips tests above layers.rules.json `current`, and every file in the
 *   `internals` category until it is triaged (WHITE-BOX.md).
 * - `DIRECTIVE_V2_ALL=1` (set only by scripts/v2-ratchet.ts, never in the
 *   config) runs v2's tests above `current` too, to measure what already
 *   passes. The census run never sets it, and the census fails any test above
 *   `current` that was not skipped, so setting it there cannot turn a run
 *   green.
 * - `DIRECTIVE_MUTATION_CEILING=Ln` (set only by vitest.stryker.config.ts,
 *   from `MUTATION_LAYER`) skips, on the local engine, every test placed
 *   above Ln, the same way v2 skips tests above `current`. A skipped test
 *   never runs its body, so it neither covers nor kills a mutant: the
 *   mutation score of a layer's files counts only kills by tests that run on
 *   v2 at that layer (MUTATION.md).
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach } from "vitest";
import { engine } from "./engine.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file: string) =>
  JSON.parse(readFileSync(join(root, file), "utf8"));

interface TestLayer {
  layer: string;
  dynamic?: true;
}
const layers = read("layers.json").files as Record<
  string,
  { category: string; tests: Record<string, TestLayer> }
>;
const current = read("layers.rules.json").current as string | null;
const ahead = read("aheadOfV1.json").tests as Record<
  string,
  Record<string, string>
>;

const index = (layer: string) => Number(layer.slice(1));

const ceilingEnv = process.env.DIRECTIVE_MUTATION_CEILING;
if (ceilingEnv !== undefined && !/^L(?:[0-9]|1[0-3])$/.test(ceilingEnv)) {
  throw new Error(
    `DIRECTIVE_MUTATION_CEILING must be L0..L13, got "${ceilingEnv}"`,
  );
}
const ceiling = ceilingEnv === undefined ? undefined : index(ceilingEnv);

interface TaskLike {
  name: string;
  suite?: TaskLike;
  file?: { filepath: string };
  filepath?: string;
}

function key(task: TaskLike): string {
  const names: string[] = [task.name];
  let suite = task.suite;
  // Stop at the file: its name is a path, not a title.
  while (suite && suite.filepath === undefined) {
    names.unshift(suite.name);
    suite = suite.suite;
  }

  return names.join(" > ");
}

/** The layer to gate on: exact entry, its duplicates, or every dynamic one. */
export function layerFor(
  tests: Record<string, TestLayer>,
  name: string,
): number | undefined {
  const matches = Object.entries(tests).filter(
    ([k]) => k === name || k.startsWith(`${name} #`),
  );
  const pool =
    matches.length > 0
      ? matches
      : Object.entries(tests).filter(([, t]) => t.dynamic);
  if (pool.length === 0) {
    return undefined;
  }

  return Math.max(...pool.map(([, t]) => index(t.layer)));
}

beforeEach((ctx) => {
  const task = ctx.task as unknown as TaskLike;
  const file = relative(root, task.file?.filepath ?? "");
  if (!file.startsWith("tests/")) {
    return;
  }
  const entry = layers[file];
  const name = key(task);
  const layer = entry ? layerFor(entry.tests, name) : undefined;
  if (layer === undefined) {
    throw new Error(
      `layers.json has no entry for "${name}" in ${file}; re-run the port`,
    );
  }

  const which = engine();
  if (which === "local" && ceiling !== undefined && layer > ceiling) {
    ctx.skip();
  } else if (which === "v1") {
    // One entry per test, with a reason; the census rejects anything else.
    if (Object.hasOwn(ahead[file] ?? {}, name)) {
      ctx.skip();
    }
  } else if (which === "v2") {
    const all = process.env.DIRECTIVE_V2_ALL === "1";
    if (
      entry?.category === "internals" ||
      (!all && (current === null || layer > index(current)))
    ) {
      ctx.skip();
    }
  }
});
