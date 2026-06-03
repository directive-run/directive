import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: false,
    target: "es2022",
    minify: true,
    external: ["ts-morph"],
  },
  {
    entry: { worker: "src/worker.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    splitting: false,
    treeshake: false,
    target: "es2022",
    minify: true,
    external: ["ts-morph"],
  },
]);
