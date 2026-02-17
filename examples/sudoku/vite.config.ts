import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/sudoku/",
  build: {
    target: "esnext",
  },
});
