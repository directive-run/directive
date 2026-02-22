import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/dynamic-modules/",
  build: {
    outDir: "dist",
    target: "esnext",
  },
});
