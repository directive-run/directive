import { defineConfig } from "vite";
import { apiProxy } from "@directive-run/vite-plugin-api-proxy";

export default defineConfig({
  base: "/examples/checkers/",
  build: {
    target: "esnext",
    rollupOptions: {
      external: ["ws", "fs", "path", "http", "https", "net", "tls", "crypto", "stream", "url", "zlib"],
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
