/**
 * Classify core's tests and produce each port, in memory.
 *
 * The port writes what this returns; the check re-runs it and compares, so
 * nothing the port wrote is ever trusted on its own say-so.
 *
 * A test is portable when every import resolves to something the published
 * package exposes: an entry point, or an internal module whose imported names
 * are re-exported, as the same declaration, by an entry. Such a test can run
 * against any engine that keeps the public contract.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type ImportDeclaration,
  type Node,
  Project,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import { coreEntries } from "./core-entries.js";
import {
  type FileRule,
  type Layer,
  type TestLayer,
  UnknownModuleError,
  layerTests,
} from "./layers.js";
import {
  ENVIRONMENT_REWRITES,
  NOT_ENGINE_BEHAVIOUR,
  header,
  portPath,
} from "./rewrites.js";
import { staticTests } from "./tests.js";

/**
 * - black-box: public API only. The 2.0 oracle.
 * - internals: public API plus `/internals` runtime values (manager factories,
 *   tracking). Ported and run on v1 and local; excluded from v2 until triaged,
 *   because `/internals` carries no semver promise and core-next will not ship
 *   1.35's managers.
 * - white-box: imports internal modules the package does not expose. Not ported.
 * - packaging: inspects 1.x build output, not engine behaviour. Not ported.
 */
export type Category = "black-box" | "internals" | "white-box" | "packaging";

export interface Classified {
  /** Relative to packages/core. */
  file: string;
  category: Category;
  cases: number;
  internals: string[];
  internalsValues: string[];
  typeOnlyNonPublic: string[];
  notes: string[];
}

export interface Port {
  /** Relative to packages/conformance. */
  out: string;
  /** Relative to the repo root. */
  original: string;
  /** The copy as the port writes it, before the formatter sorts imports. */
  text: string;
}

export interface LayerFile {
  category: Category;
  rule: Layer | null;
  pin?: true;
  tests: Record<string, TestLayer>;
}

export interface Classification {
  classified: Classified[];
  ports: Port[];
  layers: Record<string, LayerFile>;
  /** Problems found while classifying (unknown modules, missing rules). */
  problems: string[];
}

export interface LayerRules {
  current: Layer | null;
  rules: Record<string, FileRule>;
  [key: string]: unknown;
}

const TEST_FILE = /(\/__tests__\/[^/]+\.test\.ts|\.test-d\.ts)$/;

export function coreTestFiles(repoRoot: string): string[] {
  const coreRoot = join(repoRoot, "packages/core");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "node_modules" && name !== "dist") {
          walk(full);
        }
      } else if (TEST_FILE.test(full)) {
        out.push(full);
      }
    }
  };
  walk(join(coreRoot, "src"));
  walk(join(coreRoot, "__tests__"));

  return out.sort();
}

function countCases(text: string): number {
  return (
    text.match(
      /\b(?:it|test)(?:\.(?:each\([^)]*\)|skip|only|todo|concurrent|fails))?\s*\(/g,
    ) ?? []
  ).length;
}

export function classify(repoRoot: string): Classification {
  const coreRoot = join(repoRoot, "packages/core");
  const coreSrc = join(coreRoot, "src");
  const conformanceRoot = join(repoRoot, "packages/conformance");
  const rules = JSON.parse(
    readFileSync(join(conformanceRoot, "layers.rules.json"), "utf8"),
  ) as LayerRules;
  const problems: string[] = [];

  const project = new Project({
    tsConfigFilePath: join(coreRoot, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(join(coreSrc, "**/*.ts"));
  const testPaths = coreTestFiles(repoRoot);
  for (const path of testPaths) {
    project.addSourceFileAtPathIfExists(path);
  }

  const entries = coreEntries(repoRoot);
  const entryFiles = new Map<string, string>();
  const publicDecls = new Map<Node, string>();
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
  const isCoreFile = (file: string) =>
    file.startsWith(`${coreSrc}/`) && !TEST_FILE.test(file);

  const classified: Classified[] = [];
  const ports: Port[] = [];
  const layers: Record<string, LayerFile> = {};

  for (const path of testPaths) {
    const sf = project.getSourceFileOrThrow(path);
    const rel = relative(coreRoot, path);
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

    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (const imp of sf.getImportDeclarations()) {
      if (!imp.getModuleSpecifierValue().startsWith(".")) {
        continue;
      }
      const plan = planImport(imp, entryFiles, publicDecls, result);
      if (plan) {
        edits.push({ start: imp.getStart(), end: imp.getEnd(), text: plan });
      }
    }

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

    const out = portPath(rel);
    let body = applyEdits(text, edits);
    const helpers = new Set<string>();
    for (const rw of ENVIRONMENT_REWRITES.filter((r) => r.file === rel)) {
      if (!body.includes(rw.from)) {
        problems.push(
          `environment rewrite for ${rel} no longer matches: ${rw.from}`,
        );
        continue;
      }
      body = body.split(rw.from).join(rw.to);
      for (const h of rw.helpers) {
        helpers.add(h);
      }
      result.notes.push(`environment rewrite: ${rw.why}`);
    }
    if (helpers.size > 0) {
      body = `import { ${[...helpers].sort().join(", ")} } from "${engineHelperFor(out)}";\n${body}`;
    }
    ports.push({
      out,
      original: `packages/core/${rel}`,
      text: `${header(rel).join("\n")}\n\n${body}`,
    });

    const rule = rules.rules[out];
    if (!rule) {
      problems.push(`layers.rules.json: ${out} has no rule layer`);
    }
    try {
      layers[out] = {
        category: result.category,
        rule: rule?.rule ?? null,
        ...(rule?.pin ? { pin: true as const } : {}),
        tests: layerTests(
          sf,
          staticTests(sf),
          rule ?? { rule: "L0" },
          coreSrc,
          isCoreFile,
        ),
      };
    } catch (error) {
      if (error instanceof UnknownModuleError) {
        problems.push(`${rel}: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  for (const file of Object.keys(rules.rules)) {
    if (!ports.some((p) => p.out === file)) {
      problems.push(`layers.rules.json names ${file}, which is not a port`);
    }
  }

  return { classified, ports, layers, problems };
}

/** The import specifier for helpers/engine.ts from a port at `out`. */
export function engineHelperFor(out: string): string {
  const rel = relative(dirname(join("/c", out)), "/c/helpers/engine.js");

  return rel.startsWith(".") ? rel : `./${rel}`;
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
    for (const named of imp.getNamedImports()) {
      if (
        entrySpecifier === "@directive-run/core/internals" &&
        !imp.isTypeOnly() &&
        !named.isTypeOnly()
      ) {
        result.internalsValues.push(named.getName());
      }
    }

    return imp
      .getText()
      .replace(/(["'])[^"']+\1\s*;?\s*$/, `"${entrySpecifier}";`);
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
    let specifier: string | undefined;
    for (const decl of exported.get(name) ?? []) {
      specifier = publicDecls.get(decl);
      if (specifier) {
        break;
      }
    }
    if (!specifier) {
      if (typeOnly) {
        // Erased at runtime, so the test still runs against any engine; only
        // the suite's typecheck can tell. Recorded so it is visible.
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
