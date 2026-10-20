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
if (process.argv.includes("--check") && gz > BUDGET) {
  console.error(`graph.ts is ${gz - BUDGET} B over the ${BUDGET} B budget`);
  process.exit(1);
}
