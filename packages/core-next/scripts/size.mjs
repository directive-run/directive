// Gzip size of the graph module: bundled alone, minified, gzip level 9.
// Private members end in `_` and are mangled exactly as the tsup build
// mangles them (`mangleProps` in tsup.config.ts), so this is the shipped size.
// esbuild is loaded from tsup's own dependency, so the measuring esbuild is
// the building esbuild: no second copy can drift from it.
// With a built dist/index.js present, it is also minified and measured, as a
// check that the measured number is what ships.
// Run from the package: `pnpm --filter @directive-run/core-next size`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const require = createRequire(import.meta.url);
const esbuildPath = createRequire(require.resolve("tsup")).resolve("esbuild");
const esbuild = await import(pathToFileURL(esbuildPath).href);
const { build, transform, version } = esbuild.default ?? esbuild;

// Dev-only diagnostic text, derived from the source so no list can go stale.
// A "dev-gated region" is whatever only runs when `isDevelopment` is true: the
// `then` of `if (isDevelopment ...)`, the true arm of `isDevelopment ? a : b`,
// the right of `isDevelopment && x`, and any function whose every use is inside
// such a region (a nested function declaration is NOT tree-shaken by esbuild,
// so a dev-only function with an ungated body ships its text even when its one
// call site is folded away). A string in a gated region and in no ungated code
// is dev-only. Needles are the printable-ASCII runs of those strings (escapes
// such as \u2014 and quote style differ between source and minified output).
const NEEDLE_MIN = 20;
const sourcesIn = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      return e.name === "__tests__" ? [] : sourcesIn(p);
    }

    return /\.ts$/.test(e.name) && !/\.(test|d)\.ts$/.test(e.name) ? [p] : [];
  });
const hasDevConjunct = (n) =>
  ts.isParenthesizedExpression(n)
    ? hasDevConjunct(n.expression)
    : ts.isIdentifier(n)
      ? n.text === "isDevelopment"
      : ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        (hasDevConjunct(n.left) || hasDevConjunct(n.right));
const isTextNode = (n) =>
  (ts.isStringLiteral(n) ||
    ts.isNoSubstitutionTemplateLiteral(n) ||
    ts.isTemplateHead(n) ||
    ts.isTemplateMiddle(n) ||
    ts.isTemplateTail(n)) &&
  !ts.isLiteralTypeNode(n.parent) &&
  !ts.isImportDeclaration(n.parent) &&
  !ts.isExportDeclaration(n.parent);
