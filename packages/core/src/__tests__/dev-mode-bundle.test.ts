import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const nodeRequire = createRequire(import.meta.url);
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

  it("ships the NODE_ENV check in the default build, never a literal", () => {
    if (!existsSync(distDir)) {
      return;
    }

    // The minifier reshapes the guard around it, so only the plain member
    // expression a bundler's define matches is stable to look for.
    const sources = chunks(distDir);
    // (The devtools and clobber-loop plugins keep their own try/catch-guarded
    // checks with an optional chain; those run only when the plugin is used.)
    expect(sources.some((src) => src.includes("process.env.NODE_ENV"))).toBe(
      true,
    );
  });

  /**
   * Load the published CommonJS build with `process` shadowed, the way a
   * browser shim or an edge runtime might provide it.
   */
  function loadCjsWithProcess(fakeProcess: unknown): Record<string, any> {
    const cache = new Map<string, { exports: Record<string, unknown> }>();
    function load(file: string): Record<string, unknown> {
      const cached = cache.get(file);
      if (cached) {
        return cached.exports;
      }
      const mod = { exports: {} as Record<string, unknown> };
      cache.set(file, mod);
      const code = readFileSync(file, "utf8");
      const localRequire = (spec: string) =>
        spec.startsWith(".")
          ? load(join(dirname(file), spec))
          : nodeRequire(spec);
      new Function("require", "module", "exports", "process", code)(
        localRequire,
        mod,
        mod.exports,
        fakeProcess,
      );

      return mod.exports;
    }

    return load(join(distDir, "index.cjs"));
  }

  it("runs when process exists without env, or not at all", () => {
    if (!existsSync(join(distDir, "index.cjs"))) {
      return;
    }

    for (const fakeProcess of [{}, undefined]) {
      const core = loadCjsWithProcess(fakeProcess);
      const counter = core.createModule("m", {
        schema: { facts: { n: core.t.number() } },
        init: (facts: Record<string, unknown>) => {
          facts.n = 0;
        },
      });
      const system = core.createSystem({ module: counter });
      expect(() => system.start()).not.toThrow();
      system.destroy();
    }
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
    expect(sources.some((src) => src.includes("process.env.NODE_ENV"))).toBe(
      false,
    );
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
