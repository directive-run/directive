import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type Options, defineConfig } from "tsup";

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

const entry = {
  index: "src/index.ts",
  internals: "src/internals.ts",
  "plugins/index": "src/plugins/index.ts",
  testing: "src/utils/testing.ts",
  migration: "src/utils/migration.ts",
  "adapter-utils": "src/adapter-utils.ts",
  worker: "src/adapters/worker.ts",
};

const shared: Options = {
  entry,
  format: ["esm", "cjs"],
  minify: true,
  // No build ships sourcemaps. The default and development builds are
  // unminified, so a stack trace through them is readable without one; the
  // production build is only ever reached through an app bundler, which
  // minifies again anyway. Maps were most of the tarball.
  sourcemap: false,
  // `pnpm build` empties dist first. Cleaning here would race the two
  // builds below, which run at the same time and share the directory.
  clean: false,
  splitting: true,
  treeshake: true,
  target: "es2022",
};

const IS_DEVELOPMENT_IMPORT =
  /^import\s+isDevelopment\s+from\s+["']#is-development["'];?$/m;

const IS_DEVELOPMENT_USE = /\bisDevelopment\b/g;

/**
 * Write the dev check out in full wherever a source file uses
 * `isDevelopment`, and drop the `#is-development` import.
 *
 * Neither esbuild here nor a consumer's bundler later will inline an imported
 * value, or a top-level `var` (which is what a bundled `const` becomes), so a
 * shared flag stays a live check and the dev-only code and its warning text
 * ship. Writing the expression at each use site leaves nothing to inline:
 * once it folds to `false`, each dead branch goes with it.
 *
 * Every occurrence of the name is replaced, comments included (harmless,
 * they are stripped). The name is never a property key, an assignment target
 * or inside a string in `src/`; keep it that way.
 */
function inlineIsDevelopment(
  expression: string,
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

        return {
          contents: source
            .replace(IS_DEVELOPMENT_IMPORT, "")
            .replace(IS_DEVELOPMENT_USE, `(${expression})`),
          loader: "ts",
        };
      });
      // Anything importing the module some other way gets the matching file.
      build.onResolve({ filter: /^#is-development$/ }, () => ({
        path: fileURLToPath(new URL(devModule, import.meta.url)),
      }));
    },
  };
}

export default defineConfig([
  // The default build, for consumers without a `production` export
  // condition. The check is written so a bundler that defines
  // `process.env.NODE_ENV` as "production" folds it to `false` and drops the
  // dev code: the test has no side effects and both branches become `false`.
  // With no bundler, `process` is undefined in a browser and the check is
  // `false`; under Node it follows NODE_ENV. That branch has to stay `false`:
  // a bundler that only defines `process.env.NODE_ENV` cannot fold
  // `typeof process`, so `true` there would keep every dev branch alive in its
  // production bundles. Browser dev servers get dev checks from the
  // `development` build instead.
  //
  // Unminified: consumers' bundlers minify it themselves, and Node reads it
  // as-is, so the readable form costs nothing in a browser bundle.
  {
    ...shared,
    outDir: "dist",
    dts: true,
    minify: false,
    esbuildPlugins: [
      inlineIsDevelopment(
        'typeof process === "undefined" ? false : !process.env ? false : process.env.NODE_ENV !== "production"',
        "./src/dev-true.ts",
      ),
    ],
  },
  // The development build, selected by the `development` export condition
  // (Vite and webpack set it for dev servers and development builds).
  // `isDevelopment` is the literal `true`, so dev checks run in a browser,
  // where `process` does not exist and the default build's runtime check
  // reads `false`. It is the build people debug in a browser, so it ships
  // unminified and readable.
  {
    ...shared,
    outDir: "dist/development",
    dts: false,
    minify: false,
    esbuildPlugins: [inlineIsDevelopment("true", "./src/dev-true.ts")],
  },
  // The production build, selected by the `production` export condition
  // (webpack and Vite set it for production builds; esbuild takes
  // `--conditions=production`). `isDevelopment` is the literal `false`, so
  // no bundler setting is needed for the dev code to disappear.
  {
    ...shared,
    outDir: "dist/production",
    dts: false,
    esbuildPlugins: [inlineIsDevelopment("false", "./src/dev-false.ts")],
  },
]);
