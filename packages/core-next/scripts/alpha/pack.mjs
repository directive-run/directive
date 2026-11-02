// Packs core-next as `@directive-run/core@2.0.0-alpha.0`, a tarball for the
// alpha.0 GitHub prerelease (RELEASING.md, "alpha.0 as a tarball").
//
// It builds core-next, copies dist/ into a staging directory outside the repo
// with a package.json renamed and versioned for the alpha (not private, with a
// README, repository, licenses and engines), and runs `npm pack` there. There
// is no swap commit: nothing in the repo changes, and packages/core, the
// changesets config, release.yml and every branch are left alone.
//
// Usage: pnpm --filter @directive-run/core-next pack:alpha [--out <dir>] [--no-build]
//   --out       where the tarball goes (default: <tmpdir>/directive-alpha);
//               a relative path is read from where pnpm was run
//   --no-build  pack the dist/ already built
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "@directive-run/core";
const VERSION = "2.0.0-alpha.0";
const TARBALL = "directive-run-core-2.0.0-alpha.0.tgz";

const pkgDir = fileURLToPath(new URL("../..", import.meta.url));
const repoRoot = join(pkgDir, "../..");

const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outDir = resolve(
  process.env.INIT_CWD ?? process.cwd(),
  outIndex === -1 ? join(tmpdir(), "directive-alpha") : args[outIndex + 1],
);

if (!args.includes("--no-build")) {
  execFileSync("pnpm", ["run", "build"], { cwd: pkgDir, stdio: "inherit" });
}

const source = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
// Read only: 1.x's public metadata, so the alpha points at the same places.
const v1 = JSON.parse(
  readFileSync(join(repoRoot, "packages/core/package.json"), "utf8"),
);

// Every file the exports map names must have been built.
const targets = [];
const collect = (value) => {
  if (typeof value === "string") {
    targets.push(value);
  } else {
    for (const inner of Object.values(value)) {
      collect(inner);
    }
  }
};
collect(source.exports);
const missing = [source.main, source.types, ...targets].filter(
  (file) => !existsSync(join(pkgDir, file)),
);
if (missing.length > 0) {
  console.error(`pack:alpha: not built: ${missing.join(", ")}`);
  process.exit(1);
}

// The published manifest: core-next's, renamed. `imports` maps into src/,
// which does not ship (the build inlines it), and scripts and devDependencies
// are for this repo only.
const {
  private: _private,
  imports: _imports,
  scripts: _scripts,
  devDependencies: _dev,
  ...kept
} = source;
const manifest = {
  ...kept,
  name: NAME,
  version: VERSION,
  description:
    "Directive 2.0 alpha: the constraint-driven runtime for TypeScript, on the 2.0 engine. A tarball for early testing; not on npm.",
  repository: {
    type: "git",
    url: "git+https://github.com/directive-run/directive.git",
    directory: "packages/core-next",
  },
  homepage: v1.homepage,
  bugs: v1.bugs,
  keywords: v1.keywords,
  engines: v1.engines,
  // npm adds LICENSE and README by itself; the Apache text has to be listed.
  files: [...kept.files, "LICENSE-APACHE"],
};

const stage = mkdtempSync(join(tmpdir(), "directive-alpha-stage-"));
try {
  cpSync(join(pkgDir, "dist"), join(stage, "dist"), { recursive: true });
  writeFileSync(
    join(stage, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  copyFileSync(
    fileURLToPath(new URL("README.md", import.meta.url)),
    join(stage, "README.md"),
  );
  for (const license of ["LICENSE", "LICENSE-APACHE"]) {
    copyFileSync(join(repoRoot, license), join(stage, license));
  }

  mkdirSync(outDir, { recursive: true });
  const [packed] = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", outDir],
      { cwd: stage, encoding: "utf8" },
    ),
  );
  if (packed.filename !== TARBALL) {
    console.error(
      `pack:alpha: expected ${TARBALL}, npm wrote ${packed.filename}`,
    );
    process.exit(1);
  }
  console.log(
    [
      `packed ${join(outDir, packed.filename)}`,
      `  ${packed.entryCount} files, ${packed.size} B packed, ${packed.unpackedSize} B unpacked`,
      `  shasum ${packed.shasum}`,
      `  integrity ${packed.integrity}`,
    ].join("\n"),
  );
} finally {
  rmSync(stage, { recursive: true, force: true });
}
