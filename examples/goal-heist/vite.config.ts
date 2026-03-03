import { apiProxy } from "@directive-run/vite-plugin-api-proxy";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/goal-heist/",
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
  plugins: [
    apiProxy({
      routes: {
        "/api/claude": {
          target: "https://api.anthropic.com/v1/messages",
          headers: { "anthropic-version": "2023-06-01" },
          envKey: "ANTHROPIC_API_KEY",
          headerKey: "x-api-key",
        },
      },
    }),
  ],
});