function devOnlyNeedles(srcDir) {
  const dev = [];
  const open = [];
  for (const file of sourcesIn(srcDir)) {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.ES2022,
      true,
    );
    const gated = [];
    const all = [];
    const collect = (n) => {
      all.push(n);
      if (ts.isIfStatement(n) && hasDevConjunct(n.expression)) {
        gated.push(n.thenStatement);
      } else if (ts.isConditionalExpression(n) && hasDevConjunct(n.condition)) {
        gated.push(n.whenTrue);
      } else if (
        ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
        hasDevConjunct(n.left)
      ) {
        gated.push(n.right);
      }
      ts.forEachChild(n, collect);
    };
    collect(sf);
    const inGated = (n) =>
      gated.some((g) => n.getStart(sf) >= g.getStart(sf) && n.end <= g.end);
    // A function used only inside gated code is gated; repeat, since it may be
    // the only user of another.
    const named = all.flatMap((n) =>
      ts.isFunctionDeclaration(n) && n.name
        ? [[n.name, n]]
        : ts.isVariableDeclaration(n) &&
            ts.isIdentifier(n.name) &&
            n.initializer &&
            (ts.isArrowFunction(n.initializer) ||
              ts.isFunctionExpression(n.initializer))
          ? [[n.name, n.initializer]]
          : [],
    );
    for (let again = true; again; ) {
      again = false;
      for (const [id, fn] of named) {
        if (gated.includes(fn)) {
          continue;
        }
        const uses = all.filter(
          (n) => ts.isIdentifier(n) && n.text === id.text && n !== id,
        );
        if (uses.length > 0 && uses.every((u) => inGated(u))) {
          gated.push(fn);
          again = true;
        }
      }
    }
    for (const n of all) {
      if (isTextNode(n)) {
        (inGated(n) ? dev : open).push(n.text);
      }
    }
  }
  const ungated = open.join("\n");
  const needles = new Set();
  for (const text of dev) {
    for (const run of text.split(/[^\x20-\x7e]|["'`\\]/)) {
      if (run.length >= NEEDLE_MIN && !ungated.includes(run)) {
        needles.add(run);
      }
    }
  }

  return [...needles].sort();
}

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
let distBytes = null;
if (existsSync(dist)) {
  // tsup runs with `splitting: true`, so dist/index.js imports dist/chunk-*.js.
  // Measuring index.js alone under-reports what a consumer ships. Bundle the
  // entry as a consumer's bundler would (chunks followed, dev flag folded by
  // NODE_ENV=production, @directive-run/* external). Property names are already
  // mangled by the build.
  const built = await build({
    entryPoints: [dist],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    write: false,
    logLevel: "silent",
    metafile: true,
    conditions: ["production"],
    define: { "process.env.NODE_ENV": '"production"' },
    external: ["@directive-run/*"],
  });
  distBytes = built.outputFiles[0].contents;
  const builtGz = gzipSync(distBytes, { level: 9 }).length;
  // Guard: every chunk the entry imports must be inside the measured bundle,
  // so the number can never silently fall back to index.js alone.
  const distDir = new URL("../dist/", import.meta.url).pathname;
  const measured = Object.keys(built.metafile.inputs).map((f) =>
    join(process.cwd(), f),
  );
  const measuredNames = new Set(measured.map((f) => f.split("/").pop()));
  const imported = [
    ...readFileSync(dist, "utf8").matchAll(
      /from\s*["']\.\/(chunk-[^"']+\.js)["']/g,
    ),
  ].map((m) => m[1]);
  const missing = imported.filter(
    (c) => !measuredNames.has(c) || !existsSync(join(distDir, c)),
  );
  if (missing.length > 0) {
    console.error(`dist size excludes imported chunks: ${missing}`);
    process.exitCode = 1;
  }
  console.log(
    `dist entry incl. chunks (${imported.length} imported): ${builtGz} B min+gzip (dist/index.js bundled, @directive-run/* external)`,
  );
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
// The same transform tsup.config.ts does (keep in step): esbuild does not fold
// an imported constant across modules, so resolving `#is-development` to
// dev-false.ts would leave every dev message in the measured bundle. The check
// becomes a module constant (in a pure call) and each use
// `(__directiveDev && NODE_ENV !== "production")`, which NODE_ENV="production"
// folds.
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
          .replace(IS_DEV_IMPORT, "\0")
          .replace(
            /\bisDevelopment\b/g,
            '(__directiveDev && process.env.NODE_ENV !== "production")',
          )
          .replace(
            "\0",
            `const __directiveDev = /* @__PURE__ */ (() => (${DEV_CHECK}))();`,
          ),
        loader: "ts",
      };
    });
  },
};
// The guard. Text in dev-gated code (see devOnlyNeedles) must not be in a
// production bundle. "Validation failed" / "Unknown fact key" are not dev-gated
// (they stay in validateValue on purpose, `validate: true` opts in at runtime),
// so they are not in the list. The control makes a silent pass impossible: the
// list must be non-empty, and a development bundle must contain every string in
// it, so the production bundle's lack of one is the bundler's doing and not a
// needle that matches nothing.
const devNeedles = devOnlyNeedles(src);
const devBundle = await build({
  stdin: {
    contents:
      'export * as a from "./index.ts"; export * as b from "./internals.ts";',
    resolveDir: src,
    loader: "ts",
  },
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  write: false,
  logLevel: "silent",
  mangleProps: /_$/,
  // Minified, esbuild would otherwise define NODE_ENV as "production" itself.
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [inlineIsDevelopment],
});
const blind = devNeedles.filter(
  (n) => !Buffer.from(devBundle.outputFiles[0].contents).includes(n),
);
if (devNeedles.length === 0 || blind.length > 0) {
  console.error(
    `dev-string check is blind: ${devNeedles.length} strings derived, absent from a development bundle: ${JSON.stringify(blind)}`,
  );
  process.exitCode = 1;
}
console.log(`dev-only strings guarded: ${devNeedles.length}`);
function assertNoDevStrings(label, bytes) {
  const shipped = devNeedles.filter((n) => Buffer.from(bytes).includes(n));
  if (shipped.length > 0) {
    console.error(
      `dev-only strings shipped in a production bundle (${label}):\n${shipped.map((n) => `  ${JSON.stringify(n)}`).join("\n")}`,
    );
    process.exitCode = 1;
  }
}
if (distBytes) {
  assertNoDevStrings("dist/index.js", distBytes);
}
async function measure(label, contents, resolveDir, engine) {
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
  if (engine.mangleProps) {
    assertNoDevStrings(label, bytes);
  }

  return `${bytes.length} B min, ${gzipSync(bytes, { level: 9 }).length} B min+gzip`;
}
const minimal = readFileSync(join(fixtures, "minimal.ts"), "utf8");
for (const [name, engine] of Object.entries(engines)) {
  console.log(
    `fixture minimal on ${name}: ${await measure("minimal", minimal, fixtures, engine)}`,
  );
}
// Two namespaced modules with a cross-module read (fixtures/two-module.ts).
const twoModule = readFileSync(join(fixtures, "two-module.ts"), "utf8");
for (const [name, engine] of Object.entries(engines)) {
  console.log(
    `fixture two-module on ${name}: ${await measure("two-module", twoModule, fixtures, engine)}`,
  );
}
// The floor: the same app on the system core with no optional part (see
// fixtures/floor.ts). core-next only: 1.35 has no such entry point.
const floor = readFileSync(join(fixtures, "floor.ts"), "utf8");
console.log(
  `fixture floor on core-next: ${await measure("floor", floor, fixtures, engines["core-next"])}`,
);
console.log(
  `core-next full entry (every export): ${await measure("full entry", 'export * from "@directive-run/core";', fixtures, engines["core-next"])}`,
);
if (process.argv.includes("--check") && gz > BUDGET) {
  console.error(`graph.ts is ${gz - BUDGET} B over the ${BUDGET} B budget`);
  process.exit(1);
}
