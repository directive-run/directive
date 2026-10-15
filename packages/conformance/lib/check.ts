/**
 * Prove the suite on disk is exactly what the port would produce today.
 *
 * Nothing the port wrote is trusted. The classification is re-derived from
 * packages/core in memory and compared with every committed artifact:
 *
 * 1. classification.json, manifest.json and layers.json equal a fresh run.
 * 2. Every file under tests/ is a port, and every port is on disk.
 * 3. Per port, against the fresh copy and the original:
 *    - imports: the same bindings from the same specifiers, every specifier
 *      on the allowlist (vitest, node:*, the engine helper, an exact core
 *      entry point), dynamic `import()` and `vi.mock()` specifiers included;
 *    - body: byte-identical outside the static imports;
 *    - assertions: every `expect`/`assert` call of the original, verbatim.
 * 4. Pinned correctness files: no test above its rule except through a
 *    feature listed in `allowAbove`.
 * 5. tsconfig.json is exactly the expected file: full include, core paths
 *    to their sources, strict from the base config.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import { type LayerRules, classify, engineHelperFor } from "./classify.js";
import { coreEntries } from "./core-entries.js";
import {
  allowedSpecifier,
  dynamicSpecifiers,
  importSignature,
} from "./imports.js";
import { header } from "./rewrites.js";

export interface CheckResult {
  failures: string[];
  files: number;
  assertions: number;
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The root identifier of a call chain: `expect(a).not.toBe(b)` → `expect`. */
function chainRoot(node: Node): string | undefined {
  let current: Node = node;
  for (;;) {
    if (Node.isCallExpression(current)) {
      current = current.getExpression();
    } else if (Node.isPropertyAccessExpression(current)) {
      current = current.getExpression();
    } else if (Node.isAwaitExpression(current)) {
      current = current.getExpression();
    } else if (Node.isIdentifier(current)) {
      return current.getText();
    } else {
      return undefined;
    }
  }
}

/** Outermost assertion calls: the whole `expect(x).toBe(y)`, not its parts. */
export function assertions(sf: SourceFile): string[] {
  const out: string[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const root = chainRoot(call);
    if (root !== "expect" && !root?.startsWith("assert")) {
      continue;
    }
    const parent = call.getParent();
    const isInner =
      (Node.isPropertyAccessExpression(parent) ||
        Node.isCallExpression(parent)) &&
      chainRoot(parent) === root &&
      // `expect(expect.any(Number))`-style arguments are their own chain.
      !(Node.isCallExpression(parent) && parent.getArguments().includes(call));
    if (!isInner) {
      out.push(normalise(call.getText()));
    }
  }

  return out.sort();
}

