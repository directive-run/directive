import { defineConfig } from "vite";

export default defineConfig({
  base: "/examples/ab-testing/",
  build: {
    target: "esnext",
  },
});
