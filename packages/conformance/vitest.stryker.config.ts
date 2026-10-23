/**
 * Vitest config for Stryker: only the two projects that run the suite against
 * the workspace core SOURCE (conformance:local, conformance:local:prod).
 * Those alias @directive-run/core to packages/core/src (lib/core-entries.ts),
 * so a mutant written into core/src is what the tests execute.
 *
 * Files in the `internals` category (layers.json) are left out: conformance:v2
 * skips them, so a mutant only they kill is a behaviour the 2.0 oracle does
 * not pin.
 *
 * `MUTATION_LAYER=Ln` sets a layer ceiling: every test placed above Ln
 * (layers.json) is left out, the way conformance:v2 leaves it out until Ln is
 * built. Files whose every test sits above Ln are excluded outright; the rest
 * are gated per test by helpers/layer-gate.ts (DIRECTIVE_MUTATION_CEILING),
 * which skips before the body runs, so a skipped test neither covers nor
 * kills. Run a layer's files with that layer's ceiling (MUTATION.md table) and
 * the score counts only kills by tests that run on v2 at that layer. Without
 * the variable nothing above the internals exclusion changes.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

type Project = {
  test?: { name?: string; exclude?: string[]; env?: Record<string, string> };
};
const projects = (base.test?.projects ?? []) as Project[];

const layers = JSON.parse(
  readFileSync(join(import.meta.dirname, "layers.json"), "utf8"),
) as {
  files: Record<
    string,
    { category: string; tests: Record<string, { layer: string }> }
  >;
};

const ceilingName = process.env.MUTATION_LAYER;
if (ceilingName !== undefined && !/^L(?:[0-9]|1[0-3])$/.test(ceilingName)) {
  throw new Error(`MUTATION_LAYER must be L0..L13, got "${ceilingName}"`);
}
const ceiling =
  ceilingName === undefined ? undefined : Number(ceilingName.slice(1));
const allAbove = (tests: Record<string, { layer: string }>) =>
  ceiling !== undefined &&
  Object.values(tests).every((t) => Number(t.layer.slice(1)) > ceiling);

const v2Skipped = Object.entries(layers.files)
  .filter(([, f]) => f.category === "internals" || allAbove(f.tests))
  .map(([file]) => file);
const ceilingEnv: Record<string, string> =
  ceilingName === undefined ? {} : { DIRECTIVE_MUTATION_CEILING: ceilingName };

export default defineConfig({
  test: {
    projects: projects
      .filter((p) =>
        ["conformance:local", "conformance:local:prod"].includes(
          p.test?.name ?? "",
        ),
      )
      .map((p) => ({
        ...p,
        test: {
          ...p.test,
          exclude: [...(p.test?.exclude ?? []), ...v2Skipped],
          env: { ...p.test?.env, ...ceilingEnv },
        },
      })) as never,
  },
});
