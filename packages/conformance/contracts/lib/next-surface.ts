/**
 * The core-next surface gate: core-next's BUILT public API, at the layer it
 * has built, held to the frozen 1.35 surface (contracts/api-surface.json).
 * The alphas promise 1.35's API; additions land at beta (contracts/STABILITY.md).
 *
 * - A 1.35 name core-next lacks fails, unless a signed removal in
 *   api-changes.json covers it, or contracts/next-unshipped.json lists it and
 *   its layer is above layers.rules.json `current` (an unbuilt feature:
 *   importing it already fails at build or link time). The list is
 *   hand-maintained and tighten-only, so a name core-next has shipped cannot
 *   be dropped at any layer: a missing name it does not list fails, a listed
 *   name core-next ships fails as stale, and a listed name whose layer is
 *   built fails. The layer is lib/layers.ts layerOfExport, placed by the
 *   module that declares the name in packages/core/src, as per-test
 *   placement does; the list must agree with it. A missing name the tables do
 *   not place fails until they do. An entry core-next does not ship is a
 *   missing name for each of its names.
 * - An `engine: "next"` removal (core-next only) fails as stale while
 *   core-next exports the name. The workspace check ignores such an entry.
 * - A name 1.35 lacks fails, unless a signed api-changes.json addition covers
 *   it. `pending-gate` does not count here, and an agent never signs.
 * - Signature drift fails unless contracts/next-drift.json lists it: a shared
 *   name whose printed declaration differs from 1.35's apart from the type
 *   bundler's `$N` renames. The list is hand-maintained and tighten-only: a
 *   drifted name it does not list fails, and a listed name that no longer
 *   drifts fails as stale. check.ts compiled against core-next
 *   (contracts/lib/types.ts) is the usage-level gate. `#ref:` keys are not
 *   compared: they are keyed by chunk file, which differs between the two
 *   builds.
 * - layers.rules.json `current` must be a layer. Without one the gate cannot
 *   tell built names from unbuilt ones, so it fails and checks nothing else.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Project } from "ts-morph";
import { coreEntries } from "../../lib/core-entries.js";
import {
  LAYERS,
  type Layer,
  layerIndex,
  layerOfExport,
} from "../../lib/layers.js";
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

/** contracts/next-unshipped.json: `<entry> <name>` → layer. */
export type Unshipped = Readonly<Record<string, Layer>>;

/** contracts/next-unshipped.json, without its `$comment`. */
export function readUnshipped(conformanceRoot: string): Unshipped {
  const raw: Record<string, Layer> = JSON.parse(
    readFileSync(
      join(conformanceRoot, "contracts/next-unshipped.json"),
      "utf8",
    ),
  );

  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !key.startsWith("$")),
  );
}

/** contracts/next-drift.json: `<entry> <name>` → why it differs today. */
export type Drift = Readonly<Record<string, string>>;

/** contracts/next-drift.json, without its `$comment`. */
export function readDrift(conformanceRoot: string): Drift {
  const raw: Record<string, string> = JSON.parse(
    readFileSync(join(conformanceRoot, "contracts/next-drift.json"), "utf8"),
  );

  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !key.startsWith("$")),
  );
}

