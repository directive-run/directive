import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "node:path";

const dist = path.resolve(__dirname, "../../../packages/directive/dist");

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^directive\/(.+)$/, replacement: path.join(dist, "$1.js") },
      { find: /^directive$/, replacement: path.join(dist, "index.js") },
    ],
    dedupe: ["vue"],
  },
});
