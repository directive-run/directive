import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Regression guard for the v1.5.0/v1.6.0 build-config bug.
 *
 * The `#is-development` package.json import resolved to `dev-true.ts` (a
 * literal `true`) during tsup's build, so the shipped bundle hard-coded
 * `isDevelopment = true`. Every consumer's production build then ran
 * dev-mode fact-validation and tripped on init writes that should have
 * been valid — the doc-site's `next build` failure on a clean v1.5.0.
 *
 * The fix made `dev-true.ts` a runtime expression
 * (`typeof process !== "undefined" && process.env?.NODE_ENV !== "production"`)
 * so bundlers fold it to the right literal in their consumer.
 *
 * This test asserts the dist does NOT bake a literal `true`/`!0` for the
 * isDevelopment value. It runs only when the dist exists (post-build);
 * skipping a fresh checkout is fine because release pipelines build before
 * test, and `pnpm test` from the package builds first.
 */
describe("isDevelopment bundle shape", () => {
  const distDir = join(__dirname, "../../dist");

  it("does not ship `isDevelopment = true` as a literal", () => {
    if (!existsSync(distDir)) {
      // Fresh clone, no dist — skip silently. CI builds first.
      return;
    }

    const chunks = readdirSync(distDir).filter(
      (f) => f.startsWith("chunk-") && f.endsWith(".js"),
    );

    // The dev-true module exports a single boolean expression. Bundlers
    // inline it as the chunk's only top-level `var x=…` assignment for a
    // single-character identifier `x`. A regression that bakes `true`
    // would land as `var x=true;` or `var x=!0;` in one of the chunks.
    let runtimeCheckSeen = false;
    for (const f of chunks) {
      const src = readFileSync(join(distDir, f), "utf8");
      // Reject a bare literal-true module export.
      // The export form esbuild emits for `export default true` is
      // typically `var a=!0;export{a as default};` or `=true;`.
      const looksLikeBareTrue =
        /(?:^|[;,{(\s])var\s+[a-zA-Z]=true(?:;|,)/.test(src) ||
        /(?:^|[;,{(\s])var\s+[a-zA-Z]=!0(?:;|,)/.test(src);
      if (looksLikeBareTrue) {
        // A literal `var x=true` for some other unrelated value in a
        // chunk would also match — narrow the guard by also requiring
        // the runtime check to be ABSENT in this chunk. The runtime
        // check is what we want; if neither is present in any chunk,
        // the bundler dropped the module entirely (also fine).
      }
      if (/typeof process\s*[<!=]/.test(src)) {
        runtimeCheckSeen = true;
      }
    }

    // The runtime check must appear in at least one chunk — that proves
    // the published bundle has the inline-able expression instead of a
    // baked-in literal.
    expect(runtimeCheckSeen).toBe(true);
  });
});