export interface NextSurfaceResult {
  failures: string[];
  /** Missing names accepted: listed in next-unshipped.json, layer above `current`. */
  unbuilt: { entry: string; name: string; layer: Layer }[];
  /** Frozen entries core-next does not ship (each name is also checked). */
  unshipped: string[];
  /** Shared names whose declaration differs from 1.35's (listed or not). */
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
  unshipped: Unshipped,
  drift: Drift,
): NextSurfaceResult {
  const result: NextSurfaceResult = {
    failures: [],
    unbuilt: [],
    unshipped: [],
    drift: [],
  };
  if (
    typeof current !== "string" ||
    !(LAYERS as readonly string[]).includes(current)
  ) {
    result.failures.push(
      `layers.rules.json: "current" is ${JSON.stringify(current ?? null)}, not a layer (${LAYERS[0]} to ${LAYERS[LAYERS.length - 1]}): set it to the highest layer core-next has built, since without one the gate cannot tell built names from unbuilt ones`,
    );

    return result;
  }
  const built = layerIndex(current);
  const signedAdd = new Set<string>();
  const signedRemove = new Set<string>();
  for (const c of changes) {
    if (!("change" in c)) {
      if (c.kind === "add" && isSigned(c)) {
        signedAdd.add(c.export);
      }
      continue;
    }
    const key = `${c.entry} ${c.name}`;
    if (c.engine === "next") {
      // checkSurface ignores these, so their ledger rules are held here.
      const label = `api-changes.json: ${key} (${c.change}, engine "next")`;
      if (c.change !== "removed") {
        result.failures.push(
          `${label}: only a removal may carry engine "next"`,
        );
      }
      if (typeof c.reason !== "string" || c.reason.trim() === "") {
        result.failures.push(`${label} has no reason`);
      }
      if (typeof c.date !== "string" || c.date.trim() === "") {
        result.failures.push(`${label} has no date`);
      }
      if (c.name in (next[c.entry] ?? {})) {
        result.failures.push(`${label} is stale: core-next exports ${key}`);
      }
    }
    if (isSigned(c) && c.change === "removed") {
      signedRemove.add(key);
    }
  }
  for (const [key, layer] of Object.entries(unshipped)) {
    const [entry = "", name = ""] = key.split(" ");
    if (!(name in (frozen[entry] ?? {})) || name.startsWith(REF_PREFIX)) {
      result.failures.push(
        `contracts/next-unshipped.json: ${key} is not a 1.35 name`,
      );
    } else if (name in (next[entry] ?? {})) {
      result.failures.push(
        `contracts/next-unshipped.json: ${key} is stale: core-next ships it (remove it from next-unshipped.json)`,
      );
    } else if (layers.get(key)?.layer !== layer) {
      result.failures.push(
        `contracts/next-unshipped.json: ${key} is listed at ${layer}, but lib/layers.ts places it at ${layers.get(key)?.layer ?? "no layer"}`,
      );
    }
  }
  result.unshipped = Object.keys(frozen)
    .filter((entry) => !(entry in next))
    .sort();
  const entries = new Set([...Object.keys(frozen), ...Object.keys(next)]);
  for (const entry of [...entries].sort()) {
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
          if (unshipped[key] === undefined) {
            result.failures.push(
              `core-next ${key} (missing): 1.35 exports it and contracts/next-unshipped.json does not list it (layer ${placed.layer}, unbuilt at current ${current}): a name core-next ships may not be dropped`,
            );
          } else if (unshipped[key] === placed.layer) {
            result.unbuilt.push({ entry, name, layer: placed.layer });
          }
        } else if (unshipped[key] !== undefined) {
          result.failures.push(
            `core-next ${key} (missing): contracts/next-unshipped.json lists it at ${unshipped[key]}, but layer ${placed.layer} is built (current ${current})`,
          );
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
        const d = {
          entry,
          name,
          v1: v1[name] as string,
          next: v2[name] as string,
        };
        result.drift.push(d);
        if (drift[key] === undefined) {
          result.failures.push(
            `core-next ${key} (drift): its declaration differs from 1.35's and contracts/next-drift.json does not list it: ${describeDrift(d)}`,
          );
        }
      }
    }
  }
  const drifted = new Set(result.drift.map((d) => `${d.entry} ${d.name}`));
  for (const [key, reason] of Object.entries(drift)) {
    const [entry = "", name = ""] = key.split(" ");
    if (!(name in (frozen[entry] ?? {})) || !(name in (next[entry] ?? {}))) {
      result.failures.push(
        `contracts/next-drift.json: ${key} is not a name both 1.35 and core-next export`,
      );
    } else if (!drifted.has(key)) {
      result.failures.push(
        `contracts/next-drift.json: ${key} is stale: core-next's declaration matches 1.35's (remove it from next-drift.json)`,
      );
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      result.failures.push(`contracts/next-drift.json: ${key} has no reason`);
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
    exportLayers(repoRoot, frozen, Object.keys(frozen)),
    readUnshipped(conformanceRoot),
    readDrift(conformanceRoot),
  );
}
