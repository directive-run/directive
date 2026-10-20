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
});
