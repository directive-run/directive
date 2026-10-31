/**
 * Each project tests the engine it says it tests.
 *
 * Runs in every engine project. For every published entry point, the module
 * the suite imports must be, export for export, the same objects as the
 * unmocked module (`vi.importActual`) at the file this project should
 * resolve, and no export may be a mock. A config that points core at a stub,
 * at the wrong build or at the other engine, or a setup file that mocks or
 * wraps core, fails here.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  engine,
  engineDistEntry,
  engineDistTypes,
  enginePackageDir,
} from "../helpers/engine.js";
import { coreEntries, v2DistEntries, v2Entries } from "../lib/core-entries.js";
import { checkV1Pin } from "../lib/v1-pin.js";

const build = process.env.DIRECTIVE_BUILD as "development" | "production";
const which = engine();
/** The `:dist` projects run core-next's built output instead of its source. */
const dist = process.env.DIRECTIVE_V2_TARGET === "dist";
const root = resolve(import.meta.dirname, "..");
const v1Dir = join(root, "node_modules/directive-v1");
const coreDir = resolve(root, "../core");
const nextDir = resolve(root, "../core-next");

function pinnedVersion(): string {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  return (pkg.devDependencies["directive-v1"] as string).replace(
    /^npm:@directive-run\/core@/,
    "",
  );
}

/** Specifier → the file it must resolve to, derived from the filesystem. */
function expected(): Map<string, string> {
  const out = new Map<string, string>();
  if (which === "v1") {
    const pkg = JSON.parse(readFileSync(join(v1Dir, "package.json"), "utf8"));
    for (const [subpath, target] of Object.entries(
      pkg.exports as Record<string, Record<string, { import?: string }>>,
    )) {
      const file = target[build]?.import;
      if (file) {
        out.set(
          subpath === "."
            ? "@directive-run/core"
            : `@directive-run/core/${subpath.slice(2)}`,
          join(v1Dir, file),
        );
      }
    }
  } else if (which === "local") {
    for (const entry of coreEntries()) {
      out.set(entry.specifier, entry.file);
    }
  } else {
    // core-next's source, or its dist on the `:dist` projects; entries it has
    // not built yet resolve to src/unbuilt.ts (lib/core-entries.ts).
    for (const entry of dist ? v2DistEntries(undefined, build) : v2Entries()) {
      out.set(entry.specifier, entry.file);
    }
  }

  return out;
}

type Module = Record<string, unknown>;

describe(`engine identity (${which}${dist ? " dist" : ""}, ${build})`, () => {
  it("knows which build it runs", () => {
    expect(["development", "production"]).toContain(build);
    expect(dist ? which : "v2").toBe("v2");
    if (dist) {
      // Each :dist project runs the build its condition selects, whose dev
      // check is a literal; NODE_ENV must still agree with it, as on v1.
      expect(process.env.NODE_ENV === "production").toBe(
        build === "production",
      );
    }
  });

  it("finds the engine's package and build where it should", () => {
    const dir = which === "v1" ? v1Dir : which === "v2" ? nextDir : coreDir;
    expect(enginePackageDir()).toBe(dir);
    expect(engineDistEntry()).toBe(join(dir, "dist/index.js"));
    expect(engineDistTypes()).toBe(join(dir, "dist/index.d.ts"));
    expect(existsSync(engineDistEntry())).toBe(true);
    expect(existsSync(engineDistTypes())).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe(
      which === "v2" ? "@directive-run/core-next" : "@directive-run/core",
    );
    if (which === "v1") {
      expect(pkg.version).toBe(pinnedVersion());
    }
  });

  if (which === "v1") {
    it("is byte for byte the npm tarball the lockfile names", () => {
      expect(
        checkV1Pin({
          pin: JSON.parse(readFileSync(join(root, "v1-pin.json"), "utf8")),
          pinnedVersion: pinnedVersion(),
          lockfile: readFileSync(resolve(root, "../../pnpm-lock.yaml"), "utf8"),
          packageDir: v1Dir,
        }),
      ).toEqual([]);
    });
  }

  const files = expected();
  it("covers every published entry point", () => {
    expect([...files.keys()].sort()).toEqual(
      coreEntries()
        .map((e) => e.specifier)
        .sort(),
    );
  });

  for (const [specifier, file] of files) {
    it(`${specifier} is the unmocked module at ${which === "v1" ? "the release" : "the workspace"}`, async () => {
      const viaSuite = (await import(/* @vite-ignore */ specifier)) as Module;
      const actual = await vi.importActual<Module>(specifier);
      const atFile = await vi.importActual<Module>(file);
      const keys = Object.keys(atFile).sort();
      expect(keys.length).toBeGreaterThan(0);
      if (which === "v2" && file.endsWith("/unbuilt.ts")) {
        // Every unbuilt entry maps to the one stub, so the identity checks
        // below only prove the alias reaches it. Pin that: the stub's sole
        // export, and the census fails any v2 test that runs in a file
        // importing it (lib/census.ts unbuiltSpecifiers). When core-next
        // builds the entry, v2Entries maps it to a real file and this branch
        // stops applying.
        expect(keys).toEqual(["UNBUILT"]);
      }
      expect(Object.keys(viaSuite).sort()).toEqual(keys);
      expect(Object.keys(actual).sort()).toEqual(keys);
      for (const key of keys) {
        expect(viaSuite[key], key).toBe(atFile[key]);
        expect(actual[key], key).toBe(atFile[key]);
        expect(vi.isMockFunction(viaSuite[key]), key).toBe(false);
      }
    });
  }

  it("is not the other engine", async () => {
    const core = await vi.importActual<Module>("@directive-run/core");
    const local = coreEntries().find((e) => e.subpath === ".")?.file as string;
    const v1 = join(v1Dir, "dist", build, "index.js");
    // Transforming a source tree is the slow part of this test (4.3 s of its
    // 5 s timeout under CI load), so on v2 it loads only what is cheap and
    // proves the rest from paths, which load nothing:
    // - The workspace's 1.35 source is not loaded. The release (`v1`) is that
    //   engine, pinned byte for byte, so a core-next that forwarded to 1.35 is
    //   caught there; core pointed at the 1.35 directory fails the path check.
    // - The dist project does not load core-next's source to compare. An alias
    //   to the source fails the path check, and the per-entry tests above fail
    //   it too (the suite would hold the source's objects, not the dist's).
    //   The source project does compare against the built dist (one small file).
    const others =
      which === "v2"
        ? [v1, ...(dist ? [] : [join(nextDir, "dist/index.js")])]
        : [which === "v1" ? local : v1];
    if (which === "v2") {
      const home = join(nextDir, dist ? "dist" : "src") + sep;
      const unbuilt = join(nextDir, "src/unbuilt.ts");
      for (const file of files.values()) {
        expect(file.startsWith(home) || file === unbuilt, file).toBe(true);
      }
    }
    // Together, not one after another: the transforms overlap their file reads.
    const loaded = await Promise.all(
      others.map((file) => vi.importActual<Module>(file)),
    );
    for (const other of loaded) {
      expect(core.createSystem).not.toBe(other.createSystem);
    }
  });
});
