import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/ai-guardrails/",
  build: {
    target: "esnext",
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") {
          return;
        }
        warn(warning);
      },
    },
  },
  optimizeDeps: {
    exclude: ["ws"],
  },
  resolve: {
    alias: {
      ws: new URL("./src/browser-ws-stub.ts", import.meta.url).pathname,
    },
  },
});
