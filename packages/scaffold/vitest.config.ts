import { defineConfig } from "vitest/config";
import { engineAlias } from "../../vitest.engine.js";

export default defineConfig({
  resolve: { alias: engineAlias() },
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
  },
});
