/**
 * The nightly mutation workflow and MUTATION.md describe the same shards.
 *
 * MUTATION.md says which row (layer) each file of packages/core/src/core/
 * belongs to; the workflow's matrix says which shard mutates it and at which
 * ceiling. If they drift, a file is mutated at the wrong ceiling (its kills
 * counted from tests that do not run on v2 at that layer), twice, or never.
 * The expected sets are read from the two artifacts and the directory, not
 * written here, so adding a file or a shard needs no edit to this test.
 */

import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rowLayers } from "../mutation-score.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const CORE = "packages/core/src/core";

/** Files of core/ that are not mutated: types only. */
const NOT_MUTATED = new Set(["types.ts"]);

interface Shard {
  name: string;
  layer: number | undefined;
  entries: string[];
}

/** The matrix `include` entries (`- shard:`, `layer:`, `mutate:`). */
function parseShards(workflow: string): Shard[] {
  const shards: Shard[] = [];
  for (const line of workflow.split("\n")) {
    const name = line.match(/^\s*- shard:\s*(\S+)\s*$/)?.[1];
    if (name !== undefined) {
      shards.push({ name, layer: undefined, entries: [] });
      continue;
    }
    const last = shards[shards.length - 1];
    const layer = line.match(/^\s+layer:\s*L(\d+)\s*$/)?.[1];
    if (last !== undefined && layer !== undefined) {
      last.layer = Number(layer);
    }
    const mutate = line.match(/^\s+mutate:\s*(\S+)\s*$/)?.[1];
    if (last !== undefined && mutate !== undefined) {
      last.entries = mutate.split(",");
    }
  }

  return shards;
}

/** The summary job's `for shard in a b c; do` list. */
function parseSummaryShards(workflow: string): string[] {
  const m = workflow.match(/for shard in ([^;]+); do/);

  return m ? m[1]!.trim().split(/\s+/) : [];
}

/** Expand one `mutate` entry (a path, `*` allowed in the file name). */
function expand(entry: string, coreFiles: string[]): string[] {
  if (!entry.startsWith(`${CORE}/`)) {
    return [entry];
  }
  const pattern = entry.slice(CORE.length + 1);
  if (!pattern.includes("*")) {
    return [pattern];
  }
  const re = new RegExp(
    `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`,
  );

  return coreFiles.filter((f) => re.test(f));
}

/**
 * Everything wrong between the workflow, MUTATION.md and the directory.
 * Empty when they agree.
 */
function shardProblems(
  workflow: string,
  markdown: string,
  coreFiles: string[],
): string[] {
  const problems: string[] = [];
  const rows = rowLayers(markdown);
  const shards = parseShards(workflow);
  const mutated = coreFiles.filter((f) => !NOT_MUTATED.has(f));

  if (shards.length === 0) {
    problems.push("the workflow matrix has no shards");
  }
  const names = shards.map((s) => s.name);
  for (const dup of names.filter((n, i) => names.indexOf(n) !== i)) {
    problems.push(`shard ${dup} is listed twice`);
  }
  const summary = parseSummaryShards(workflow);
  if (summary.join(" ") !== names.join(" ")) {
    problems.push(
      `the summary job fetches full reports for [${summary.join(", ")}], the matrix runs [${names.join(", ")}]`,
    );
  }

  const owners = new Map<string, string[]>();
  for (const shard of shards) {
    if (shard.layer === undefined) {
      problems.push(`shard ${shard.name} has no layer`);
    }
    if (shard.entries.length === 0) {
      problems.push(`shard ${shard.name} mutates nothing`);
    }
    for (const entry of shard.entries) {
      const files = expand(entry, coreFiles);
      if (files.length === 0 || !entry.startsWith(`${CORE}/`)) {
        problems.push(
          `shard ${shard.name}: ${entry} matches no file of ${CORE}`,
        );
      }
      for (const file of files) {
        owners.set(file, [...(owners.get(file) ?? []), shard.name]);
        if (!coreFiles.includes(file)) {
          problems.push(`shard ${shard.name}: ${file} does not exist`);
        } else if (NOT_MUTATED.has(file)) {
          problems.push(`shard ${shard.name}: ${file} holds only types`);
        } else if (rows.get(file) === undefined) {
          problems.push(
            `shard ${shard.name}: ${file} is in no MUTATION.md row`,
          );
        } else if (rows.get(file) !== shard.layer) {
          problems.push(
            `shard ${shard.name} runs ${file} at L${shard.layer}, its MUTATION.md row is L${rows.get(file)}`,
          );
        }
      }
    }
  }

  for (const file of mutated) {
    const inShards = owners.get(file) ?? [];
    if (inShards.length === 0) {
      problems.push(`${file} is in no shard`);
    } else if (inShards.length > 1) {
      problems.push(
        `${file} is in ${inShards.length} shards: ${inShards.join(", ")}`,
      );
    }
    if (!rows.has(file)) {
      problems.push(`${file} is in no MUTATION.md row`);
    }
  }
  for (const file of rows.keys()) {
    if (!coreFiles.includes(file)) {
      problems.push(`MUTATION.md lists ${file}, which does not exist`);
    }
  }

  // Report-only: no shard's score may fail the run yet.
  const gating = workflow
    .split("\n")
    .filter((l) => !l.trim().startsWith("#") && /--check\b/.test(l));
  if (gating.length > 0) {
    problems.push(`the workflow gates on --check: ${gating[0]!.trim()}`);
  }

  return problems;
}

