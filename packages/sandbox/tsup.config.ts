import { defineConfig } from "tsup";

// `ts-morph` (validator) and `esbuild` (bundler) are heavy optional
// runtime deps. Keeping them external means consumers of the public
// API (`runInSandbox`) only pay for them when they actually call the
// function — same lazy-load story `@directive-run/lint` ships.
//
// The worker entry is a separate tsup entry so the worker file lives
// at `dist/worker.js` and can be resolved via `import.meta.resolve`
// from the host (mirrors the lint/worker pattern).
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
    external: ["ts-morph", "esbuild", "@directive-run/core"],
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
    external: ["@directive-run/core"],
  },
]);
