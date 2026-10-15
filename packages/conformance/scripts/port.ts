/**
 * Port core's black-box tests into the conformance suite.
 *
 * A test is black-box when every import resolves to something the published
 * package exposes: an entry point (`.`, `/plugins`, `/testing`, `/internals`,
 * `/adapter-utils`, `/worker`, `/migration`) or an internal module whose
 * imported names are re-exported, as the same declaration, by one of those
 * entries. Such a test can run against any engine that keeps the public
 * contract, which is what makes it an oracle for 2.0.
 *
 * The port COPIES (core keeps its own tests on 1.x) and rewrites only module
 * specifiers. Nothing else in a test may change; `check-expects.ts` enforces
 * that every assertion survives verbatim. The one other rewrite is listed in
 * ENVIRONMENT_REWRITES and exists because a test computes a path to core's
 * built `dist/` relative to its own location, which a copy would break.
 *
 * Re-runnable: it regenerates `tests/`, `scripts/manifest.json` and
 * `scripts/classification.json` from scratch every time.
 *
 * Usage: pnpm --filter @directive-run/conformance port
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ImportDeclaration,
  type Node,
  Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

import { coreEntries, coreRoot } from "../core-entries.js";

const here = dirname(fileURLToPath(import.meta.url));
const conformanceRoot = resolve(here, "..");
const coreSrc = join(coreRoot, "src");
const testsOut = join(conformanceRoot, "tests");

const publicEntries = coreEntries;

/**
 * The only non-specifier rewrites the port makes. Each one replaces code that
 * locates core's built `dist/` relative to the test's own path with a helper
 * that asks the engine under test where its build lives.
 */
const ENVIRONMENT_REWRITES: Array<{
  file: string;
  from: string;
  to: string;
  why: string;
}> = [
  {
    file: "core/__tests__/superseded-bodies-and-retry-timer.test.ts",
    from: 'join(here, "../../../dist/index.js")',
    to: "engineDistEntry()",
    why: "The child-process exit test imports core's built ESM entry by a path relative to the test file. The copy asks the engine under test for its dist entry instead.",
  },
];

/** Tests that read core's build output rather than exercising behaviour. */
const NOT_ENGINE_BEHAVIOUR = new Map<string, string>([
  [
    "__tests__/dev-mode-bundle.test.ts",
    "Reads core's dist/ files and package.json to check what each build ships. A packaging test for the 1.x build, not engine behaviour; 2.0 gets its own size and dev-text gates.",
  ],
]);

/**
 * - black-box: public API only. The 2.0 oracle.
 * - internals: public API plus `/internals` runtime values (manager factories,
 *   tracking). Ported and run on v1 and local, but `/internals` carries no
 *   semver guarantee and core-next will not ship 1.35's managers, so each one
 *   needs triage before it counts toward v2.
 * - white-box: imports internal modules the package does not expose. Not ported.
 * - packaging: inspects build output, not engine behaviour. Not ported.
 */
type Category = "black-box" | "internals" | "white-box" | "packaging";

interface Classified {
  file: string;
  category: Category;
  cases: number;
  internals: string[];
  internalsValues: string[];
  typeOnlyNonPublic: string[];
  notes: string[];
}

function countCases(text: string): number {
  return (
    text.match(
      /\b(?:it|test)(?:\.(?:each\([^)]*\)|skip|only|todo|concurrent|fails))?\s*\(/g,
    ) ?? []
  ).length;
}

