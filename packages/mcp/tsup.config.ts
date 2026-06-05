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

// lz-string ships CJS-only on npm; tsup's default externalization would
// emit `import { compressToEncodedURIComponent } from "lz-string"` in the
// ESM build, which Node's ESM loader rejects because the CJS module has
// no named exports. Bundling it inline (~6 KB minified, zero transitive
// deps) sidesteps the CJS↔ESM interop problem at runtime. Caught when
// 0.3.0 crashed Claude Desktop on first handshake.
const noExternal = ["lz-string"];

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
    noExternal,
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
    noExternal,
  },
]);
