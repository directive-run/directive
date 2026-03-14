import { apiProxy } from "@directive-run/vite-plugin-api-proxy";
import { defineConfig } from "vite";

const NODE_SHIMS = [
  "ws",
  "fs",
  "path",
  "http",
  "https",
  "net",
  "tls",
  "crypto",
  "stream",
  "url",
  "zlib",
];

export default defineConfig({
  base: "/examples/checkers/",
  build: {
    target: "esnext",
  },
  resolve: {
    alias: Object.fromEntries(
      NODE_SHIMS.map((mod) => [mod, new URL("./src/empty-shim.ts", import.meta.url).pathname]),
    ),
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
