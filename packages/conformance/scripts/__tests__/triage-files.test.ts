// The real triage files, checked on every pull request (the census runs this
// project). The scorer only validates a triage file when it scores a report,
// and reports exist only in the nightly; this catches a malformed entry, and
// an overdue deferral, before it merges.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type TriageEntry,
  rowLayers,
  validateTriage,
} from "../mutation-score.js";

const root = join(import.meta.dirname, "..", "..");
const dir = join(root, "mutation-triage");
const rows = rowLayers(readFileSync(join(root, "MUTATION.md"), "utf8"));
const current = (
  JSON.parse(readFileSync(join(root, "layers.rules.json"), "utf8")) as {
    current: string;
  }
).current;
const currentNum = Number(current.slice(1));
const files = readdirSync(dir)
  .filter((n) => n.endsWith(".json"))
  .sort();

const load = (name: string): TriageEntry[] =>
  JSON.parse(readFileSync(join(dir, name), "utf8")) as TriageEntry[];

describe("mutation-triage files", () => {
  it("every file is valid for its MUTATION.md row", () => {
    const problems: string[] = [];
    for (const name of files) {
      const file = name.replace(/\.json$/, ".ts");
      try {
        validateTriage(file, load(name), rows.get(file));
      } catch (e) {
        problems.push((e as Error).message);
      }
    }
    expect(problems).toEqual([]);
  });

  // A feature-layer entry defers a mutant to a layer that has no killing test
  // yet. Once that layer is built (at or below `current`), its tests must have
  // killed it: the entry becomes later-layer naming the test, or goes.
  it("no feature-layer entry is for a built layer", () => {
    const overdue = files.flatMap((name) =>
      load(name)
        .filter(
          (t) =>
            t.reason === "feature-layer" &&
            Number((t.layer ?? "L0").slice(1)) <= currentNum,
        )
        .map((t) => `${name} ${t.line}:${t.col} ${t.mutator} (${t.layer})`),
    );
    expect(overdue).toEqual([]);
  });
});
