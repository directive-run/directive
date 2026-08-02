import { defineConfig } from "tsup";

// Every rule file does `import { SyntaxKind }
// from "ts-morph"` (value import). With the rules + the public-API entry in
// the same tsup chunk, ESM hoists ts-morph to the top of `dist/index.js`, so
// every consumer pays the ~25 MB ts-morph load at module-init — defeating the
// README's "lazy ts-morph + optionalDependencies" story.
//
// Fix: split the public-API entry from the executable rules + worker. Mark
// `./executable.js` and `./rules.js` as external in the index entry so the
// dynamic `await import(...)` calls inside `runRules` / `applyFix` resolve to
// the sibling dist files at runtime instead of being inlined. Result:
// dist/index.js has zero ts-morph references; ts-morph only loads when a
// consumer calls runRules/applyFix.
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    treeshake: false,
    target: "es2022",
    minify: true,
    external: ["ts-morph", /\.\/executable(\.js)?$/],
  },
  {
    entry: { executable: "src/executable.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    splitting: false,
    treeshake: false,
    target: "es2022",
    minify: true,
    external: ["ts-morph"],
  },
  {
    entry: { worker: "src/worker.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    splitting: false,
    treeshake: false,
    target: "es2022",
    minify: true,
    external: ["ts-morph"],
  },
]);
