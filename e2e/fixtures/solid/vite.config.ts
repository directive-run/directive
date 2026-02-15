import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import path from "node:path";

const coreDist = path.resolve(__dirname, "../../../packages/core/dist");
const solidDist = path.resolve(__dirname, "../../../packages/solid/dist");

export default defineConfig({
  plugins: [solidPlugin()],
  resolve: {
    alias: [
      { find: /^@directive-run\/solid$/, replacement: path.join(solidDist, "index.js") },
      { find: /^@directive-run\/core\/(.+)$/, replacement: path.join(coreDist, "$1.js") },
      { find: /^@directive-run\/core$/, replacement: path.join(coreDist, "index.js") },
    ],
    dedupe: ["solid-js"],
  },
});
