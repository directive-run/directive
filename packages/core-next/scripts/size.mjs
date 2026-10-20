// Gzip size of the graph module: bundled alone, minified, gzip level 9.
// Run from the package: `pnpm --filter @directive-run/core-next size`.
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const entry = new URL("../src/graph.ts", import.meta.url).pathname;
const result = await build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  write: false,
  logLevel: "silent",
});
const code = result.outputFiles[0].contents;
const gz = gzipSync(code, { level: 9 }).length;
console.log(`graph.ts: ${code.length} B min, ${gz} B min+gzip`);
