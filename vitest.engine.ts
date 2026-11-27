/**
 * Which core engine a downstream suite runs on.
 *
 * `DIRECTIVE_ENGINE=v2` points `@directive-run/core`'s seven entries, and the
 * `#is-development` flag, at core-next's source, exactly as the conformance
 * package's `v2` project does. Unset (or `v1`) returns no alias, so the
 * config that spreads it behaves as it did before. Shared by the root config
 * and by `cli` and `scaffold`, which have their own, so a run from a package
 * and a run from the root agree.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { v2Entries } from "./packages/conformance/lib/core-entries.js";

const root = fileURLToPath(new URL(".", import.meta.url));

export type EngineAlias = Array<{ find: RegExp; replacement: string }>;

function exact(specifier: string): RegExp {
  return new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

export function engineAlias(
  engine = process.env.DIRECTIVE_ENGINE,
): EngineAlias {
  if (!engine || engine === "v1") {
    return [];
  }
  if (engine !== "v2") {
    throw new Error(`DIRECTIVE_ENGINE must be "v1" or "v2", got "${engine}"`);
  }
  const entries = v2Entries(root);

  return [
    {
      find: exact("#is-development"),
      replacement: join(root, "packages/core-next/src/dev-true.ts"),
    },
    // Subpaths first: the bare name is anchored, but order keeps it obvious.
    ...entries
      .filter((e) => e.subpath !== ".")
      .map((e) => ({ find: exact(e.specifier), replacement: e.file })),
    ...entries
      .filter((e) => e.subpath === ".")
      .map((e) => ({ find: exact(e.specifier), replacement: e.file })),
  ];
}
