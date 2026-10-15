/**
 * Each project tests the engine it says it tests.
 *
 * Runs in every engine project. Every `@directive-run/core` specifier the
 * suite imports must load the very module instance a direct import of the
 * expected file loads, and must not load the other engine's. A config that
 * pointed core at a stub, at the wrong build, or at the workspace while
 * claiming to be v1 fails here.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { engine, enginePackageDir } from "../helpers/engine.js";
import { coreEntries } from "../lib/core-entries.js";

const build = process.env.DIRECTIVE_BUILD as "development" | "production";
const which = engine();

function pinnedVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dirname, "../package.json"), "utf8"),
  );
  const alias = pkg.devDependencies["directive-v1"] as string;

  return alias.replace(/^npm:@directive-run\/core@/, "");
}

/** Specifier → the file it must resolve to for this project. */
function expected(): Map<string, string> {
  const out = new Map<string, string>();
  if (which === "v1") {
    const dir = enginePackageDir();
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    for (const [subpath, target] of Object.entries(
      pkg.exports as Record<string, Record<string, { import?: string }>>,
    )) {
      const file = target[build]?.import;
      if (file) {
        out.set(
          subpath === "."
            ? "@directive-run/core"
            : `@directive-run/core/${subpath.slice(2)}`,
          join(dir, file),
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

describe(`engine identity (${which}, ${build})`, () => {
  it("knows which build it runs", () => {
    expect(["development", "production"]).toContain(build);
  });

  if (which === "v1") {
    it("is the pinned npm release", () => {
      const dir = enginePackageDir();
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      expect(dir).toMatch(/\/node_modules\/directive-v1$/);
      expect(pkg.name).toBe("@directive-run/core");
      expect(pkg.version).toBe(pinnedVersion());
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
    it(`${specifier} loads ${which === "v1" ? "the release" : "the workspace"} module`, async () => {
      const viaSuite = await import(/* @vite-ignore */ specifier);
      const direct = await import(/* @vite-ignore */ file);
      const name = Object.keys(direct).find(
        (k) => typeof direct[k] === "function",
      ) as string;
      expect(name).toBeDefined();
      expect(viaSuite[name]).toBe(direct[name]);
    });
  }

  it("is not the other engine", async () => {
    const core = await import("@directive-run/core");
    const local = coreEntries().find((e) => e.subpath === ".")?.file as string;
    const v1 = join(
      import.meta.dirname,
      "../node_modules/directive-v1/dist",
      build,
      "index.js",
    );
    const other = await import(/* @vite-ignore */ which === "v1" ? local : v1);
    expect(core.createSystem).not.toBe(other.createSystem);
  });
});
