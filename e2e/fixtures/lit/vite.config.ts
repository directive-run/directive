import { defineConfig } from "vite";
import path from "node:path";

const coreDist = path.resolve(__dirname, "../../../packages/core/dist");
const litDist = path.resolve(__dirname, "../../../packages/lit/dist");

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@directive-run\/lit$/, replacement: path.join(litDist, "index.js") },
      { find: /^@directive-run\/core\/(.+)$/, replacement: path.join(coreDist, "$1.js") },
      { find: /^@directive-run\/core$/, replacement: path.join(coreDist, "index.js") },
    ],
  },
});
