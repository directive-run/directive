import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["vite"],
  sourcemap: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  minify: true,
});