function main(): void {
  const entries = publicEntries();
  const project = new Project({
    tsConfigFilePath: join(coreRoot, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(join(coreSrc, "**/*.ts"));

  const entryFiles = new Map<string, string>(); // abs file → specifier
  const publicDecls = new Map<Node, string>(); // declaration → first specifier
  for (const entry of entries) {
    const sf = project.getSourceFileOrThrow(entry.file);
    if (!entryFiles.has(entry.file)) {
      entryFiles.set(entry.file, entry.specifier);
    }
    for (const [, decls] of sf.getExportedDeclarations()) {
      for (const decl of decls) {
        if (!publicDecls.has(decl)) {
          publicDecls.set(decl, entry.specifier);
        }
      }
    }
  }

  const testFiles = project
    .getSourceFiles()
    .filter((sf) => /\/__tests__\/[^/]+\.test\.ts$/.test(sf.getFilePath()));

  rmSync(testsOut, { recursive: true, force: true });
  const manifest: Record<string, string> = {};
  const classified: Classified[] = [];

  for (const sf of testFiles) {
    const rel = relative(coreSrc, sf.getFilePath());
    const text = sf.getFullText();
    const result: Classified = {
      file: rel,
      category: "black-box",
      cases: countCases(text),
      internals: [],
      internalsValues: [],
      typeOnlyNonPublic: [],
      notes: [],
    };
    classified.push(result);

    const notBehaviour = NOT_ENGINE_BEHAVIOUR.get(rel);
    if (notBehaviour) {
      result.category = "packaging";
      result.notes.push(notBehaviour);
      continue;
    }

    // Plan the specifier rewrites without mutating the original.
    const edits: Array<{ start: number; end: number; text: string }> = [];

    for (const imp of sf.getImportDeclarations()) {
      const spec = imp.getModuleSpecifierValue();
      if (!spec.startsWith(".")) {
        continue;
      }
      const plan = planImport(imp, entryFiles, publicDecls, result);
      if (plan) {
        edits.push({ start: imp.getStart(), end: imp.getEnd(), text: plan });
      }
    }

    // Dynamic `await import("../../index.js")` — used by the production tests.
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) {
        continue;
      }
      const arg = call.getArguments()[0];
      if (!arg || arg.getKind() !== SyntaxKind.StringLiteral) {
        continue;
      }
      const spec = arg.getText().slice(1, -1);
      if (!spec.startsWith(".")) {
        continue;
      }
      const target = resolveRelative(sf, spec);
      const specifier = target ? entryFiles.get(target) : undefined;
      if (specifier) {
        edits.push({
          start: arg.getStart(),
          end: arg.getEnd(),
          text: JSON.stringify(specifier),
        });
      } else {
        result.category = "white-box";
        result.internals.push(`dynamic import ${spec}`);
      }
    }

    if (result.category !== "black-box") {
      continue;
    }
    if (result.internalsValues.length > 0) {
      result.category = "internals";
    }

    let out = applyEdits(text, edits);
    for (const rw of ENVIRONMENT_REWRITES.filter((r) => r.file === rel)) {
      if (!out.includes(rw.from)) {
        throw new Error(
          `port: environment rewrite for ${rel} no longer matches`,
        );
      }
      out = out.split(rw.from).join(rw.to);
      const helper = relative(
        dirname(join(testsOut, outPath(rel))),
        join(conformanceRoot, "helpers/engine.ts"),
      ).replace(/\.ts$/, ".js");
      out = `import { engineDistEntry } from "${helper.startsWith(".") ? helper : `./${helper}`}";\n${out}`;
      result.notes.push(`environment rewrite: ${rw.why}`);
    }

    const dest = join(testsOut, outPath(rel));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(
      dest,
      `// Ported from packages/core/src/${rel} by packages/conformance/scripts/port.ts.\n// Do not edit by hand: change the original and re-run the port.\n\n${out}`,
    );
    manifest[relative(conformanceRoot, dest)] = `packages/core/src/${rel}`;
  }

  writeFileSync(
    join(here, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(
    join(here, "classification.json"),
    `${JSON.stringify(classified, null, 2)}\n`,
  );

  // Rewritten import lines are not in sorted order. Let the repo's formatter
  // settle them so `pnpm lint` stays clean. check-expects strips imports
  // before comparing and flags anything else the formatter changed. Paths are
  // relative to the repo root: biome.json ignores any path containing
  // `worktrees`, so an absolute path inside a git worktree is skipped.
  const repoRoot = resolve(conformanceRoot, "../..");
  execFileSync(
    join(repoRoot, "node_modules/.bin/biome"),
    [
      "check",
      "--write",
      relative(repoRoot, testsOut),
      relative(repoRoot, join(here, "manifest.json")),
      relative(repoRoot, join(here, "classification.json")),
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );

  const count = (c: Category) => classified.filter((x) => x.category === c);
  const sum = (xs: Classified[]) => xs.reduce((n, x) => n + x.cases, 0);
  console.log(
    `[port] ${testFiles.length} files: black-box ${count("black-box").length} (${sum(count("black-box"))} cases), internals ${count("internals").length} (${sum(count("internals"))} cases), white-box ${count("white-box").length} (${sum(count("white-box"))} cases), packaging ${count("packaging").length}`,
  );
}

/** `core/__tests__/x.test.ts` → `core/x.test.ts`. */
function outPath(rel: string): string {
  const parts = rel.split("/").filter((p) => p !== "__tests__");
  if (parts.length === 1) {
    return join("root", parts[0] as string);
  }

  return parts.join("/");
}

function resolveRelative(sf: SourceFile, spec: string): string | undefined {
  const base = resolve(dirname(sf.getFilePath()), spec).replace(/\.js$/, "");
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Rewrite one relative import to public specifiers, or mark the test
 * white-box. Returns the replacement text, or undefined for no change.
 */
function planImport(
  imp: ImportDeclaration,
  entryFiles: Map<string, string>,
  publicDecls: Map<Node, string>,
  result: Classified,
): string | undefined {
  const spec = imp.getModuleSpecifierValue();
  const target = imp.getModuleSpecifierSourceFile();
  const targetPath = target?.getFilePath();
  const entrySpecifier = targetPath ? entryFiles.get(targetPath) : undefined;

  if (entrySpecifier) {
    const text = imp.getText();

    return text.replace(/(["'])[^"']+\1\s*;?\s*$/, `"${entrySpecifier}";`);
  }

  if (!target) {
    result.category = "white-box";
    result.internals.push(`${spec} (unresolved)`);

    return undefined;
  }

  if (imp.getDefaultImport() || imp.getNamespaceImport()) {
    result.category = "white-box";
    result.internals.push(`${spec} (default/namespace import)`);

    return undefined;
  }

  const declTypeOnly = imp.isTypeOnly();
  const exported = target.getExportedDeclarations();
  const groups = new Map<string, string[]>();

  for (const named of imp.getNamedImports()) {
    const name = named.getName();
    const alias = named.getAliasNode()?.getText();
    const typeOnly = declTypeOnly || named.isTypeOnly();
    const decls = exported.get(name) ?? [];
    let specifier: string | undefined;
    for (const decl of decls) {
      specifier = publicDecls.get(decl);
      if (specifier) {
        break;
      }
    }
    if (!specifier) {
      if (typeOnly) {
        // Erased at runtime, so the test still runs against any engine. It
        // only matters for type-checking the suite; recorded for that.
        specifier = "@directive-run/core";
        result.typeOnlyNonPublic.push(`${name} from ${spec}`);
      } else {
        result.category = "white-box";
        result.internals.push(`${name} from ${spec}`);
        continue;
      }
    }
    if (specifier === "@directive-run/core/internals" && !typeOnly) {
      result.internalsValues.push(name);
    }
    const piece = `${typeOnly && !declTypeOnly ? "type " : ""}${name}${alias ? ` as ${alias}` : ""}`;
    const list = groups.get(specifier) ?? [];
    list.push(piece);
    groups.set(specifier, list);
  }

  if (result.category !== "black-box") {
    return undefined;
  }

  return [...groups]
    .map(
      ([specifier, names]) =>
        `import ${declTypeOnly ? "type " : ""}{ ${names.join(", ")} } from "${specifier}";`,
    )
    .join("\n");
}

function applyEdits(
  text: string,
  edits: Array<{ start: number; end: number; text: string }>,
): string {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }

  return out;
}

main();
