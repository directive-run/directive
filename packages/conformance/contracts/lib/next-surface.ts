/**
 * The core-next surface gate: core-next's BUILT public API, at the layer it
 * has built, held to the frozen 1.35 surface (contracts/api-surface.json).
 * The alphas promise 1.35's API; additions land at beta (contracts/STABILITY.md).
 *
 * - A 1.35 name core-next lacks fails, unless its feature's layer is above
 *   layers.rules.json `current` (an unbuilt feature: importing it already
 *   fails at build or link time) or a signed removal in api-changes.json
 *   covers it. The layer is lib/layers.ts layerOfExport, placed by the module
 *   that declares the name in packages/core/src, as per-test placement does.
 *   A missing name the tables do not place fails until they do.
 * - A name 1.35 lacks fails, unless a signed api-changes.json addition covers
 *   it. `pending-gate` does not count here, and an agent never signs.
 * - An entry core-next does not ship yet is listed, not failed.
 * - Signature drift is reported, not failed: a shared name whose printed
 *   declaration differs from 1.35's apart from the type bundler's `$N`
 *   renames. check.ts compiled against core-next (contracts/lib/types.ts) is
 *   the usage-level gate. `#ref:` keys are not compared: they are keyed by
 *   chunk file, which differs between the two builds.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Project } from "ts-morph";
import { coreEntries } from "../../lib/core-entries.js";
import { type Layer, layerIndex, layerOfExport } from "../../lib/layers.js";
import {
  type ApiChange,
  REF_PREFIX,
  type Surface,
  extractSurface,
} from "./surface.js";

/** Where a 1.35 export lives in packages/core/src, and its layer. */
export interface ExportLayer {
  /** Declaring module, relative to packages/core/src. */
  module: string;
  layer: Layer | undefined;
}

/** `<entry> <name>` → layer, for every frozen name of the given entries. */
export type ExportLayers = Map<string, ExportLayer>;

export interface NextSurfaceResult {
  failures: string[];
  /** Missing names accepted because their layer is above `current`. */
  unbuilt: { entry: string; name: string; layer: Layer }[];
  /** Frozen entries core-next does not ship yet. */
  unshipped: string[];
  /** Shared names whose declaration differs from 1.35's (reported only). */
  drift: { entry: string; name: string; v1: string; next: string }[];
}

/** The type bundler suffixes a clashing local name with `$N` (`Schema$1`). */
export const withoutBundlerRenames = (decl: string): string =>
  decl.replace(/\b([A-Za-z_][\w]*)\$\d+\b/g, "$1");

const isSigned = (c: ApiChange): boolean =>
  typeof c.approvedBy === "string" && c.approvedBy.trim() !== "";

