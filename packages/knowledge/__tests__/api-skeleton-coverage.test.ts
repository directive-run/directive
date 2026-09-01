/**
 * The skeleton has to describe the code in this repository, not a copy of the
 * code from some earlier release.
 *
 * `api-skeleton.md` is generated from `api-reference.json`, which this
 * repository does not contain. The release fetches it from *the newest release
 * that carries the asset* — which, at the moment a release is being cut, is the
 * release before it. So the skeleton published alongside a version describes
 * the version before it, and nothing has ever compared the two.
 *
 * Locally the same gap opens a different way: the generator reads the file out
 * of a sibling `directive-docs` checkout, and that checkout is pinned to
 * whatever version of core it depends on. A checkout ten minors behind produces
 * a skeleton ten minors behind, cheerfully, exit zero.
 *
 * Neither path is detectable by reading the output — a stale skeleton is a
 * well-formed skeleton. This compares it against the one artifact that is
 * always current: the type declarations this repository just built. Every
 * public export has to appear as an entry.
 *
 * There is no allow-list, and there was. Sixty-odd exports the extractor does
 * not emit were recorded here as known gaps, on the reasoning that fixing them
 * meant changing the extractor in the docs repository. That reasoning had a hole
 * in it: `api-reference.json` is fetched from *the release before the one being
 * cut*, so an export added in this release can never be in it — which made this
 * test fail on exactly the releases doing the most, and offered two remedies,
 * both wrong. Hand-editing a generated file is overwritten by the next build.
 * Adding a name to a list of things "not meant to be documented" is false of
 * every one of them.
 *
 * The generator names them instead, under a heading that says the description is
 * still coming. So the roster is complete by construction, this test has nothing
 * to excuse, and what it still catches is the thing it was written for: a
 * skeleton committed without being regenerated.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const SKELETON = join(HERE, "..", "api-skeleton.md");

/**
 * Public exports named in an `export { ... }` block, including re-exports
 * written `internalName as PublicName` — the public name is what a reader looks
 * up, and it is the only one the skeleton would ever carry.
 */
const EXPORT_BLOCK = /export\s*\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"])?\s*;?/g;

function publicExports(dtsPath: string): string[] {
  const source = readFileSync(dtsPath, "utf-8");
  const names = new Set<string>();

  for (const block of source.matchAll(EXPORT_BLOCK)) {
    for (const entry of block[1]!.split(",")) {
      const spec = entry.trim().replace(/^type\s+/, "");
      if (!spec) {
        continue;
      }
      const aliased = spec.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      const name = aliased ? aliased[1]! : spec;
      if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== "default") {
        names.add(name);
      }
    }
  }

  return [...names];
}

const PACKAGES = [
  { key: "core" as const, dts: join(REPO, "packages/core/dist/index.d.ts") },
  { key: "ai" as const, dts: join(REPO, "packages/ai/dist/index.d.ts") },
];

describe("api-skeleton describes the code in this repository", () => {
  for (const { key, dts } of PACKAGES) {
    describe(`@directive-run/${key}`, () => {
      it("documents every public export", () => {
        if (!existsSync(dts)) {
          // The declarations are a build output. Without them there is nothing
          // to compare against, and a silent pass here is the same failure
          // this file exists to catch.
          throw new Error(
            `[knowledge] ${dts} not found — run \`pnpm --filter @directive-run/${key} build\` before this test.`,
          );
        }

        const skeleton = readFileSync(SKELETON, "utf-8");
        const documented = (name: string) =>
          new RegExp(`\`${name}\``).test(skeleton);

        const undocumented = publicExports(dts)
          .filter((name) => !documented(name))
          .sort();

        expect(
          undocumented,
          `${undocumented.length} public export(s) of @directive-run/${key} have no entry in api-skeleton.md.\n\n` +
            "The usual cause is a stale api-reference.json: the release fetches it from the\n" +
            "release before the one being cut, and locally the generator reads it from a\n" +
            "sibling directive-docs checkout pinned to an older core.\n\n" +
            "Regenerate against a current api-reference.json:\n" +
            "  pnpm --filter @directive-run/knowledge generate\n\n" +
            "Every public export is named, so a miss here means the committed skeleton\n" +
            "is older than the declarations beside it.",
        ).toEqual([]);
      });
    });
  }
});
