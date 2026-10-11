/**
 * Consumer-fixture size budgets: what an app actually ships.
 *
 * `size-check.ts` measures the published closure of each entry, which is a
 * ceiling. It cannot see whether a consumer's bundler drops the code that app
 * never calls, so engine growth that tree-shaking should remove, or dev-only
 * code that should vanish in production, never moves it. This script bundles
 * small real apps from `scripts/size-fixtures/` the way a production build
 * would and gates their gzipped size.
 *
 * Each fixture is bundled with esbuild: minified, browser platform, ESM,
 * `process.env.NODE_ENV` defined as "production", and the `production` export
 * condition on. `@directive-run/core` resolves through the workspace link, so
 * the package's real `exports` map is what gets exercised.
 *
 * A fixture may also list `forbidden` strings: text that must not appear in
 * its production bundle (dev-only warnings, for example). Finding one fails
 * the check, because it means dev code leaked into production.
 *
 * Run after `pnpm --filter @directive-run/core build`:
 *   tsx scripts/size-consumer.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { type Plugin, build } from "esbuild";

interface ConsumerBudget {
  fixture: string;
  gzBudget: number;
  forbidden?: string[];
}

interface BudgetFile {
  consumers?: ConsumerBudget[];
}

const REPO_ROOT = join(__dirname, "..");
const BUDGET_FILE = join(REPO_ROOT, "size-budgets.json");

// Resolve workspace packages from a package that depends on them, so the
// fixture sees exactly what a consumer installing from npm would see.
const workspaceResolve: Plugin = {
  name: "workspace-resolve",
  setup(b) {
    b.onResolve({ filter: /^@directive-run\// }, (args) => {
      // b.resolve re-enters this hook; the marker lets the inner call fall
      // through to esbuild's own resolver.
      if (args.pluginData === "workspace-resolve") {
        return undefined;
      }

      return b.resolve(args.path, {
        kind: args.kind,
        resolveDir: join(REPO_ROOT, "packages/react"),
        pluginData: "workspace-resolve",
      });
    });
  },
};

export async function bundleFixture(fixture: string): Promise<string> {
  const result = await build({
    entryPoints: [join(REPO_ROOT, fixture)],
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    conditions: ["production"],
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [workspaceResolve],
    logLevel: "silent",
  });

  return result.outputFiles[0]!.text;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

async function check(): Promise<number> {
  const parsed = JSON.parse(readFileSync(BUDGET_FILE, "utf-8")) as BudgetFile;
  const consumers = parsed.consumers ?? [];
  let failed = 0;

  for (const c of consumers) {
    let code: string;
    try {
      code = await bundleFixture(c.fixture);
    } catch (err) {
      console.error(`[size-consumer] could not bundle ${c.fixture}`);
      console.error(`  ${(err as Error).message.split("\n")[0]}`);
      console.error(
        "  hint: run `pnpm --filter @directive-run/core build` first",
      );
      failed++;
      continue;
    }

    const raw = Buffer.byteLength(code);
    const gz = gzipSync(code).byteLength;
    const leaked = (c.forbidden ?? []).filter((s) => code.includes(s));
    const pass = gz <= c.gzBudget && leaked.length === 0;
    if (!pass) {
      failed++;
    }

    const delta = gz - c.gzBudget;
    console.log(
      `  ${c.fixture.padEnd(36)}  min ${fmt(raw).padStart(9)}  gz ${fmt(gz).padStart(7)}  budget ${fmt(c.gzBudget).padStart(7)}  ${(delta > 0 ? "+" : "") + fmt(delta)}  ${pass ? "✓" : "✗"}`,
    );
    for (const s of leaked) {
      console.error(
        `    leaked dev-only text into production: ${JSON.stringify(s)}`,
      );
    }
  }

  console.log("");
  if (failed > 0) {
    console.error(
      `[size-consumer] ${failed} of ${consumers.length} fixtures failed`,
    );
    console.error(
      "  hint: find what stopped tree-shaking or leaked dev code, or raise the budget in size-budgets.json if intentional",
    );

    return 1;
  }
  console.log(`[size-consumer] ${consumers.length} fixtures within budget`);

  return 0;
}

if (process.argv[1]?.endsWith("size-consumer.ts")) {
  check().then((code) => process.exit(code));
}
