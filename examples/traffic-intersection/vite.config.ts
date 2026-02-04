import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      directive: resolve(__dirname, "../../packages/directive/src/index.ts"),
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
