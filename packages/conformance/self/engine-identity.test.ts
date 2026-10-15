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
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  engine,
  engineDistEntry,
  engineDistTypes,
  enginePackageDir,
} from "../helpers/engine.js";
import { coreEntries } from "../lib/core-entries.js";
import { checkV1Pin } from "../lib/v1-pin.js";

const build = process.env.DIRECTIVE_BUILD as "development" | "production";
const which = engine();
const root = resolve(import.meta.dirname, "..");
const v1Dir = join(root, "node_modules/directive-v1");
const coreDir = resolve(root, "../core");

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
  }

  return out;
}

type Module = Record<string, unknown>;

describe(`engine identity (${which}, ${build})`, () => {
  it("knows which build it runs", () => {
    expect(["development", "production"]).toContain(build);
  });

  it("finds the engine's package and build where it should", () => {
    const dir = which === "v1" ? v1Dir : coreDir;
    expect(enginePackageDir()).toBe(dir);
    expect(engineDistEntry()).toBe(join(dir, "dist/index.js"));
    expect(engineDistTypes()).toBe(join(dir, "dist/index.d.ts"));
    expect(existsSync(engineDistEntry())).toBe(true);
    expect(existsSync(engineDistTypes())).toBe(true);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.name).toBe("@directive-run/core");
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
    const other = await vi.importActual<Module>(which === "v1" ? local : v1);
    expect(core.createSystem).not.toBe(other.createSystem);
  });
});
