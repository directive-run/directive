/**
 * The public API surface of a built `@directive-run/core`, read from its
 * published declarations: for every entry point in package.json `exports`,
 * every exported name with its declaration printed without comments.
 *
 * Read from the `.d.ts` a consumer compiles against, never from source: the
 * contract is what ships.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Node, Project, SymbolFlags, SyntaxKind, ts } from "ts-morph";

/** subpath → export name → printed declaration(s). */
export type Surface = Record<string, Record<string, string>>;

export type ChangeKind = "added" | "removed" | "changed";

/** An approved removal or change of a frozen export. */
export interface ApiRemovalOrChange {
  entry: string;
  name: string;
  change: "removed" | "changed";
  reason: string;
  /** Filled in by Jason, never by an agent. */
  approvedBy: string;
  date: string;
}

/**
 * A listed addition. New exports must be listed (the 2.0 surface has to carry
 * them). `approvedBy: null` with `status: "pending-gate"` passes but is
 * printed as a pending approval until Jason signs it at the Phase 0 gate.
 */
export interface ApiAddition {
  kind: "add";
  /** "<entry> <name>", e.g. "./plugins ClobberSummaryEvent". */
  export: string;
  reason: string;
  approvedBy: string | null;
  status?: "pending-gate";
  date?: string;
}

export type ApiChange = ApiRemovalOrChange | ApiAddition;

const isAdd = (c: ApiChange): c is ApiAddition =>
  (c as ApiAddition).kind === "add";

/** Referenced-but-unexported declarations are snapshotted under this prefix. */
export const REF_PREFIX = "#ref:";

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

/** File name without the chunk hash the bundler appends. */
const moduleName = (file: string, pkgDir: string) =>
  relative(pkgDir, file).replace(/-[A-Za-z0-9_-]{8}(?=\.d\.c?ts$)/, "");

/** The surface of the built package in `pkgDir` (its `dist/` must exist). */
export function extractSurface(pkgDir: string): Surface {
  const entries = declarationEntries(pkgDir);
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { strict: true, skipLibCheck: true },
  });
  const printer = ts.createPrinter({ removeComments: true });
  const distDir = join(pkgDir, "dist");
  const print = (node: Node) =>
    `${node.getKindName()} ${printer.printNode(
      ts.EmitHint.Unspecified,
      node.compilerNode,
      node.getSourceFile().compilerNode,
    )}`;
  const isTopLevel = (node: Node) => {
    const parent = node.getParent();
    if (Node.isVariableDeclaration(node)) {
      return Node.isSourceFile(
        parent?.getParent()?.getParent() as Node | undefined,
      );
    }

    return Node.isSourceFile(parent);
  };
  const surface: Surface = {};
  for (const subpath of Object.keys(entries).sort()) {
    const sf = project.addSourceFileAtPath(entries[subpath] as string);
    project.resolveSourceFileDependencies();
    const names: Record<string, string> = {};
    const exported = sf.getExportedDeclarations();
    const exportedNodes = new Set<Node>();
    const queue: Node[] = [];
    const visited = new Set<Node>();
    for (const name of [...exported.keys()].sort()) {
      const nodes = exported.get(name) ?? [];
      names[name] = nodes.map(print).join("\n");
      for (const n of nodes) {
        exportedNodes.add(n);
        queue.push(n);
      }
    }
    // Transitively snapshot every declaration an export refers to, whether or
    // not it is exported: its shape is part of the contract.
    const refs = new Map<string, string[]>();
    while (queue.length > 0) {
      const node = queue.pop() as Node;
      if (visited.has(node)) {
        continue;
      }
      visited.add(node);
      for (const id of node.getDescendantsOfKind(SyntaxKind.Identifier)) {
        let sym = id.getSymbol();
        if (sym?.hasFlags(SymbolFlags.Alias)) {
          sym = sym.getAliasedSymbol() ?? sym;
        }
        for (const decl of sym?.getDeclarations() ?? []) {
          const file = decl.getSourceFile().getFilePath();
          if (
            !file.startsWith(distDir) ||
            !isTopLevel(decl) ||
            exportedNodes.has(decl) ||
            visited.has(decl)
          ) {
            continue;
          }
          const key = `${REF_PREFIX}${moduleName(file, pkgDir)}:${sym?.getName()}`;
          const printed = print(decl);
          const list = refs.get(key) ?? [];
          if (!list.includes(printed)) {
            list.push(printed);
          }
          refs.set(key, list);
          queue.push(decl);
        }
      }
    }
    for (const [key, list] of refs) {
      names[key] = list.sort().join("\n");
    }
    surface[subpath] = Object.fromEntries(
      Object.keys(names)
        .sort()
        .map((k) => [k, names[k] as string]),
    );
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
        // A once-unexported type that is now exported moved, it did not go.
        const promoted = name.startsWith(REF_PREFIX)
          ? b[name.slice(name.lastIndexOf(":") + 1)]
          : undefined;
        if (promoted !== undefined) {
          if (promoted !== a[name]) {
            out.push({ entry, name, change: "changed" });
          }
          continue;
        }
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

/** Additions listed with no signature yet, for the census to print. */
export function pendingApprovals(changes: readonly ApiChange[]): string[] {
  return changes
    .filter((c) => c.approvedBy === null || c.approvedBy === "")
    .map((c) =>
      isAdd(c)
        ? `add ${c.export}: ${c.reason}`
        : `${c.change} ${c.entry} ${c.name}: ${c.reason}`,
    );
}

/**
 * Problems: every removed or changed export must be listed in
 * api-changes.json, signed (approvedBy); every added export must be listed
 * too (kind "add"), signed or `status: "pending-gate"` with approvedBy null;
 * and every listed entry must still occur. Referenced-but-unexported
 * declarations (`#ref:` keys) are held to the same removed/changed rule; a new
 * one needs no entry (the export that reaches it is what changed).
 */
export function checkSurface(
  frozen: Surface,
  actual: Surface,
  changes: readonly ApiChange[],
): string[] {
  const failures: string[] = [];
  const listed = new Map<string, ApiChange>();
  for (const c of changes) {
    const key = isAdd(c) ? `${c.export} (added)` : changeKey(c);
    listed.set(key, c);
    if (typeof c.reason !== "string" || c.reason.trim() === "") {
      failures.push(`api-changes.json: ${key} has no reason`);
    }
    const signed =
      typeof c.approvedBy === "string" && c.approvedBy.trim() !== "";
    if (isAdd(c)) {
      if (!signed && !(c.approvedBy === null && c.status === "pending-gate")) {
        failures.push(
          `api-changes.json: ${key} has no approvedBy and is not pending-gate`,
        );
      }
    } else {
      if (!signed) {
        failures.push(`api-changes.json: ${key} has no approvedBy`);
      }
      if (typeof c.date !== "string" || c.date.trim() === "") {
        failures.push(`api-changes.json: ${key} has no date`);
      }
    }
  }
  const seen = new Set<string>();
  for (const d of diffSurface(frozen, actual)) {
    if (d.change === "added") {
      if (d.name.startsWith(REF_PREFIX)) {
        continue;
      }
      const key = `${d.entry} ${d.name} (added)`;
      seen.add(key);
      if (!listed.has(key)) {
        failures.push(
          `public API ${key} is new since 1.35 and is not listed in contracts/api-changes.json`,
        );
      }
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