/** The layer of every frozen (non-`#ref:`) name of `entries`. */
export function exportLayers(
  repoRoot: string,
  frozen: Surface,
  entries: readonly string[],
): ExportLayers {
  const coreSrc = join(repoRoot, "packages/core/src");
  const project = new Project({
    tsConfigFilePath: join(repoRoot, "packages/core/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });
  const out: ExportLayers = new Map();
  for (const entry of coreEntries(repoRoot)) {
    if (!entries.includes(entry.subpath)) {
      continue;
    }
    const sf = project.addSourceFileAtPath(entry.file);
    project.resolveSourceFileDependencies();
    const exported = sf.getExportedDeclarations();
    for (const name of Object.keys(frozen[entry.subpath] ?? {})) {
      if (name.startsWith(REF_PREFIX)) {
        continue;
      }
      const decl = (exported.get(name) ?? [])[0];
      const module = decl
        ? relative(coreSrc, decl.getSourceFile().getFilePath())
        : "(not exported by packages/core/src)";
      out.set(`${entry.subpath} ${name}`, {
        module,
        layer: decl ? layerOfExport(name, module) : undefined,
      });
    }
  }

  return out;
}

/** layers.rules.json `current`: the highest layer core-next has built. */
export function currentLayer(conformanceRoot: string): Layer | null {
  return JSON.parse(
    readFileSync(join(conformanceRoot, "layers.rules.json"), "utf8"),
  ).current as Layer | null;
}

export function checkNextSurface(
  frozen: Surface,
  next: Surface,
  changes: readonly ApiChange[],
  current: Layer | null,
  layers: ExportLayers,
): NextSurfaceResult {
  const result: NextSurfaceResult = {
    failures: [],
    unbuilt: [],
    unshipped: [],
    drift: [],
  };
  const built = current === null ? -1 : layerIndex(current);
  const signedAdd = new Set<string>();
  const signedRemove = new Set<string>();
  for (const c of changes) {
    if (!isSigned(c)) {
      continue;
    }
    if ("kind" in c && c.kind === "add") {
      signedAdd.add(c.export);
    } else if ("change" in c && c.change === "removed") {
      signedRemove.add(`${c.entry} ${c.name}`);
    }
  }
  result.unshipped = Object.keys(frozen)
    .filter((entry) => !(entry in next))
    .sort();
  for (const entry of Object.keys(next).sort()) {
    const v1 = frozen[entry] ?? {};
    const v2 = next[entry] ?? {};
    const names = new Set([...Object.keys(v1), ...Object.keys(v2)]);
    for (const name of [...names].sort()) {
      if (name.startsWith(REF_PREFIX)) {
        continue;
      }
      const key = `${entry} ${name}`;
      if (!(name in v2)) {
        if (signedRemove.has(key)) {
          continue;
        }
        const placed = layers.get(key);
        if (!placed?.layer) {
          result.failures.push(
            `core-next ${key} (missing): no layer for it (declared in ${placed?.module ?? "an unknown module"}); add it to NAME_LAYERS or MODULE_LAYERS in lib/layers.ts`,
          );
        } else if (layerIndex(placed.layer) > built) {
          result.unbuilt.push({ entry, name, layer: placed.layer });
        } else {
          result.failures.push(
            `core-next ${key} (missing): 1.35 exports it and its layer ${placed.layer} is built (current ${current})`,
          );
        }
      } else if (!(name in v1)) {
        if (!signedAdd.has(key)) {
          result.failures.push(
            `core-next ${key} (added): 1.35 does not export it and no signed contracts/api-changes.json addition covers it`,
          );
        }
      } else if (
        withoutBundlerRenames(v1[name] as string) !==
        withoutBundlerRenames(v2[name] as string)
      ) {
        result.drift.push({
          entry,
          name,
          v1: v1[name] as string,
          next: v2[name] as string,
        });
      }
    }
  }

  return result;
}

/** One line per drifted name: the first differing line on each side. */
export function describeDrift(d: NextSurfaceResult["drift"][number]): string {
  const a = withoutBundlerRenames(d.v1).split("\n");
  const b = withoutBundlerRenames(d.next).split("\n");
  let i = 0;
  while (i < a.length && a[i] === b[i]) {
    i++;
  }
  const line = (s: string | undefined) => (s ?? "(end)").trim().slice(0, 140);

  return `${d.entry} ${d.name}: 1.35 \`${line(a[i])}\` vs core-next \`${line(b[i])}\``;
}

/**
 * The gate on the built core-next in `repoRoot`, with the frozen surface,
 * api-changes.json and `current` from the repository; undefined while
 * core-next is not built.
 */
export function gateBuiltNext(repoRoot: string): NextSurfaceResult | undefined {
  const pkgDir = join(repoRoot, "packages/core-next");
  if (!existsSync(join(pkgDir, "dist/index.d.ts"))) {
    return undefined;
  }
  const conformanceRoot = join(repoRoot, "packages/conformance");
  const read = (file: string) =>
    JSON.parse(readFileSync(join(conformanceRoot, "contracts", file), "utf8"));
  const frozen: Surface = read("api-surface.json");
  const next = extractSurface(pkgDir);

  return checkNextSurface(
    frozen,
    next,
    read("api-changes.json").changes,
    currentLayer(conformanceRoot),
    exportLayers(repoRoot, frozen, Object.keys(next)),
  );
}
