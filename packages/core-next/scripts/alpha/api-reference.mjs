// The first 2.x api-reference.json, from core-next's surface (RELEASING.md,
// "alpha.0 as a tarball").
//
// Generated the way release.yml's docs-artifacts job generates 1.x's: the
// toolkit's `extract-api-docs` over the package's src/index.ts. The
// extractor names each entry's module after the package directory's
// package.json, which here is core-next's, so `@directive-run/core-next`
// becomes `@directive-run/core`: the alpha ships under that name. Only core:
// @directive-run/ai has no 2.x yet.
//
// Then a self-check against .github/scripts/fetch-api-reference.sh through its
// test hooks (no network): a 2.x tree must select an asset of this file's name
// on the alpha's release tag.
//
// Usage: pnpm --filter @directive-run/core-next api-reference:alpha --out <dir>
//   The extractor is `extract-api-docs` on PATH (CI: `npm i -g
//   @directive-run/toolkit@latest`), or the file named by $EXTRACT_API_DOCS.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = "@directive-run/core@2.0.0-alpha.0";
const ASSET = "api-reference.json";
const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
if (outIndex === -1 || !args[outIndex + 1]) {
  console.error("usage: api-reference:alpha --out <dir>");
  process.exit(2);
}
const outDir = resolve(
  process.env.INIT_CWD ?? process.cwd(),
  args[outIndex + 1],
);

const extractor = process.env.EXTRACT_API_DOCS;
const raw = mkdtempSync(join(tmpdir(), "directive-alpha-api-"));
try {
  execFileSync(
    extractor ? process.execPath : "extract-api-docs",
    [
      ...(extractor ? [extractor] : []),
      "--packages",
      "packages/core-next",
      "--out",
      raw,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );

  const entries = JSON.parse(readFileSync(join(raw, ASSET), "utf8"));
  const modules = [...new Set(entries.map((entry) => entry.module))];
  if (
    !Array.isArray(entries) ||
    entries.length === 0 ||
    modules.join() !== "@directive-run/core-next"
  ) {
    console.error(
      `unexpected extractor output: ${entries.length} entries, modules ${modules.join(", ")}`,
    );
    process.exit(1);
  }
  const renamed = entries.map((entry) => ({
    ...entry,
    module: "@directive-run/core",
  }));
  mkdirSync(outDir, { recursive: true });
  // As the extractor writes it: two-space JSON, no trailing newline.
  writeFileSync(join(outDir, ASSET), JSON.stringify(renamed, null, 2));
  writeFileSync(
    join(outDir, "api-reference.md"),
    readFileSync(join(raw, "api-reference.md"), "utf8").replaceAll(
      "@directive-run/core-next",
      "@directive-run/core",
    ),
  );

  // fetch-api-reference.sh, as a 2.x build would run it, offered only the
  // alpha's release: it must pick this asset.
  const releases = join(raw, "releases.json");
  const url = `https://github.com/directive-run/directive/releases/download/${encodeURIComponent(TAG)}/${ASSET}`;
  writeFileSync(
    releases,
    JSON.stringify([
      { tag_name: TAG, assets: [{ name: ASSET, browser_download_url: url }] },
    ]),
  );
  const selected = execFileSync(
    "bash",
    [".github/scripts/fetch-api-reference.sh"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        TREE_VERSION: "2.0.0-alpha.0",
        RELEASES_JSON_FILE: releases,
        SELECT_ONLY: "1",
      },
    },
  ).trim();
  if (selected !== url) {
    console.error(`fetch-api-reference.sh selected "${selected}", not ${url}`);
    process.exit(1);
  }

  const kinds = {};
  for (const entry of renamed) {
    kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
  }
  console.log(
    [
      `wrote ${join(outDir, ASSET)} (${statSync(join(outDir, ASSET)).size} B, ${renamed.length} entries, module @directive-run/core)`,
      `  kinds: ${JSON.stringify(kinds)}`,
      `  fetch-api-reference.sh on a 2.0.0-alpha.0 tree selects it from release ${TAG}`,
    ].join("\n"),
  );
} finally {
  rmSync(raw, { recursive: true, force: true });
}
