/**
 * Package-quality gate: publint (strict) + are-the-types-wrong on every
 * publishable package's built output. Run after `pnpm build`.
 *
 * Findings that need a behaviour change (not just metadata) are not fixed
 * here; they are listed in IGNORES with a reason and become follow-ups.
 * An ignore is per package and per rule, never global.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { publint } from "publint";
import { formatMessage } from "publint/utils";

interface Ignores {
  /** publint message codes to skip, e.g. "EXPORTS_MISSING_ROOT_ENTRYPOINT". */
  publint?: string[];
  /** attw rule names, e.g. "cjs-resolves-to-esm". */
  attw?: string[];
  /** Subpath exports that are not JS/types (assets), e.g. "./llms.txt". */
  attwExcludeEntrypoints?: string[];
  reason: string;
}

// publint USE_SIDE_EFFECTS: adding "sideEffects": false changes how consumer
// bundlers tree-shake, which is a behaviour change, not metadata. Follow-up:
// audit each package for import-time side effects, then add the flag.
const SIDE_EFFECTS: Ignores = {
  publint: ["USE_SIDE_EFFECTS"],
  reason:
    "sideEffects flag changes consumer tree-shaking; needs a per-package audit (follow-up).",
};

// attw cjs-resolves-to-esm: these packages ship an ESM-only entry on purpose.
// Adding a CJS build would change what is published, so it is a follow-up.
const ESM_ONLY: Ignores = {
  attw: ["cjs-resolves-to-esm"],
  reason: "ESM-only entry by design; a CJS build is a follow-up, not metadata.",
};

const IGNORES: Record<string, Ignores> = {
  "@directive-run/claude-plugin": SIDE_EFFECTS,
  "@directive-run/knowledge": SIDE_EFFECTS,
  "@directive-run/mcp": SIDE_EFFECTS,
  "@directive-run/scaffold": SIDE_EFFECTS,
  "@directive-run/cli": {
    ...SIDE_EFFECTS,
    attwExcludeEntrypoints: ["./llms.txt"],
    reason:
      "sideEffects: see SIDE_EFFECTS. ./llms.txt is a plain-text asset export, not a module; nothing for attw to resolve.",
  },
  "@directive-run/lint": { ...SIDE_EFFECTS, ...ESM_ONLY },
  "@directive-run/sandbox": { ...SIDE_EFFECTS, ...ESM_ONLY },
};

// node10 (legacy "moduleResolution") cannot resolve subpath exports without
// typesVersions shims. TypeScript 5 consumers use bundler or node16, so we
// check those two and skip the node10 column for all packages.
const ATTW_PROFILE = "node16";

const root = join(__dirname, "..");
const pkgRoot = join(root, "packages");

async function main() {
  let failures = 0;
  for (const dir of readdirSync(pkgRoot).sort()) {
    let pkg: { name: string; private?: boolean; version?: string };
    try {
      pkg = JSON.parse(
        readFileSync(join(pkgRoot, dir, "package.json"), "utf8"),
      );
    } catch {
      continue;
    }
    if (pkg.private) {
      continue;
    }

    const pkgDir = join(pkgRoot, dir);
    const ignore = IGNORES[pkg.name] ?? { reason: "" };
    const problems: string[] = [];

    const { messages } = await publint({ pkgDir, strict: true, pack: "pnpm" });
    const pkgJson = JSON.parse(
      readFileSync(join(pkgDir, "package.json"), "utf8"),
    );
    for (const m of messages) {
      if (ignore.publint?.includes(m.code)) {
        continue;
      }
      problems.push(
        `publint ${m.type} ${m.code}: ${formatMessage(m, pkgJson)}`,
      );
    }

    const attwArgs = ["exec", "attw", "--pack", pkgDir, "--format", "ascii"];
    attwArgs.push("--profile", ATTW_PROFILE);
    if (ignore.attwExcludeEntrypoints?.length) {
      attwArgs.push("--exclude-entrypoints", ...ignore.attwExcludeEntrypoints);
    }
    if (ignore.attw?.length) {
      attwArgs.push("--ignore-rules", ...ignore.attw);
    }
    const attw = spawnSync("pnpm", attwArgs, { cwd: root, encoding: "utf8" });
    if (attw.status !== 0) {
      problems.push(`attw exit ${attw.status}\n${attw.stdout}${attw.stderr}`);
    }

    if (problems.length > 0) {
      failures++;
      console.error(`FAIL ${pkg.name}\n  ${problems.join("\n  ")}`);
    } else {
      console.log(`ok   ${pkg.name}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} package(s) failed`);
    process.exit(1);
  }
}

main();
