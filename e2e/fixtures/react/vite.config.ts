import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const dist = path.resolve(__dirname, "../../../packages/directive/dist");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^directive\/(.+)$/, replacement: path.join(dist, "$1.js") },
      { find: /^directive$/, replacement: path.join(dist, "index.js") },
    ],
    dedupe: ["react", "react-dom"],
  },
});
