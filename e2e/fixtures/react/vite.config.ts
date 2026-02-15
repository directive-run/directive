import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const coreDist = path.resolve(__dirname, "../../../packages/core/dist");
const reactDist = path.resolve(__dirname, "../../../packages/react/dist");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@directive-run\/react$/, replacement: path.join(reactDist, "index.js") },
      { find: /^@directive-run\/core\/(.+)$/, replacement: path.join(coreDist, "$1.js") },
      { find: /^@directive-run\/core$/, replacement: path.join(coreDist, "index.js") },
    ],
    dedupe: ["react", "react-dom"],
  },
});
