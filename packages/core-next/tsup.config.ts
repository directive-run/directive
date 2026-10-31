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

/**
 * The development and production builds: the dev check is the literal `true`
 * or `false` at each use and the import is dropped, as in 1.35. A literal
 * folds in this build with no bundler setting, so the production build drops
 * the dev code on its own and the development build runs the checks where
 * `process` does not exist (a browser dev server).
 */
const literalTransform = (source: string, literal: "true" | "false"): string =>
  source
    .replace(IS_DEVELOPMENT_IMPORT, "")
    .replace(IS_DEVELOPMENT_USE, `(${literal})`);

function inlineIsDevelopment(
  transform: (source: string) => string,
  devModule: string,
): EsbuildPlugin {
  return {
    name: "inline-is-development",
    setup(build) {
      build.onLoad({ filter: /\/src\/.*\.ts$/ }, async (args) => {
        const source = await readFile(args.path, "utf8");
        if (!IS_DEVELOPMENT_IMPORT.test(source)) {
          return undefined;
        }

        return { contents: transform(source), loader: "ts" };
      });
      // Anything importing the module some other way gets the matching file.
      build.onResolve({ filter: /^#is-development$/ }, () => ({
        path: fileURLToPath(new URL(devModule, import.meta.url)),
      }));
    },
  };
}

export const DEV_CHECK =
  'typeof process === "undefined" ? false : !process.env ? false : process.env.NODE_ENV !== "production"';

const shared: Options = {
  entry: {
    index: "src/index.ts",
    internals: "src/internals.ts",
    testing: "src/utils/testing.ts",
  },
  // ESM only, as core-next is today. CJS is a packaging follow-up for alpha.0.
  format: ["esm"],
  minify: false,
  sourcemap: false,
  // `pnpm build` empties dist first. Cleaning here would race the three
  // builds below, which run at the same time and share the directory.
  clean: false,
  splitting: true,
  treeshake: true,
  target: "es2022",
  // Internal (private) members are named with a trailing `_` and shortened
  // here; public names are untouched. scripts/size.mjs measures the same.
  esbuildOptions(options) {
    options.mangleProps = /_$/;
  },
};

// The same three builds 1.35 ships (packages/core/tsup.config.ts), selected by
// the `exports` conditions in package.json.
export default defineConfig([
  // The default build, for consumers with neither condition. The check is
  // read from the environment at run time and folded by a bundler that
  // defines `process.env.NODE_ENV`. With no `process` (a browser) it is
  // `false`: a bundler that only defines NODE_ENV cannot fold
  // `typeof process`, so `true` there would keep every dev branch in its
  // production bundles. Browser dev servers get the checks from the
  // `development` build. The only build with type declarations.
  {
    ...shared,
    outDir: "dist",
    dts: true,
    esbuildPlugins: [
      inlineIsDevelopment(
        (source) => devTransform(source, DEV_CHECK),
        "./src/dev-true.ts",
      ),
    ],
  },
  // The development build, selected by the `development` export condition
  // (Vite and webpack set it for dev servers and development builds).
  // `isDevelopment` is the literal `true`. Unminified: it is the build people
  // debug in a browser.
  {
    ...shared,
    outDir: "dist/development",
    dts: false,
    esbuildPlugins: [
      inlineIsDevelopment(
        (source) => literalTransform(source, "true"),
        "./src/dev-true.ts",
      ),
    ],
  },
  // The production build, selected by the `production` export condition
  // (webpack and Vite set it for production builds; esbuild takes
  // `--conditions=production`). `isDevelopment` is the literal `false`, so no
  // bundler setting is needed for the dev code to disappear.
  {
    ...shared,
    outDir: "dist/production",
    dts: false,
    minify: true,
    esbuildPlugins: [
      inlineIsDevelopment(
        (source) => literalTransform(source, "false"),
        "./src/dev-false.ts",
      ),
    ],
  },
]);
