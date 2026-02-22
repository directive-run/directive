import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/debounce-constraints/",
  build: {
    outDir: "dist",
    target: "esnext",
  },
});
