/**
 * The public API surface of a built `@directive-run/core`, read from its
 * published declarations: for every entry point in package.json `exports`,
 * every exported name with its declaration printed without comments.
 *
 * Read from the `.d.ts` a consumer compiles against, never from source: the
 * contract is what ships.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Project, ts } from "ts-morph";

/** subpath → export name → printed declaration(s). */
export type Surface = Record<string, Record<string, string>>;

export type ChangeKind = "added" | "removed" | "changed";

/** One approved difference from the frozen surface (contracts/api-changes.json). */
export interface ApiChange {
  entry: string;
  name: string;
  /** Additions need no entry: adding is a minor change. */
  change: "removed" | "changed";
  reason: string;
  /** Filled in by Jason, never by an agent. */
  approvedBy: string;
  date: string;
}

export interface SurfaceDiff {
  entry: string;
  name: string;
  change: ChangeKind;
}

/** Entry points (subpath → declaration file) from a package's exports. */
export function declarationEntries(pkgDir: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const out: Record<string, string> = {};
  for (const [subpath, target] of Object.entries(
    pkg.exports as Record<string, { types?: string }>,
  )) {
    if (!target.types) {
      throw new Error(`export ${subpath} of ${pkgDir} has no types`);
    }
    out[subpath] = join(pkgDir, target.types);
  }

  return out;
}

/** The surface of the built package in `pkgDir` (its `dist/` must exist). */
export function extractSurface(pkgDir: string): Surface {
  const entries = declarationEntries(pkgDir);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { strict: true, skipLibCheck: true },
  });
  const printer = ts.createPrinter({ removeComments: true });
  const surface: Surface = {};
  for (const subpath of Object.keys(entries).sort()) {
    const sf = project.addSourceFileAtPath(entries[subpath] as string);
    project.resolveSourceFileDependencies();
    const names: Record<string, string> = {};
    const exported = sf.getExportedDeclarations();
    for (const name of [...exported.keys()].sort()) {
      names[name] = (exported.get(name) ?? [])
        .map(
          (node) =>
            `${node.getKindName()} ${printer.printNode(
              ts.EmitHint.Unspecified,
              node.compilerNode,
              node.getSourceFile().compilerNode,
            )}`,
        )
        .join("\n");
    }
    surface[subpath] = names;
  }

  return surface;
}

export function diffSurface(frozen: Surface, actual: Surface): SurfaceDiff[] {
  const out: SurfaceDiff[] = [];
  const entries = new Set([...Object.keys(frozen), ...Object.keys(actual)]);
  for (const entry of [...entries].sort()) {
    const a = frozen[entry] ?? {};
    const b = actual[entry] ?? {};
    const names = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const name of [...names].sort()) {
      if (!(name in b)) {
        out.push({ entry, name, change: "removed" });
      } else if (!(name in a)) {
        out.push({ entry, name, change: "added" });
      } else if (a[name] !== b[name]) {
        out.push({ entry, name, change: "changed" });
      }
    }
  }

  return out;
}

const changeKey = (d: { entry: string; name: string; change: string }) =>
  `${d.entry} ${d.name} (${d.change})`;

/**
 * Problems: every removed or changed export must be listed in
 * api-changes.json, and every listed change must be complete, signed
 * (approvedBy) and still occur. Additions pass (semver minor); the 2.0 surface
 * still has to carry them, so the test prints them.
 */
export function checkSurface(
  frozen: Surface,
  actual: Surface,
  changes: readonly ApiChange[],
): string[] {
  const failures: string[] = [];
  const listed = new Map(changes.map((c) => [changeKey(c), c]));
  for (const c of changes) {
    for (const field of ["reason", "approvedBy", "date"] as const) {
      if (typeof c[field] !== "string" || c[field].trim() === "") {
        failures.push(`api-changes.json: ${changeKey(c)} has no ${field}`);
      }
    }
  }
  const seen = new Set<string>();
  for (const d of diffSurface(frozen, actual)) {
    if (d.change === "added") {
      continue;
    }
    seen.add(changeKey(d));
    if (!listed.has(changeKey(d))) {
      failures.push(
        `public API ${changeKey(d)} differs from the 1.35 snapshot and is not in contracts/api-changes.json`,
      );
    }
  }
  for (const k of listed.keys()) {
    if (!seen.has(k)) {
      failures.push(`api-changes.json: ${k} is stale (no such difference)`);
    }
  }

  return failures;
}
