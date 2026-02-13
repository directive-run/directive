import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import path from "node:path";

const dist = path.resolve(__dirname, "../../../packages/directive/dist");

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: [
      { find: /^directive\/(.+)$/, replacement: path.join(dist, "$1.js") },
      { find: /^directive$/, replacement: path.join(dist, "index.js") },
    ],
    dedupe: ["solid-js"],
  },
});
