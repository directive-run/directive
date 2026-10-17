/**
 * Compile `contracts/types/check.ts` against built declarations: 1.35.0's
 * from the installed `directive-v1` and the workspace's from
 * `packages/core/dist` (run `pnpm --filter @directive-run/core build` first).
 *
 * The fixture is copied into a temporary directory with a generated tsconfig
 * whose `paths` map each specifier to its `.d.ts`, so nothing can resolve to
 * source by accident. `edit` lets a tamper test alter a copied file.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultRepoRoot, v1PackageDir } from "../../lib/core-entries.js";
import { declarationEntries } from "./surface.js";

const typesDir = join(defaultRepoRoot, "packages/conformance/contracts/types");
const FIXTURES = ["check.ts", "frozen.ts"];

function pathsFor(pkgDir: string, specifier: string): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(declarationEntries(pkgDir)).map(([subpath, file]) => [
      subpath === "." ? specifier : `${specifier}/${subpath.slice(2)}`,
      [file],
    ]),
  );
}

/** tsc's diagnostics for the fixture ("" when it compiles). */
export function compileTypeContracts(
  edit: (file: string, text: string) => string = (_, text) => text,
): string {
  const coreDir = join(defaultRepoRoot, "packages/core");
  if (!existsSync(join(coreDir, "dist/index.d.ts"))) {
    return "packages/core/dist is missing: run `pnpm --filter @directive-run/core build`";
  }
  const dir = mkdtempSync(join(tmpdir(), "contracts-types-"));
  try {
    for (const f of FIXTURES) {
      writeFileSync(
        join(dir, f),
        edit(f, readFileSync(join(typesDir, f), "utf8")),
      );
    }
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
          paths: {
            ...pathsFor(v1PackageDir, "directive-v1"),
            ...pathsFor(coreDir, "@directive-run/core"),
          },
        },
        files: FIXTURES,
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
