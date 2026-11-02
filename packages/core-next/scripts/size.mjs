// Gzip size of the graph module: bundled alone, minified, gzip level 9.
// Private members end in `_` and are mangled exactly as the tsup build
// mangles them (`mangleProps` in tsup.config.ts), so this is the shipped size.
// esbuild is loaded from tsup's own dependency, so the measuring esbuild is
// the building esbuild: no second copy can drift from it.
// With a built dist/index.js present, it is also minified and measured, as a
// check that the measured number is what ships.
// Budgets: the graph module, the `minimal`, `two-module` and `floor` fixtures
// and the full entry each have a gzip budget in size-budgets.next.json at the
// repo root. A measured size over its budget fails the run (any mode), naming
// the fixture, its size, the budget and the overage. scripts/size-budgets-tighten.mjs
// keeps those budgets from rising without a written reason.
// Run from the package: `pnpm --filter @directive-run/core-next size`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import ts from "typescript";

// The budgets are data (not constants here) so a pull request that raises one
// shows up as a one-line diff next to its reason, and so the tighten-only check
// can compare the file with the base branch's copy.
const budgets = JSON.parse(
  readFileSync(
    new URL("../../../size-budgets.next.json", import.meta.url),
    "utf8",
  ),
).budgets;
for (const [key, entry] of Object.entries(budgets)) {
  if (
    typeof entry?.reason !== "string" ||
    entry.reason.trim() === "" ||
    !(entry.gzBudget === null || Number.isInteger(entry.gzBudget))
  ) {
    console.error(
      `size-budgets.next.json "${key}" must be { gzBudget: <integer bytes or null>, reason: <non-empty string> }`,
    );
    process.exit(1);
  }
}
const budgeted = new Set();
// Records a measured min+gzip size against its budget. A null budget means
// "reported, not budgeted" and is only allowed with a changed reason (see the
// tighten-only check). A fixture with no entry fails: a new fixture must come
// with its budget.
function checkBudget(key, label, gz) {
  budgeted.add(key);
  const entry = budgets[key];
  if (!entry) {
    console.error(
      `no budget for ${label} (${gz} B min+gzip): add "${key}" to size-budgets.next.json`,
    );
    process.exitCode = 1;

    return;
  }
  if (entry.gzBudget !== null && gz > entry.gzBudget) {
    console.error(
      `OVER BUDGET: ${label} is ${gz} B min+gzip, budget ${entry.gzBudget} B, over by ${gz - entry.gzBudget} B (size-budgets.next.json "${key}"; raising it needs a new reason)`,
    );
    process.exitCode = 1;
  }
}
const budgetText = (key) =>
  budgets[key]?.gzBudget == null
    ? "no budget"
    : `budget ${budgets[key].gzBudget} B`;

const require = createRequire(import.meta.url);
const esbuildPath = createRequire(require.resolve("tsup")).resolve("esbuild");
const esbuild = await import(pathToFileURL(esbuildPath).href);
const { build, transform, version } = esbuild.default ?? esbuild;

