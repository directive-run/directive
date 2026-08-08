import { defineConfig } from "tsup";

/**
 * Every runtime dependency, plus the `node:` builtins.
 *
 * The `node:` pattern is here so nothing in the chain tries to bundle a
 * builtin; `removeNodeProtocol: false` below is what keeps the prefix on the
 * way out. tsup strips it by default, so `import { randomBytes } from
 * "node:crypto"` was emitted as `from "crypto"` — a working import on Node and
 * a resolution failure everywhere else. A Worker, Deno, and every bundler
 * configured to refuse implicit node polyfills resolve the prefixed form and
 * reject the bare one, so the default turns a package that names its builtins
 * correctly into one that cannot be loaded off Node.
 */
const external = [
  "@directive-run/core",
  "@directive-run/ai",
  "commander",
  "picocolors",
  "@clack/prompts",
  "zod",
  /^node:/,
];

export default defineConfig([
  {
    // Two entries, and the split is the point of it. `index` is
    // runtime-agnostic; `node` is the filesystem, behind a subpath export, so
    // importing the library does not import `node:fs`.
    entry: { index: "src/index.ts", node: "src/node.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: true,
    target: "es2022",
    removeNodeProtocol: false,
    external,
  },
  // The binary. ESM only — it uses top-level await, and there is no CJS
  // consumer of a shebang script to serve. The shebang comes from `src/cli.ts`
  // itself rather than a banner, so running the source with `tsx` behaves the
  // same way the built binary does.
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    sourcemap: true,
    splitting: false,
    treeshake: true,
    target: "es2022",
    removeNodeProtocol: false,
    external,
  },
]);
