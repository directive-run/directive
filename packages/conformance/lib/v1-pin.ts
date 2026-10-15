/**
 * Is the installed reference engine exactly the npm release?
 *
 * `v1-pin.json` (scripts/pin-v1.ts) holds the version, the tarball integrity
 * npm serves, and the sha256 of every file in it. The installed package must
 * match file for file, and the lockfile must still name that integrity — so
 * an override, a patch, or an edit inside node_modules fails.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { lockIntegrity } from "./lockfile.js";

export interface V1Pin {
  version: string;
  integrity: string;
  files: Record<string, string>;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);

    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

export function checkV1Pin(options: {
  pin: V1Pin;
  pinnedVersion: string;
  lockfile: string;
  packageDir: string;
}): string[] {
  const { pin, pinnedVersion, lockfile } = options;
  const failures: string[] = [];
  if (pin.version !== pinnedVersion) {
    failures.push(
      `v1-pin.json is for ${pin.version}; the alias pins ${pinnedVersion} (run pin:v1)`,
    );
  }
  const recorded = lockIntegrity(lockfile, "@directive-run/core", pin.version);
  if (recorded !== pin.integrity) {
    failures.push(
      `pnpm-lock.yaml records ${recorded ?? "no integrity"} for @directive-run/core@${pin.version}; the npm tarball is ${pin.integrity}`,
    );
  }
  const dir = realpathSync(options.packageDir);
  const installed = new Map(
    walk(dir).map((f) => [
      relative(dir, f),
      createHash("sha256").update(readFileSync(f)).digest("hex"),
    ]),
  );
  for (const [file, hash] of Object.entries(pin.files)) {
    const actual = installed.get(file);
    if (actual === undefined) {
      failures.push(`directive-v1 is missing ${file}`);
    } else if (actual !== hash) {
      failures.push(`directive-v1/${file} differs from the npm tarball`);
    }
  }
  for (const file of installed.keys()) {
    if (!(file in pin.files)) {
      failures.push(`directive-v1/${file} is not in the npm tarball`);
    }
  }

  return failures;
}
