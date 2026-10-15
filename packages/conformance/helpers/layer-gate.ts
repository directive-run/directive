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
  if (which === "v1") {
    // One entry per test, with a reason; the census rejects anything else.
    if (Object.hasOwn(ahead[file] ?? {}, name)) {
      ctx.skip();
    }
  } else if (which === "v2") {
    if (
      entry?.category === "internals" ||
      current === null ||
      layer > index(current)
    ) {
      ctx.skip();
    }
  }
});
