/**
 * Compile `contracts/types/check.ts` against built declarations: 1.35.0's
 * from the installed `directive-v1` and, as `@directive-run/core`, either the
 * workspace's `packages/core/dist` or core-next's `packages/core-next/dist`
 * (build them first). And compile the Aperture lab's three Directive files
 * (packages/core-next/scripts/fixtures/aperture/) against core-next's.
 *
 * The fixture is copied into a temporary directory with a generated tsconfig
 * whose `paths` map each specifier to its `.d.ts`, so nothing can resolve to
 * source by accident. `edit` lets a tamper test alter a copied fixture;
 * `editNext` alters a copy of core-next's declarations (core-next only).
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { ts } from "ts-morph";
import { defaultRepoRoot, v1PackageDir } from "../../lib/core-entries.js";
import { declarationEntries } from "./surface.js";

const typesDir = join(defaultRepoRoot, "packages/conformance/contracts/types");
const FIXTURES = ["check.ts", "frozen.ts"];
const coreDir = join(defaultRepoRoot, "packages/core");
const nextDir = join(defaultRepoRoot, "packages/core-next");
const apertureDir = join(nextDir, "scripts/fixtures/aperture");
/** The lab's three Directive files, relative to the Aperture fixture dir. */
export const APERTURE_FILES = [
  "schemas.ts",
  "modules/scene.ts",
  "modules/notes.ts",
];

/** The engine `@directive-run/core` resolves to. */
export type TypeEngine = "local" | "next";

type Edit = (file: string, text: string) => string;
const keep: Edit = (_, text) => text;

function pathsFor(
  pkgDir: string,
  specifier: string,
  distCopy?: string,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(declarationEntries(pkgDir)).map(([subpath, file]) => [
      subpath === "." ? specifier : `${specifier}/${subpath.slice(2)}`,
      [distCopy ? join(distCopy, relative(join(pkgDir, "dist"), file)) : file],
    ]),
  );
}

/**
 * core-next's top-level `dist/*.d.ts`, copied into `dir/next-dist` through
 * `editNext`. Throws if an edit changed nothing, so a tamper test cannot pass
 * by missing its target.
 */
function copyNextDeclarations(
  dir: string,
  editNext: Edit | undefined,
): { distCopy: string; edited: number } {
  const distCopy = join(dir, "next-dist");
  mkdirSync(distCopy);
  let edited = 0;
  for (const f of readdirSync(join(nextDir, "dist"))) {
    if (!f.endsWith(".d.ts")) {
      continue;
    }
    const text = readFileSync(join(nextDir, "dist", f), "utf8");
    const out = editNext ? editNext(f, text) : text;
    if (out !== text) {
      edited++;
    }
    writeFileSync(join(distCopy, f), out);
  }

  return { distCopy, edited };
}

function missingBuild(engine: TypeEngine): string | undefined {
  const dir = engine === "local" ? coreDir : nextDir;
  if (!existsSync(join(dir, "dist/index.d.ts"))) {
    return `${relative(defaultRepoRoot, dir)}/dist is missing: run \`pnpm --filter ${engine === "local" ? "@directive-run/core" : "@directive-run/core-next"} build\``;
  }

  return undefined;
}

/** Run tsc on `dir/tsconfig.json`: its diagnostics, "" when it compiles. */
function tsc(dir: string, compilerOptions: object, files: string[]): string {
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: false,
        types: [],
        ...compilerOptions,
      },
      files,
    }),
  );
  try {
    execFileSync(
      process.execPath,
      [
        join(defaultRepoRoot, "node_modules/typescript/bin/tsc"),
        "-p",
        join(dir, "tsconfig.json"),
      ],
      { cwd: dir, encoding: "utf8", stdio: "pipe" },
    );

    return "";
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };

    return `${e.stdout ?? ""}${e.stderr ?? ""}` || String(error);
  }
}

