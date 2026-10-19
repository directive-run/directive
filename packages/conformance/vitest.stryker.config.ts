/**
 * Vitest config for Stryker: only the two projects that run the suite against
 * the workspace core SOURCE (conformance:local, conformance:local:prod).
 * Those alias @directive-run/core to packages/core/src (lib/core-entries.ts),
 * so a mutant written into core/src is what the tests execute.
 *
 * Files in the `internals` category (layers.json) are left out: conformance:v2
 * skips them, so a mutant only they kill is a behaviour the 2.0 oracle does
 * not pin. The score counts only kills by tests that also run on v2.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

type Project = { test?: { name?: string; exclude?: string[] } };
const projects = (base.test?.projects ?? []) as Project[];

const layers = JSON.parse(
  readFileSync(join(import.meta.dirname, "layers.json"), "utf8"),
) as { files: Record<string, { category: string }> };
const v2Skipped = Object.entries(layers.files)
  .filter(([, f]) => f.category === "internals")
  .map(([file]) => file);

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
        },
      })) as never,
  },
});
