// Install smoke for the alpha tarball (RELEASING.md, "alpha.0 as a tarball").
//
// In an empty scratch directory: `npm install <tarball>`, then load every
// subpath of the installed package with `import` and with `require`, under
// each of the three builds (no condition, `development`, `production`). Each
// load must
// - resolve to the build and module format it asked for (.js or .cjs, inside
//   dist/development/ or dist/production/ for those conditions),
// - export only 1.35's runtime names for that subpath, read from
//   packages/conformance/contracts/api-surface.json: all of them, except on
//   `.` and `./internals`, which leave out what 2.0 has not built (counted
//   and listed, not failed; P3-F3 put stubs only on the other entries),
// - and, for the three unbuilt subpaths, throw E_FEATURE_MISSING from every
//   function it exports.
// Then publint (strict) on the installed package and are-the-types-wrong
// (`node16` profile, as scripts/check-packages.ts uses for 1.x) on the tarball.
//
// Usage: pnpm --filter @directive-run/core-next smoke:alpha <tarball> [--keep]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const args = process.argv.slice(2);
const tarballArg = args.find((arg) => !arg.startsWith("--"));
if (!tarballArg) {
  console.error("usage: smoke:alpha <tarball> [--keep]");
  process.exit(2);
}
const tarball = resolve(process.env.INIT_CWD ?? process.cwd(), tarballArg);

const STUBS = ["./worker", "./migration", "./adapter-utils"];
const PARTIAL = new Set([".", "./internals"]);
const notBuilt = {};
const TYPE_KINDS = new Set(["InterfaceDeclaration", "TypeAliasDeclaration"]);
const surface = JSON.parse(
  readFileSync(
    join(repoRoot, "packages/conformance/contracts/api-surface.json"),
    "utf8",
  ),
);
// 1.35's runtime exports per subpath: every export that is not type-only.
const expected = Object.fromEntries(
  Object.entries(surface).map(([subpath, names]) => [
    subpath,
    Object.entries(names)
      .filter(
        ([name, sig]) =>
          !name.startsWith("#ref:") && !TYPE_KINDS.has(sig.split(" ", 1)[0]),
      )
      .map(([name]) => name)
      .sort(),
  ]),
);
const subpaths = Object.keys(expected).sort();

const dir = mkdtempSync(join(tmpdir(), "directive-alpha-smoke-"));
const failures = [];
const fail = (message) => failures.push(message);

