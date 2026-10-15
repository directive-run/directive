/**
 * Facts about the engine under test, for the few tests that need more than
 * its public API.
 *
 * Each vitest project sets DIRECTIVE_ENGINE. A test that has to reach the
 * engine's built output (one spawns a child process that imports it, one
 * typechecks against its declarations) asks here instead of computing a path
 * relative to its own location.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export type Engine = "v1" | "local" | "v2";

export function engine(): Engine {
  const value = process.env.DIRECTIVE_ENGINE;
  if (value === "v1" || value === "local" || value === "v2") {
    return value;
  }
  throw new Error(
    `DIRECTIVE_ENGINE is ${JSON.stringify(value)}; run the suite through packages/conformance/vitest.config.ts`,
  );
}

/** The repository root, for workspace tools such as `tsc`. */
export function workspaceRoot(): string {
  return resolve(here, "../../..");
}

/** The engine's package directory. */
export function enginePackageDir(): string {
  switch (engine()) {
    case "v1":
      // Not require.resolve: the package's exports do not expose package.json.
      return resolve(here, "../node_modules/directive-v1");
    case "local":
      return resolve(here, "../../core");
    case "v2":
      return resolve(here, "../../core-next");
  }
}

/** Absolute path of the engine's built ESM entry (`dist/index.js`). */
export function engineDistEntry(): string {
  return resolve(enginePackageDir(), "dist/index.js");
}

/** Absolute path of the engine's published declarations. */
export function engineDistTypes(): string {
  return resolve(enginePackageDir(), "dist/index.d.ts");
}
