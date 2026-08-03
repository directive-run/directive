import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    target: "es2022",
    external: [
      "@directive-run/core",
      "@directive-run/ai",
      "commander",
      "picocolors",
      "@clack/prompts",
      "zod",
    ],
  },
  // The binary. ESM only — it uses top-level await, and there is no CJS
  // consumer of a shebang script to serve. The shebang comes from `src/cli.ts`
  // itself rather than a banner, so running the source with `tsx` behaves the
  // same way the built binary does.
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    sourcemap: true,
    splitting: false,
    treeshake: true,
    target: "es2022",
    external: [
      "@directive-run/core",
      "@directive-run/ai",
      "commander",
      "picocolors",
      "@clack/prompts",
      "zod",
    ],
  },
]);
