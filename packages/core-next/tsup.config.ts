import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type Options, defineConfig } from "tsup";

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

const IS_DEVELOPMENT_IMPORT =
  /^import\s+isDevelopment\s+from\s+["']#is-development["'];?$/m;
const IS_DEVELOPMENT_USE = /\bisDevelopment\b/g;

/**
 * The dev check, evaluated once per module and still folded by a consumer's
 * bundler. The import becomes a module-level constant holding the check
 * (`expression`, in a pure call a bundler drops once nothing reads it), and
 * each use of `isDevelopment` becomes `(DEV && NODE_ENV !== "production")`:
 * - Unbundled, a production or browser run stops at the constant, so a hot
 *   path never reads Node's slow `process.env` (a development run reads it,
 *   as every use did before).
 * - A bundler defining `process.env.NODE_ENV` as "production" turns each use
 *   into `(DEV && false)`, folds it and drops the dev code behind it.
 * scripts/size.mjs measures the same transform (keep the two in step).
 */
const devTransform = (source: string, expression: string): string =>
  source
    // Where the import was, so it is defined before any module-level use.
    .replace(IS_DEVELOPMENT_IMPORT, "\0")
    .replace(
      IS_DEVELOPMENT_USE,
      '(__directiveDev && process.env.NODE_ENV !== "production")',
    )
    .replace(
      "\0",
      `const __directiveDev = /* @__PURE__ */ (() => (${expression}))();`,
    );

function inlineIsDevelopment(expression: string): EsbuildPlugin {
  return {
    name: "inline-is-development",
    setup(build) {
      build.onLoad({ filter: /\/src\/.*\.ts$/ }, async (args) => {
        const source = await readFile(args.path, "utf8");
        if (!IS_DEVELOPMENT_IMPORT.test(source)) {
          return undefined;
        }

        return {
          contents: devTransform(source, expression),
          loader: "ts",
        };
      });
      build.onResolve({ filter: /^#is-development$/ }, () => ({
        path: fileURLToPath(new URL("./src/dev-true.ts", import.meta.url)),
      }));
    },
  };
}

export const DEV_CHECK =
  'typeof process === "undefined" ? false : !process.env ? false : process.env.NODE_ENV !== "production"';

export default defineConfig({
  entry: {
    index: "src/index.ts",
    internals: "src/internals.ts",
    testing: "src/utils/testing.ts",
  },
  format: ["esm"],
  dts: true,
  minify: false,
  sourcemap: false,
  // `pnpm build` empties dist first.
  clean: false,
  splitting: true,
  treeshake: true,
  target: "es2022",
  esbuildPlugins: [inlineIsDevelopment(DEV_CHECK)],
  // Internal (private) members are named with a trailing `_` and shortened
  // here; public names are untouched. scripts/size.mjs measures the same.
  esbuildOptions(options) {
    options.mangleProps = /_$/;
  },
});
