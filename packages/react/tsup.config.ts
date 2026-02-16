import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm", "cjs"],
  dts: true,
  minify: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  external: ["react", "react-dom", "@directive-run/core"],
});