const workflow = readFileSync(
  join(repoRoot, ".github/workflows/mutation-nightly.yml"),
  "utf8",
);
const markdown = readFileSync(
  join(repoRoot, "packages/conformance/MUTATION.md"),
  "utf8",
);
const coreFiles = readdirSync(join(repoRoot, CORE)).filter((f) =>
  f.endsWith(".ts"),
);

describe("mutation shards: the workflow and MUTATION.md agree", () => {
  it("every core file is in exactly one shard, at its row's layer", () => {
    expect(shardProblems(workflow, markdown, coreFiles)).toEqual([]);
  });

  it("reads a real set of shards and rows", () => {
    expect(parseShards(workflow).length).toBeGreaterThanOrEqual(7);
    expect(rowLayers(markdown).size).toBe(
      coreFiles.filter((f) => !NOT_MUTATED.has(f)).length,
    );
    expect(coreFiles).toContain("engine.ts");
  });
});

describe("mutation shards: the check catches a drift", () => {
  const first = parseShards(workflow)[0]!;
  const firstFile = basename(first.entries[0]!);

  it("a file left out of every shard", () => {
    const tampered = workflow.replace(
      `packages/core/src/core/${firstFile}`,
      "",
    );
    expect(shardProblems(tampered, markdown, coreFiles).join("\n")).toContain(
      `${firstFile} is in no shard`,
    );
  });

  it("a file in two shards", () => {
    const tampered = workflow.replace(
      /(- shard: l5-sources[\s\S]*?mutate: )(\S+)/,
      `$1$2,packages/core/src/core/${firstFile}`,
    );
    expect(shardProblems(tampered, markdown, coreFiles).join("\n")).toContain(
      `${firstFile} is in 2 shards`,
    );
  });

  it("a shard whose layer is not its row's", () => {
    const tampered = workflow.replace(
      /(- shard: l5-sources\n\s+layer: )L5/,
      "$1L3",
    );
    expect(shardProblems(tampered, markdown, coreFiles).join("\n")).toMatch(
      /sources\.ts at L3, its MUTATION\.md row is L5/,
    );
  });

  it("a file the table does not list", () => {
    const tampered = markdown.replace("| sources.ts |", "| nothing |");
    expect(shardProblems(workflow, tampered, coreFiles).join("\n")).toContain(
      "sources.ts is in no MUTATION.md row",
    );
  });

  it("a new core file that nothing mentions", () => {
    expect(
      shardProblems(workflow, markdown, [...coreFiles, "brand-new.ts"]).join(
        "\n",
      ),
    ).toContain("brand-new.ts is in no shard");
  });

  it("a summary list that forgets a shard", () => {
    const tampered = workflow.replace(" l9-trace", "");
    expect(shardProblems(tampered, markdown, coreFiles).join("\n")).toContain(
      "the summary job fetches full reports",
    );
  });

  it("a gating --check on the score step", () => {
    const tampered = workflow.replace(
      "$score --layer row --full full reports",
      "$score --check --layer row --full full reports",
    );
    expect(shardProblems(tampered, markdown, coreFiles).join("\n")).toContain(
      "gates on --check",
    );
  });
});
