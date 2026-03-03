import path from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const coreDist = path.resolve(__dirname, "../../../packages/core/dist");
const vueDist = path.resolve(__dirname, "../../../packages/vue/dist");

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      {
        find: /^@directive-run\/vue$/,
        replacement: path.join(vueDist, "index.js"),
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
    dedupe: ["vue"],
  },
});