// Dev-only diagnostic text, derived two ways and guarded as the union.
//
// 1. From the source (devOnlyNeedles), by intent. A "dev-gated region" is
// whatever only runs when `isDevelopment` is true: the
// `then` of `if (isDevelopment ...)`, the true arm of `isDevelopment ? a : b`,
// the right of `isDevelopment && x`, and any function whose every use is inside
// such a region (a nested function declaration is NOT tree-shaken by esbuild,
// so a dev-only function with an ungated body ships its text even when its one
// call site is folded away). A string in a gated region and in no ungated code
// is dev-only. Needles are the printable-ASCII runs of those strings (escapes
// such as \u2014 and quote style differ between source and minified output).
// The analysis is per file and sees only direct uses, so it misses a dev-only
// function that calls itself or is called only from another file.
//
// 2. From the bundler (the loop over `sourceRuns` below): every text run in the
// source that a development bundle contains and a production bundle does not.
// This sees what esbuild really drops, so it covers what the analysis cannot,
// but it describes the current source: a gate removed from a call site makes
// that string reach production, and it silently falls out of this set. That is
// what DEV_STRINGS_MIN is for.
const NEEDLE_MIN = 20;
// The number of dev-only strings the two derivations find together: an exact
// count, not a floor that can fall behind. The guard fails when it finds fewer,
// because a string that leaves the derived set has either started shipping (a
// gate was removed) or been deleted; `--check` also fails when it finds more,
// so the count rises with the dev text and a later removal is caught. Set it to
// the count the guard prints, in the commit that adds or deletes dev text.
const DEV_STRINGS_MIN = 113;
const RUN_SPLIT = /[^\x20-\x7e]|["'`\\]/;
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
    for (const run of text.split(RUN_SPLIT)) {
      if (run.length >= NEEDLE_MIN && !ungated.includes(run)) {
        needles.add(run);
      }
    }
  }

  return [...needles].sort();
}
// Every printable-ASCII run of NEEDLE_MIN or more in any string in the source,
// gated or not: the candidates the bundlers are asked about.
function sourceRuns(srcDir) {
  const runs = new Set();
  for (const file of sourcesIn(srcDir)) {
    const walk = (n) => {
      if (isTextNode(n)) {
        for (const run of n.text.split(RUN_SPLIT)) {
          if (run.length >= NEEDLE_MIN) {
            runs.add(run);
          }
        }
      }
      ts.forEachChild(n, walk);
    };
    walk(
      ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.ES2022,
        true,
      ),
    );
  }

  return runs;
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
checkBudget("graph", "graph.ts", gz);
console.log(
  `graph.ts: ${code.length} B min, ${gz} B min+gzip (${budgetText("graph")}, esbuild ${version} via tsup)`,
);
// The L0b runtime: reported, not budgeted. Each entry bundles what it
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
// Fixtures, budgeted in size-budgets.next.json (the 1.35 lines are only
// reported): each bundled for production
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
// The guard. Text in dev-gated code must not be in a production bundle.
// "Validation failed" / "Unknown fact key" are not dev-gated (they stay in
// validateValue on purpose, `validate: true` opts in at runtime), so they are
// in neither list. The list is the union of the source analysis
// (devOnlyNeedles) and what the bundler drops (sourceRuns present in the
// development bundle, absent from the production one). Two controls make a
// silent pass impossible: a development bundle must contain every string in the
// list, so the production bundle's lack of one is the bundler's doing and not a
// needle that matches nothing; and the list must hold exactly DEV_STRINGS_MIN
// strings, so an under-derived list fails loudly.
const entryContents =
  'export * as a from "./index.ts"; export * as b from "./internals.ts";';
const bundleEntry = async (nodeEnv) =>
  Buffer.from(
    (
      await build({
        stdin: { contents: entryContents, resolveDir: src, loader: "ts" },
        bundle: true,
        minify: true,
        format: "esm",
        target: "es2022",
        write: false,
        logLevel: "silent",
        mangleProps: /_$/,
        // Minified, esbuild would otherwise define NODE_ENV as "production" itself.
        define: { "process.env.NODE_ENV": JSON.stringify(nodeEnv) },
        plugins: [inlineIsDevelopment],
      })
    ).outputFiles[0].contents,
  );
