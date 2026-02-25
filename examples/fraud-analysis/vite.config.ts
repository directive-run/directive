import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/fraud-analysis/",
  server: {
    proxy: {
      "/api/claude": {
        target: "https://api.anthropic.com",
        changeOrigin: true,
        rewrite: () => "/v1/messages",
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("anthropic-version", "2023-06-01");
          });
        },
      },
    },
  },
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
