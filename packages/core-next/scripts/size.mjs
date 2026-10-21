// Gzip size of the graph module: bundled alone, minified, gzip level 9.
// Private members end in `_` and are mangled exactly as the tsup build
// mangles them (`mangleProps` in tsup.config.ts), so this is the shipped size.
// esbuild is loaded from tsup's own dependency, so the measuring esbuild is
// the building esbuild: no second copy can drift from it.
// With a built dist/index.js present, it is also minified and measured, as a
// check that the measured number is what ships.
// Run from the package: `pnpm --filter @directive-run/core-next size`.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const esbuildPath = createRequire(require.resolve("tsup")).resolve("esbuild");
const esbuild = await import(pathToFileURL(esbuildPath).href);
const { build, transform, version } = esbuild.default ?? esbuild;

const entry = new URL("../src/graph.ts", import.meta.url).pathname;
const result = await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  write: false,
  logLevel: "silent",
  mangleProps: /_$/,
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
// Budget approved for the graph module. `--check` exits non-zero above it.
const BUDGET = 1800;
console.log(
  `graph.ts: ${code.length} B min, ${gz} B min+gzip (budget ${BUDGET} B, esbuild ${version} via tsup)`,
);
// The L0b runtime: reported, not budgeted yet. Each entry bundles what it
// imports, tree-shaken, so "kernel (default)" is what `createKernel` alone
// costs and "kernel (all features)" adds every opt-in piece.
const src = new URL("../src/", import.meta.url).pathname;
const bundles = {
  "scheduler.ts": 'export { createScheduler } from "./scheduler.ts";',
  "kernel (default)": 'export { createKernel } from "./kernel.ts";',
  "kernel (all features)": [
    'export { createKernel } from "./kernel.ts";',
    'export { createVirtualClock, createRng } from "./clock.ts";',
    'export { browserHosts } from "./scheduler.ts";',
    'export { withPhases } from "./phases.ts";',
    'export { withSnapshot } from "./snapshot.ts";',
  ].join("\n"),
};
for (const [name, contents] of Object.entries(bundles)) {
  const out = await build({
    stdin: { contents, resolveDir: src, loader: "ts" },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    write: false,
    logLevel: "silent",
    mangleProps: /_$/,
  });
  const bytes = out.outputFiles[0].contents;
  console.log(
    `${name}: ${bytes.length} B min, ${gzipSync(bytes, { level: 9 }).length} B min+gzip`,
  );
}
const dist = new URL("../dist/index.js", import.meta.url).pathname;
if (existsSync(dist)) {
  // The build is not minified; minify it the same way to compare like for
  // like. Property names are already mangled by the build.
  const built = await transform(readFileSync(dist, "utf8"), {
    minify: true,
    format: "esm",
    target: "es2022",
    loader: "js",
  });
  const builtGz = gzipSync(built.code, { level: 9 }).length;
  console.log(`dist/index.js: ${builtGz} B min+gzip (built by tsup)`);
}
// Fixtures, reported (no budget yet): each bundled for production
// (`#is-development` inlined as in tsup, NODE_ENV is "production"),
// minified and gzipped the same way. `@directive-run/core` is pointed at
// core-next and at packages/core (1.35.x), each with its own build's options.
const fixtures = new URL("./fixtures/", import.meta.url).pathname;
const engines = {
  "core-next": {
    entry: new URL("../src/index.ts", import.meta.url).pathname,
    mangleProps: /_$/,
  },
  "core 1.35": {
    entry: new URL("../../core/src/index.ts", import.meta.url).pathname,
  },
};
// The same inlining tsup.config.ts does (keep in step): esbuild does not fold
// an imported constant across modules, so resolving `#is-development` to
// dev-false.ts would leave every dev message in the measured bundle. Writing
// the expression out at each use lets NODE_ENV="production" fold it.
const IS_DEV_IMPORT =
  /^import\s+isDevelopment\s+from\s+["']#is-development["'];?$/m;
const DEV_CHECK =
  'typeof process === "undefined" ? false : !process.env ? false : process.env.NODE_ENV !== "production"';
const inlineIsDevelopment = {
  name: "inline-is-development",
  setup(b) {
    b.onLoad({ filter: /\/src\/.*\.ts$/ }, (args) => {
      const source = readFileSync(args.path, "utf8");
      if (!IS_DEV_IMPORT.test(source)) {
        return undefined;
      }

      return {
        contents: source
          .replace(IS_DEV_IMPORT, "")
          .replace(/\bisDevelopment\b/g, `(${DEV_CHECK})`),
        loader: "ts",
      };
    });
  },
};
async function measure(contents, resolveDir, engine) {
  const out = await build({
    stdin: { contents, resolveDir, loader: "ts" },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    write: false,
    logLevel: "silent",
    conditions: ["production"],
    define: { "process.env.NODE_ENV": '"production"' },
    alias: { "@directive-run/core": engine.entry },
    ...(engine.mangleProps
      ? { mangleProps: engine.mangleProps, plugins: [inlineIsDevelopment] }
      : {}),
  });
  const bytes = out.outputFiles[0].contents;
  // Only dev-gated text: "Validation failed" / "Unknown fact key" stay in
  // validateValue on purpose, because `validate: true` opts in at runtime.
  const dev = ["Nested mutation"].filter((m) => Buffer.from(bytes).includes(m));
  if (dev.length > 0 && engine.mangleProps) {
    console.error(`dev strings shipped in a production bundle: ${dev}`);
    process.exitCode = 1;
  }

  return `${bytes.length} B min, ${gzipSync(bytes, { level: 9 }).length} B min+gzip`;
}
const minimal = readFileSync(join(fixtures, "minimal.ts"), "utf8");
for (const [name, engine] of Object.entries(engines)) {
  console.log(
    `fixture minimal on ${name}: ${await measure(minimal, fixtures, engine)}`,
  );
}
console.log(
  `core-next full entry (every export): ${await measure('export * from "@directive-run/core";', fixtures, engines["core-next"])}`,
);
if (process.argv.includes("--check") && gz > BUDGET) {
  console.error(`graph.ts is ${gz - BUDGET} B over the ${BUDGET} B budget`);
  process.exit(1);
}
