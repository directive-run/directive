import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/optimistic-updates/",
  build: {
    outDir: "dist",
    target: "esnext",
  },
});
