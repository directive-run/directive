import { defineConfig } from "vite";
import { apiProxy } from "@directive-run/vite-plugin-api-proxy";

export default defineConfig({
  build: {
    target: "esnext",
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
