import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

// Read package.json at config time so the version string in
// src/server.ts and src/cli.ts comes from a single source of truth.
// `changeset version` bumps package.json; the next build picks it up
// automatically — no `PKG_VERSION = "x.y.z"` constant to keep in sync.
const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./package.json", import.meta.url)),
    "utf-8",
  ),
) as { version: string };

const define = {
  "process.env.DIRECTIVE_MCP_VERSION": JSON.stringify(pkg.version),
};

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    target: "es2022",
    minify: true,
    define,
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    sourcemap: true,
    splitting: false,
    treeshake: true,
    target: "es2022",
    minify: true,
    define,
  },
]);
