import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  dts: true,
  minify: false,
  sourcemap: false,
  // `pnpm build` empties dist first.
  clean: false,
  treeshake: true,
  target: "es2022",
  // Internal (private) members are named with a trailing `_` and shortened
  // here; public names are untouched. scripts/size.mjs measures the same.
  esbuildOptions(options) {
    options.mangleProps = /_$/;
  },
});
