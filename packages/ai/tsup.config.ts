import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    testing: "src/testing.ts",
    anthropic: "src/adapters/anthropic.ts",
    openai: "src/adapters/openai.ts",
    ollama: "src/adapters/ollama.ts",
    gemini: "src/adapters/gemini.ts",
    "multi-agent": "src/multi-agent-export.ts",
    predicate: "src/predicate-export.ts",
    guardrails: "src/guardrails-export.ts",
    devtools: "src/devtools-export.ts",
    evals: "src/evals-export.ts",
    mcp: "src/mcp-export.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  minify: true,
  sourcemap: true,
  clean: true,
  splitting: true,
  treeshake: true,
  target: "es2022",
  external: ["@directive-run/core", "ws"],
});
