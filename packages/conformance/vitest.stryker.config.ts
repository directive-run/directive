/**
 * Vitest config for Stryker: only the two projects that run the suite against
 * the workspace core SOURCE (conformance:local, conformance:local:prod).
 * Those alias @directive-run/core to packages/core/src (lib/core-entries.ts),
 * so a mutant written into core/src is what the tests execute.
 */

import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

type Project = { test?: { name?: string } };
const projects = (base.test?.projects ?? []) as Project[];

export default defineConfig({
  test: {
    projects: projects.filter((p) =>
      ["conformance:local", "conformance:local:prod"].includes(
        p.test?.name ?? "",
      ),
    ) as never,
  },
});
