import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "plugins/index": "src/plugins/index.ts",
    testing: "src/utils/testing.ts",
    migration: "src/utils/migration.ts",
    "adapter-utils": "src/adapter-utils.ts",
    worker: "src/adapters/worker.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  minify: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
});
