import path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const coreDist = path.resolve(__dirname, "../../../packages/core/dist");
const svelteDist = path.resolve(__dirname, "../../../packages/svelte/dist");

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: [
      {
        find: /^@directive-run\/svelte$/,
        replacement: path.join(svelteDist, "index.js"),
      },
      {
        find: /^@directive-run\/core\/(.+)$/,
        replacement: path.join(coreDist, "$1.js"),
      },
      {
        find: /^@directive-run\/core$/,
        replacement: path.join(coreDist, "index.js"),
      },
    ],
    dedupe: ["svelte"],
  },
});