const devBundle = await bundleEntry("development");
const prodBundle = await bundleEntry("production");
const analysed = devOnlyNeedles(src);
const dropped = [...sourceRuns(src)].filter(
  (run) => devBundle.includes(run) && !prodBundle.includes(run),
);
const devNeedles = [...new Set([...analysed, ...dropped])].sort();
const blind = devNeedles.filter((n) => !devBundle.includes(n));
if (blind.length > 0) {
  console.error(
    `dev-string check is blind: ${devNeedles.length} strings derived, absent from a development bundle: ${JSON.stringify(blind)}`,
  );
  process.exitCode = 1;
}
if (devNeedles.length !== DEV_STRINGS_MIN) {
  const fewer = devNeedles.length < DEV_STRINGS_MIN;
  const message = fewer
    ? `dev-string check is under-derived: ${devNeedles.length} dev-only strings found, ${DEV_STRINGS_MIN} expected. Either a dev-gated string now reaches a production bundle (a gate was removed: a message you expect to be dev-only is missing from the list below), or dev text was deleted on purpose (then set DEV_STRINGS_MIN to ${devNeedles.length} in scripts/size.mjs).`
    : `dev-string check is behind: ${devNeedles.length} dev-only strings found, ${DEV_STRINGS_MIN} expected. Dev text was added: set DEV_STRINGS_MIN to ${devNeedles.length} in scripts/size.mjs, so a gate removed later fails here.`;
  // Fewer always fails; more fails under --check (CI), so the count cannot lag.
  if (fewer || process.argv.includes("--check")) {
    console.error(
      `${message} Found:\n${devNeedles.map((n) => `  ${JSON.stringify(n)}`).join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.warn(message);
  }
}
console.log(
  `dev-only strings guarded: ${devNeedles.length} (${analysed.length} from source analysis, ${dropped.length} dropped by the bundler, expected ${DEV_STRINGS_MIN})`,
);
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
// The development and production builds as shipped (tsup.config.ts), not as
// this script bundles them. Production is selected by the `production` export
// condition with no bundler setting, so it must hold none of the dev text
// itself; development holds all of it (the same control as above: a production
// build with no dev text is only evidence if the development build has it).
// Every .js file in the build directory is read, the chunks included.
const builtBytes = (name) => {
  const dir = new URL(`../dist/${name}/`, import.meta.url).pathname;
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith(".js"))
    : [];
  if (!files.includes("index.js")) {
    console.error(
      `dist/${name} has no index.js: run \`pnpm --filter @directive-run/core-next build\``,
    );
    process.exitCode = 1;
  }

  return Buffer.concat(files.map((f) => readFileSync(join(dir, f))));
};
if (distBytes) {
  const production = builtBytes("production");
  const development = builtBytes("development");
  assertNoDevStrings("dist/production", production);
  const inDevelopment = devNeedles.filter((n) => development.includes(n));
  if (inDevelopment.length !== DEV_STRINGS_MIN) {
    const absent = devNeedles.filter((n) => !development.includes(n));
    console.error(
      `dist/development holds ${inDevelopment.length} of the ${DEV_STRINGS_MIN} dev-only strings, expected all of them. Missing:\n${absent.map((n) => `  ${JSON.stringify(n)}`).join("\n")}`,
    );
    process.exitCode = 1;
  }
  console.log(
    `dist/production: ${devNeedles.filter((n) => production.includes(n)).length} dev-only strings (expected 0, ${gzipSync(production, { level: 9 }).length} B gzip); dist/development: ${inDevelopment.length} of ${DEV_STRINGS_MIN}`,
  );
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

  const gz = gzipSync(bytes, { level: 9 }).length;

  return { gz, text: `${bytes.length} B min, ${gz} B min+gzip` };
}
const minimal = readFileSync(join(fixtures, "minimal.ts"), "utf8");
for (const [name, engine] of Object.entries(engines)) {
  const m = await measure("minimal", minimal, fixtures, engine);
  console.log(`fixture minimal on ${name}: ${m.text}`);
  if (engine.mangleProps) {
    checkBudget("minimal", "fixture minimal on core-next", m.gz);
  }
}
// Two namespaced modules with a cross-module read (fixtures/two-module.ts).
const twoModule = readFileSync(join(fixtures, "two-module.ts"), "utf8");
for (const [name, engine] of Object.entries(engines)) {
  const m = await measure("two-module", twoModule, fixtures, engine);
  console.log(`fixture two-module on ${name}: ${m.text}`);
  if (engine.mangleProps) {
    checkBudget("two-module", "fixture two-module on core-next", m.gz);
  }
}
// The floor: the same app on the system core with no optional part (see
// fixtures/floor.ts). core-next only: 1.35 has no such entry point.
const floor = readFileSync(join(fixtures, "floor.ts"), "utf8");
const floorSize = await measure("floor", floor, fixtures, engines["core-next"]);
console.log(`fixture floor on core-next: ${floorSize.text}`);
checkBudget("floor", "fixture floor on core-next", floorSize.gz);
const fullEntry = await measure(
  "full entry",
  'export * from "@directive-run/core";',
  fixtures,
  engines["core-next"],
);
console.log(`core-next full entry (every export): ${fullEntry.text}`);
checkBudget("full-entry", "core-next full entry (every export)", fullEntry.gz);
// A budget for something this script no longer measures would never fire.
const unmeasured = Object.keys(budgets).filter((key) => !budgeted.has(key));
if (unmeasured.length > 0) {
  console.error(
    `size-budgets.next.json has budgets size.mjs does not measure: ${unmeasured.join(", ")}`,
  );
  process.exitCode = 1;
}
