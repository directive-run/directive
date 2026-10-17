/**
 * Install smoke test: pack core + the react adapter, install the tarballs into
 * a fresh project with plain npm, then prove a consumer can use them.
 *
 *  1. Every JS entry in each package's `exports` loads by ESM import and CJS
 *     require (conditions that name only one format are checked for that one).
 *  2. A tiny file importing the main types type-checks under both
 *     moduleResolution "bundler" and "node16" (as ESM and as CJS).
 *
 * Run after `pnpm build`. Uses the repo's own tsc; installs nothing else
 * except react + its types, which the adapter needs as peers.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(__dirname, "..");
const PACKAGES = ["core", "react"];

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: "pipe" });
}

type Condition = string | { [k: string]: Condition };

/** Collect the JS file targets by format for one exports entry. */
function targets(c: Condition, fmt: "import" | "require"): string[] {
  if (typeof c === "string") {
    return /\.(c|m)?js$/.test(c) ? [c] : [];
  }
  const out: string[] = [];
  for (const [key, value] of Object.entries(c)) {
    if (key === "types" || key === "development" || key === "production") {
      continue;
    }
    if (key === "import" || key === "require") {
      if (key === fmt) {
        out.push(...targets(value, fmt));
      }
      continue;
    }
    out.push(...targets(value, fmt));
  }

  return out;
}

const tmp = mkdtempSync(join(tmpdir(), "directive-smoke-"));
const failures: string[] = [];

try {
  const packDir = join(tmp, "tarballs");
  const app = join(tmp, "app");
  mkdirSync(packDir);
  mkdirSync(app);

  const tarballs: string[] = [];
  const names: string[] = [];
  const exportMaps: Record<string, Record<string, Condition>> = {};
  for (const dir of PACKAGES) {
    const pkgDir = join(root, "packages", dir);
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    names.push(pkg.name);
    exportMaps[pkg.name] = pkg.exports;
    run("pnpm", ["pack", "--pack-destination", packDir], pkgDir);
  }
  for (const f of readdirSync(packDir)) {
    tarballs.push(join(packDir, f));
  }
  console.log(`packed: ${readdirSync(packDir).join(", ")}`);

  writeFileSync(
    join(app, "package.json"),
    JSON.stringify({ name: "smoke-app", private: true, version: "0.0.0" }),
  );
  run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      "react@^18",
      "@types/react@^18",
      ...tarballs,
    ],
    app,
  );

  // (a) runtime: ESM import + CJS require of every listed entry point.
  for (const name of names) {
    for (const [sub, cond] of Object.entries(exportMaps[name])) {
      const spec = sub === "." ? name : `${name}/${sub.slice(2)}`;
      if (targets(cond, "import").length > 0) {
        try {
          run(
            "node",
            [
              "--input-type=module",
              "-e",
              `await import(${JSON.stringify(spec)})`,
            ],
            app,
          );
        } catch (e) {
          failures.push(`ESM import ${spec}: ${(e as Error).message}`);
        }
      }
      if (targets(cond, "require").length > 0) {
        try {
          run("node", ["-e", `require(${JSON.stringify(spec)})`], app);
        } catch (e) {
          failures.push(`CJS require ${spec}: ${(e as Error).message}`);
        }
      }
    }
  }

  // (b) types: main entry types under bundler and node16 (ESM and CJS).
  const source = [
    'import { createModule, createSystem, t } from "@directive-run/core";',
    'import { useFact } from "@directive-run/react";',
    'export const m = createModule("smoke", { schema: { facts: { n: t.number() } } });',
    "export const s = createSystem({ module: m });",
    "export const hook: typeof useFact = useFact;",
    "",
  ].join("\n");
  const tsc = join(root, "node_modules", ".bin", "tsc");
  const cases: Array<{
    label: string;
    file: string;
    pkgType: string;
    opts: string[];
  }> = [
    {
      label: "bundler",
      file: "check-bundler.ts",
      pkgType: "module",
      opts: ["--module", "esnext", "--moduleResolution", "bundler"],
    },
    {
      label: "node16 ESM",
      file: "check-node16-esm.ts",
      pkgType: "module",
      opts: ["--module", "node16", "--moduleResolution", "node16"],
    },
    {
      label: "node16 CJS",
      file: "check-node16-cjs.cts",
      pkgType: "commonjs",
      opts: ["--module", "node16", "--moduleResolution", "node16"],
    },
  ];
  for (const c of cases) {
    const dir = join(tmp, `types-${c.label.replace(/ /g, "-")}`);
    mkdirSync(dir);
    // Reuse the installed node_modules; only the "type" field differs.
    run(
      "ln",
      ["-s", join(app, "node_modules"), join(dir, "node_modules")],
      dir,
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "types-app", private: true, type: c.pkgType }),
    );
    writeFileSync(join(dir, c.file), source);
    try {
      run(
        tsc,
        [
          "--noEmit",
          "--strict",
          "--skipLibCheck",
          "--target",
          "es2022",
          "--jsx",
          "react-jsx",
          ...c.opts,
          c.file,
        ],
        dir,
      );
    } catch (e) {
      const err = e as { stdout?: string; message: string };
      failures.push(`tsc ${c.label}: ${err.stdout ?? err.message}`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`install smoke FAILED (${failures.length}):`);
  for (const f of failures) {
    console.error(`- ${f}`);
  }
  process.exit(1);
}

console.log("install smoke ok");