/** tsc's diagnostics for the fixture ("" when it compiles). */
export function compileTypeContracts(
  edit: Edit = keep,
  engine: TypeEngine = "local",
  editNext?: Edit,
): string {
  const missing = missingBuild(engine);
  if (missing) {
    return missing;
  }
  const dir = mkdtempSync(join(tmpdir(), "contracts-types-"));
  try {
    for (const f of FIXTURES) {
      writeFileSync(
        join(dir, f),
        edit(f, readFileSync(join(typesDir, f), "utf8")),
      );
    }
    let paths: Record<string, string[]>;
    if (engine === "next") {
      const { distCopy, edited } = copyNextDeclarations(dir, editNext);
      if (editNext && edited === 0) {
        throw new Error("editNext changed no core-next declaration file");
      }
      paths = pathsFor(nextDir, "@directive-run/core", distCopy);
    } else {
      paths = pathsFor(coreDir, "@directive-run/core");
    }

    return tsc(
      dir,
      { paths: { ...pathsFor(v1PackageDir, "directive-v1"), ...paths } },
      FIXTURES,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The lab's own page code (`../../scene/*`, `../../canvas`) is not in the
 * repository. Each relative import that leaves the fixture directory gets a
 * stub module exporting every name imported from it as `any` (a type and a
 * value), so the check is Directive's types and nothing else.
 */
function pageCodeStubs(
  files: Record<string, string>,
  root: string,
): Map<string, Set<string>> {
  const stubs = new Map<string, Set<string>>();
  for (const [file, text] of Object.entries(files)) {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt)) {
        continue;
      }
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text;
      if (!spec.startsWith(".")) {
        continue;
      }
      const target = resolve(dirname(join(root, file)), spec);
      if (!relative(root, target).startsWith("..")) {
        continue;
      }
      const names = stubs.get(target) ?? new Set<string>();
      const bindings = stmt.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          names.add((el.propertyName ?? el.name).text);
        }
      }
      stubs.set(target, names);
    }
  }

  return stubs;
}

/**
 * A page-code value: callable (so a callback passed to it is contextually
 * typed, not implicitly `any`), constructible and indexable.
 */
const STUB =
  "interface Stub { (...args: any[]): any; new (...args: any[]): any; [key: string]: any; }\n";

/**
 * The only diagnostics the stubs cause: callbacks whose parameters only the
 * lab's page code types (`view.rooms.map((r) => …)`, `roomIds.map((id) => …)`
 * and attachPointer's handlers), implicitly `any` once that code is a stub.
 * Exactly these, by position in the verbatim files; any other diagnostic,
 * an implicit `any` included, fails.
 */
const PAGE_CODE_CALLBACKS = [
  "modules/scene.ts(30,35)",
  "modules/scene.ts(31,56)",
  "modules/scene.ts(100,39)",
  "modules/scene.ts(324,20)",
  "modules/scene.ts(324,23)",
  "modules/scene.ts(324,26)",
  "modules/scene.ts(326,23)",
];

/** tsc's diagnostics for the Aperture lab files against core-next ("" when they compile). */
export function compileAperture(editNext?: Edit): string {
  const missing = missingBuild("next");
  if (missing) {
    return missing;
  }
  const dir = mkdtempSync(join(tmpdir(), "contracts-aperture-"));
  try {
    // Two levels deep, as in the lab (src/implementations/directive/), so the
    // page-code imports resolve inside the temporary directory.
    const root = join(dir, "src/implementations/directive");
    const files = Object.fromEntries(
      APERTURE_FILES.map((f) => [
        f,
        readFileSync(join(apertureDir, f), "utf8"),
      ]),
    );
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      writeFileSync(join(root, f), text);
    }
    for (const [target, names] of pageCodeStubs(files, root)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(
        `${target}.ts`,
        [...names]
          .sort()
          .map(
            (n) =>
              `export type ${n} = any;\nexport declare const ${n}: Stub;\n`,
          )
          .join("")
          .replace(/^/, STUB),
      );
    }
    const { distCopy, edited } = copyNextDeclarations(dir, editNext);
    if (editNext && edited === 0) {
      throw new Error("editNext changed no core-next declaration file");
    }

    const out = tsc(
      dir,
      { paths: pathsFor(nextDir, "@directive-run/core", distCopy) },
      APERTURE_FILES.map((f) => join(root, f)),
    );
    const lines = out.split("\n").filter((l) => l.trim() !== "");
    const at = (l: string) =>
      /directive\/([\w/.-]+\(\d+,\d+\)): error TS7006:/.exec(l)?.[1];
    const kept = lines.filter((l) => {
      const pos = at(l);

      return !pos || !PAGE_CODE_CALLBACKS.includes(pos);
    });
    for (const pos of PAGE_CODE_CALLBACKS) {
      if (!lines.some((l) => at(l) === pos)) {
        kept.push(
          `aperture: PAGE_CODE_CALLBACKS lists ${pos}, which no longer reports TS7006: update the list (contracts/lib/types.ts)`,
        );
      }
    }

    return kept.join("\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
