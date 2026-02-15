import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		testing: "src/testing.ts",
		anthropic: "src/adapters/anthropic.ts",
		openai: "src/adapters/openai.ts",
		ollama: "src/adapters/ollama.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	target: "es2022",
	external: [
		"@directive-run/core",
	],
});