try {
  writeFileSync(
    join(dir, "package.json"),
    '{ "name": "alpha-smoke", "version": "0.0.0", "private": true }\n',
  );
  execFileSync(
    "npm",
    ["install", tarball, "--no-audit", "--no-fund", "--ignore-scripts"],
    { cwd: dir, stdio: "pipe" },
  );
  const installed = join(dir, "node_modules/@directive-run/core");
  const manifest = JSON.parse(
    readFileSync(join(installed, "package.json"), "utf8"),
  );
  console.log(`installed ${manifest.name}@${manifest.version} from ${tarball}`);

  const served = Object.keys(manifest.exports).sort();
  if (JSON.stringify(served) !== JSON.stringify(subpaths)) {
    fail(
      `exports serves ${served.join(" ")}; 1.35 serves ${subpaths.join(" ")}`,
    );
  }

  // One probe per module system; it prints what each subpath resolved to,
  // what it exports and what its functions throw.
  const probeBody = (load, where) => `
const subpaths = ${JSON.stringify(subpaths)};
const stubs = new Set(${JSON.stringify(STUBS)});
const out = {};
for (const subpath of subpaths) {
  const spec = "@directive-run/core" + subpath.slice(1);
  try {
    const m = ${load};
    const thrown = {};
    if (stubs.has(subpath)) {
      for (const [name, value] of Object.entries(m)) {
        if (typeof value !== "function") { thrown[name] = "not a function"; continue; }
        try { value(); thrown[name] = "returned"; } catch (e) { thrown[name] = e?.code ?? String(e); }
      }
    }
    out[subpath] = { file: ${where}, names: Object.keys(m).sort(), thrown };
  } catch (e) {
    out[subpath] = { error: String(e?.stack ?? e) };
  }
}
console.log(JSON.stringify(out));
`;
  writeFileSync(
    join(dir, "probe.mjs"),
    probeBody("await import(spec)", "import.meta.resolve(spec)"),
  );
  writeFileSync(
    join(dir, "probe.cjs"),
    `(async () => {${probeBody("require(spec)", "require.resolve(spec)")}})();`,
  );

  const rows = [];
  for (const condition of ["default", "development", "production"]) {
    for (const [system, probe, ext] of [
      ["import", "probe.mjs", ".js"],
      ["require", "probe.cjs", ".cjs"],
    ]) {
      const flags =
        condition === "default" ? [] : [`--conditions=${condition}`];
      const result = JSON.parse(
        execFileSync("node", [...flags, probe], {
          cwd: dir,
          encoding: "utf8",
        }),
      );
      for (const subpath of subpaths) {
        const label = `${system} ${condition} ${subpath}`;
        const got = result[subpath];
        if (got.error) {
          fail(`${label}: ${got.error}`);
          rows.push(`✗ ${label}`);
          continue;
        }
        const file = got.file.replace(/^file:\/\//, "");
        const build = file.includes("/dist/development/")
          ? "development"
          : file.includes("/dist/production/")
            ? "production"
            : "default";
        const problems = [];
        if (!file.endsWith(ext)) {
          problems.push(`resolved to ${file}, not a ${ext} file`);
        }
        if (build !== condition) {
          problems.push(`resolved to the ${build} build`);
        }
        const want = expected[subpath];
        const extra = got.names.filter((name) => !want.includes(name));
        const absent = want.filter((name) => !got.names.includes(name));
        if (extra.length > 0) {
          problems.push(`exports names 1.35 does not: ${extra.join(" ")}`);
        }
        if (absent.length > 0 && !PARTIAL.has(subpath)) {
          problems.push(`missing 1.35 exports: ${absent.join(" ")}`);
        }
        if (absent.length > 0) {
          notBuilt[subpath] = absent;
        }
        for (const [name, code] of Object.entries(got.thrown)) {
          if (code !== "E_FEATURE_MISSING") {
            problems.push(`${name}() gave ${code}, not E_FEATURE_MISSING`);
          }
        }
        const stubNote = STUBS.includes(subpath)
          ? `, ${Object.keys(got.thrown).length} throw E_FEATURE_MISSING`
          : "";
        for (const problem of problems) {
          fail(`${label}: ${problem}`);
        }
        const partNote = absent.length
          ? ` (${absent.length} of 1.35's ${want.length} not built)`
          : "";
        rows.push(
          `${problems.length ? "✗" : "✓"} ${label.padEnd(36)} ${got.names.length} names${partNote}${stubNote} -> ${file.split("/@directive-run/core/")[1]}`,
        );
      }
    }
  }
  console.log(rows.join("\n"));
  for (const [subpath, names] of Object.entries(notBuilt)) {
    console.log(
      `not built in ${subpath} (${names.length}): ${names.join(" ")}`,
    );
  }

  // publint, strict, on exactly the files the tarball installed.
  const requireRoot = createRequire(join(repoRoot, "package.json"));
  const { publint } = await import(requireRoot.resolve("publint"));
  const { formatMessage } = await import(requireRoot.resolve("publint/utils"));
  const { messages } = await publint({
    pkgDir: installed,
    strict: true,
    pack: false,
  });
  for (const m of messages) {
    console.log(`publint ${m.type} ${m.code}: ${formatMessage(m, manifest)}`);
    fail(`publint ${m.type} ${m.code}`);
  }
  console.log(`publint (strict): ${messages.length} messages`);

  try {
    const attw = execFileSync(
      join(repoRoot, "node_modules/.bin/attw"),
      [tarball, "--profile", "node16", "--format", "ascii"],
      { cwd: repoRoot, encoding: "utf8" },
    );
    console.log(`attw (node16):\n${attw.trim()}`);
  } catch (error) {
    console.log(
      `attw (node16) failed:\n${error.stdout ?? ""}${error.stderr ?? ""}`,
    );
    fail("attw found problems");
  }
} finally {
  if (args.includes("--keep")) {
    console.log(`kept ${dir}`);
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures.length > 0) {
  console.error(
    `\nSMOKE FAILED (${failures.length}):\n  ${failures.join("\n  ")}`,
  );
  process.exit(1);
}
console.log("\nSMOKE OK");