/** The file with static imports and the port header removed. */
function body(sf: SourceFile, original: string): string {
  let text = sf.getFullText();
  const cuts = sf
    .getImportDeclarations()
    .map((imp) => [imp.getFullStart(), imp.getEnd()] as const)
    .sort((a, b) => b[0] - a[0]);
  for (const [start, end] of cuts) {
    text = text.slice(0, start) + text.slice(end);
  }
  const head = new Set(header(original.replace(/^packages\/core\//, "")));

  return text
    .split("\n")
    .filter((line) => !head.has(line))
    .join("\n")
    .trim();
}

function multisetDiff(
  a: string[],
  b: string[],
): { missing: string[]; extra: string[] } {
  const counts = new Map<string, number>();
  for (const x of a) {
    counts.set(x, (counts.get(x) ?? 0) + 1);
  }
  const extra: string[] = [];
  for (const x of b) {
    const n = counts.get(x) ?? 0;
    if (n === 0) {
      extra.push(x);
    } else {
      counts.set(x, n - 1);
    }
  }
  const missing = [...counts].flatMap(([x, n]) => Array(n).fill(x) as string[]);

  return { missing, extra };
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function check(repoRoot: string): CheckResult {
  const conformanceRoot = join(repoRoot, "packages/conformance");
  const failures: string[] = [];
  const fail = (message: string) => failures.push(message);
  const fresh = classify(repoRoot);
  for (const problem of fresh.problems) {
    fail(problem);
  }

  // 1. Committed artifacts equal a fresh run.
  const manifest = Object.fromEntries(
    fresh.ports.map((p) => [p.out, p.original]),
  );
  const committed = {
    classification: readJson(
      join(conformanceRoot, "scripts/classification.json"),
    ) as Array<{ file: string }> | undefined,
    manifest: readJson(join(conformanceRoot, "scripts/manifest.json")),
    layers: (
      readJson(join(conformanceRoot, "layers.json")) as
        | { files?: Record<string, unknown> }
        | undefined
    )?.files,
  };
  if (!sameJson(committed.classification, fresh.classified)) {
    const before = new Map(
      (committed.classification ?? []).map((c) => [c.file, JSON.stringify(c)]),
    );
    const drifted = fresh.classified
      .filter((c) => before.get(c.file) !== JSON.stringify(c))
      .map((c) => c.file);
    const gone = [...before.keys()].filter(
      (f) => !fresh.classified.some((c) => c.file === f),
    );
    fail(
      `classification.json is stale or edited (${[...drifted, ...gone].join(", ") || "order"}); re-run the port`,
    );
  }
  if (!sameJson(committed.manifest, manifest)) {
    fail("manifest.json does not match a fresh port; re-run the port");
  }
  for (const [file, layer] of Object.entries(fresh.layers)) {
    if (!sameJson(committed.layers?.[file], layer)) {
      fail(`layers.json entry for ${file} does not match a fresh port`);
    }
  }
  for (const file of Object.keys(committed.layers ?? {})) {
    if (!(file in fresh.layers)) {
      fail(`layers.json names ${file}, which is not a port`);
    }
  }

  // 2. tests/ holds exactly the ports.
  const onDisk = walk(join(conformanceRoot, "tests")).map((f) =>
    relative(conformanceRoot, f),
  );
  for (const file of onDisk) {
    if (!(file in manifest)) {
      fail(`${file} is not a port of any core test`);
    }
  }
  for (const port of fresh.ports) {
    if (!onDisk.includes(port.out)) {
      fail(`${port.out} is missing; re-run the port`);
    }
  }

  // 3. Each port against the fresh copy and the original.
  const project = new Project({ useInMemoryFileSystem: true });
  const coreSpecifiers = new Set(coreEntries(repoRoot).map((e) => e.specifier));
  let assertionCount = 0;
  let files = 0;
  for (const port of fresh.ports) {
    const diskPath = join(conformanceRoot, port.out);
    const originalPath = join(repoRoot, port.original);
    if (!existsSync(diskPath)) {
      continue;
    }
    files++;
    const disk = project.createSourceFile(
      `/disk/${port.out}`,
      readFileSync(diskPath, "utf8"),
      { overwrite: true },
    );
    const regen = project.createSourceFile(`/fresh/${port.out}`, port.text, {
      overwrite: true,
    });
    const original = project.createSourceFile(
      `/original/${port.original}`,
      readFileSync(originalPath, "utf8"),
      { overwrite: true },
    );

    const helper = engineHelperFor(port.out);
    for (const imp of disk.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!allowedSpecifier(spec, coreSpecifiers, helper, "static")) {
        fail(`${port.out}: imports from ${spec}, which is not allowed`);
      }
    }
    for (const dyn of dynamicSpecifiers(disk)) {
      const [kind, spec] = dyn.split(/:(.*)/s) as [string, string];
      const allowed = allowedSpecifier(
        spec,
        coreSpecifiers,
        helper,
        kind === "import" ? "import" : "mock",
      );
      if (!allowed) {
        fail(`${port.out}: ${kind}("${spec}") is not allowed`);
      }
    }

    const imports = multisetDiff(importSignature(regen), importSignature(disk));
    for (const m of imports.missing) {
      fail(`${port.out}: import missing or changed: ${m}`);
    }
    for (const e of imports.extra) {
      fail(`${port.out}: import not in a fresh port: ${e}`);
    }
    const dynamic = multisetDiff(
      dynamicSpecifiers(regen),
      dynamicSpecifiers(disk),
    );
    for (const m of [...dynamic.missing, ...dynamic.extra]) {
      fail(`${port.out}: dynamic specifier differs: ${m}`);
    }

    if (body(regen, port.original) !== body(disk, port.original)) {
      fail(`${port.out}: differs from a fresh port outside its imports`);
    }

    const before = assertions(original);
    assertionCount += before.length;
    const diff = multisetDiff(before, assertions(disk));
    for (const m of diff.missing) {
      fail(`${port.out}: assertion missing or changed: ${m.slice(0, 160)}`);
    }
    for (const e of diff.extra) {
      fail(`${port.out}: assertion not in the original: ${e.slice(0, 160)}`);
    }
  }

  // 4. Pinned correctness files stay at their rule.
  const rules = readJson(
    join(conformanceRoot, "layers.rules.json"),
  ) as LayerRules;
  for (const [file, layer] of Object.entries(fresh.layers)) {
    const rule = rules.rules[file];
    if (!rule?.pin) {
      continue;
    }
    for (const [name, test] of Object.entries(layer.tests)) {
      const unexplained = (test.above ?? []).filter(
        (f) => !rule.allowAbove?.[f],
      );
      if (unexplained.length > 0) {
        fail(
          `${file}: "${name}" sits at ${test.layer}, above its rule ${rule.rule}, through ${unexplained.join(", ")}; add an instrument or an allowAbove reason`,
        );
      }
    }
  }

  // 5. The typecheck covers the whole suite and resolves core exactly as the
  // published entry points. The whole file is compared, so an `exclude`, a
  // narrowed `include` or a relaxed `strict` fails as surely as a bad path.
  const tsconfig = readJson(join(conformanceRoot, "tsconfig.json"));
  const want = {
    extends: "../../tsconfig.base.json",
    compilerOptions: {
      noEmit: true,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
      noUnusedLocals: false,
      types: ["node"],
      paths: Object.fromEntries(
        coreEntries(repoRoot).map((e) => [
          e.specifier,
          [relative(conformanceRoot, e.file)],
        ]),
      ),
    },
    include: ["tests", "self", "helpers", "lib", "scripts", "vitest.config.ts"],
  };
  if (!sameJson(tsconfig, want)) {
    fail(`tsconfig.json must be exactly ${JSON.stringify(want)}`);
  }
  const base = readJson(join(repoRoot, "tsconfig.base.json")) as
    | { compilerOptions?: { strict?: boolean } }
    | undefined;
  if (base?.compilerOptions?.strict !== true) {
    fail("tsconfig.base.json must keep strict: true");
  }

  return { failures, files, assertions: assertionCount };
}
