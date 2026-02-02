import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		react: "src/react.tsx",
		vue: "src/vue.ts",
		svelte: "src/svelte.ts",
		solid: "src/solid.ts",
		lit: "src/lit.ts",
		"plugins/index": "src/plugins/index.ts",
		testing: "src/testing.ts",
		templates: "src/templates.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	treeshake: true,
	target: "es2022",
	external: ["react", "react-dom", "vue", "svelte", "solid-js", "lit"],
});
