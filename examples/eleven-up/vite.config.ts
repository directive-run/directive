import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "directive/react": path.resolve(__dirname, "../../packages/directive/src/adapters/react.tsx"),
      "directive": path.resolve(__dirname, "../../packages/directive/src/index.ts"),
    },
  },
});
