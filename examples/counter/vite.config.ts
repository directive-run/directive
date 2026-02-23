import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/counter/",
  build: {
    target: "esnext",
  },
});
