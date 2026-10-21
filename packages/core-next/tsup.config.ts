import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type Options, defineConfig } from "tsup";

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

const IS_DEVELOPMENT_IMPORT =
  /^import\s+isDevelopment\s+from\s+["']#is-development["'];?$/m;
const IS_DEVELOPMENT_USE = /\bisDevelopment\b/g;

/**
 * Write the dev check out in full at each use of `isDevelopment` (as core's
 * build does), so a consumer's bundler folds it and drops dev-only code.
 */
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
          contents: source
            .replace(IS_DEVELOPMENT_IMPORT, "")
            .replace(IS_DEVELOPMENT_USE, `(${expression})`),
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
  entry: { index: "src/index.ts", internals: "src/internals.ts" },
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
