import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";

const dist = path.resolve(__dirname, "../../../packages/directive/dist");

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: [
      { find: /^directive\/(.+)$/, replacement: path.join(dist, "$1.js") },
      { find: /^directive$/, replacement: path.join(dist, "index.js") },
    ],
    dedupe: ["svelte"],
  },
});
