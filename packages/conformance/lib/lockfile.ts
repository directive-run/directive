/**
 * The parts of pnpm-lock.yaml that decide which engine and runner the suite
 * gets: the conformance importer, the published core the `directive-v1`
 * alias resolves to, vitest and its @vitest packages, and every section that
 * can rewrite a resolution (settings, overrides, patches, a pnpmfile).
 *
 * A change to any of them changes the oracle; the rest of the lockfile does
 * not, so ordinary dependency bumps elsewhere do not need the label.
 */

import { createHash } from "node:crypto";

const WHOLE_SECTIONS = new Set([
  "settings",
  "overrides",
  "patchedDependencies",
  "pnpmfileChecksum",
  "catalogs",
]);
const ENTRY_SECTIONS = new Set(["importers", "packages", "snapshots"]);

function wanted(key: string): boolean {
  const k = key.replace(/^'|'$/g, "").replace(/:$/, "").replace(/'$/, "");

  return (
    k === "packages/conformance" ||
    k.startsWith("@directive-run/core@") ||
    k.startsWith("vitest@") ||
    k.startsWith("@vitest/")
  );
}

/** The oracle-relevant lines, in file order. */
export function oracleLockEntries(text: string): string {
  const out: string[] = [];
  let section = "";
  let keep = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      section = line.split(":")[0] as string;
      keep = WHOLE_SECTIONS.has(section);
      if (keep) {
        out.push(line);
      }
      continue;
    }
    if (WHOLE_SECTIONS.has(section)) {
      out.push(line);
      continue;
    }
    if (!ENTRY_SECTIONS.has(section)) {
      continue;
    }
    const entry = line.match(/^ {2}(\S.*)$/);
    if (entry) {
      keep = wanted(entry[1] as string);
      if (keep) {
        out.push(`${section}: ${line}`);
      }
    } else if (keep && line.trim() !== "") {
      out.push(line);
    }
  }

  return out.join("\n");
}

export function oracleLockHash(text: string): string {
  return createHash("sha256").update(oracleLockEntries(text)).digest("hex");
}

/** The integrity pnpm recorded for a registry package, if any. */
export function lockIntegrity(
  text: string,
  name: string,
  version: string,
): string | undefined {
  const lines = text.split("\n");
  const key = `  '${name}@${version}':`;
  const plain = `  ${name}@${version}:`;
  const at = lines.findIndex((l) => l === key || l === plain);
  if (at === -1) {
    return undefined;
  }

  return lines[at + 1]?.match(/integrity: (sha512-[^,}\s]+)/)?.[1];
}
