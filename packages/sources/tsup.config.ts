import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/supabase.ts", "src/cloudflare.ts"],
  format: ["esm", "cjs"],
  dts: true,
  minify: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  external: [
    "@directive-run/core",
    "@supabase/supabase-js",
    "@cloudflare/workers-types",
  ],
});
