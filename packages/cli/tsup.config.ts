import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    // No `clean`: these configs build in parallel and cleaning in one races
    // the others (it deleted a .d.ts in CI). `build` cleans dist first.
    splitting: false,
    treeshake: true,
    target: "es2022",
    minify: true,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    splitting: false,
    treeshake: true,
    target: "es2022",
    minify: true,
  },
]);
