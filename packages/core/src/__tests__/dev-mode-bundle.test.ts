import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Regression guards for how the dev check ships.
 *
 * v1.5.0/v1.6.0 baked `isDevelopment = true` into the published bundle, so
 * every consumer's production build ran dev-mode fact validation. The fix
 * made the check a runtime expression of NODE_ENV that a bundler folds.
 *
 * Since 1.35 there are two builds:
 *
 * - `dist/` (the default): the check is written out at each use site as
 *   `typeof process === "undefined" ? false : process.env.NODE_ENV !== "production"`,
 *   so a bundler that defines NODE_ENV folds each one to `false`. It must
 *   never be a literal.
 * - `dist/production/` (the `production` export condition): the check is the
 *   literal `false`, so the dev-only code and its messages are gone.
 *
 * These run only when the dist exists (post-build); a fresh checkout skips.
 */
describe("isDevelopment bundle shape", () => {
  const distDir = join(__dirname, "../../dist");
  const productionDir = join(distDir, "production");

  function chunks(dir: string): string[] {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(dir, f), "utf8"));
  }

  // The inlined `isDevelopment`, as the minifier prints it. Plugins keep
  // their own, differently shaped checks, which this does not match.
  const runtimeCheck =
    /typeof process\s*[<>!=]+\s*"u"\s*\?\s*(?:false|!1)\s*:\s*process\.env\.NODE_ENV\s*!==?\s*"production"/;

  it("ships the NODE_ENV check in the default build, never a literal", () => {
    if (!existsSync(distDir)) {
      return;
    }

    expect(chunks(distDir).some((src) => runtimeCheck.test(src))).toBe(true);
  });

  it("keeps the dev messages in the default build", () => {
    if (!existsSync(distDir)) {
      return;
    }

    expect(chunks(distDir).some((src) => src.includes("tried to write"))).toBe(
      true,
    );
  });

  it("drops the dev check and its messages from the production build", () => {
    if (!existsSync(productionDir)) {
      return;
    }

    const sources = chunks(productionDir);
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((src) => runtimeCheck.test(src))).toBe(false);
    expect(sources.some((src) => src.includes("tried to write"))).toBe(false);
  });

  it("points the production export condition at the production build", () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "../../package.json"), "utf8"),
    ) as {
      exports: Record<
        string,
        {
          production?: { import: string; require: string };
          import: string;
          require: string;
        }
      >;
    };

    for (const [subpath, target] of Object.entries(pkg.exports)) {
      expect(target.production, subpath).toEqual({
        import: target.import.replace("./dist/", "./dist/production/"),
        require: target.require.replace("./dist/", "./dist/production/"),
      });
      // The condition must come before import/require to win.
      const keys = Object.keys(target);
      expect(keys.indexOf("production"), subpath).toBeLessThan(
        keys.indexOf("import"),
      );
      expect(keys.indexOf("production"), subpath).toBeLessThan(
        keys.indexOf("require"),
      );
    }
  });
});
