/**
 * A downstream package must be tested against core's SOURCE, not its build.
 *
 * `pnpm test` runs the suites without building, and a package import resolves
 * through `node_modules` to `dist/`. So a change to core was invisible to every
 * downstream suite until someone happened to rebuild — the packages a core
 * defect breaks were structurally unable to catch it. It surfaced only when a
 * reviewer's probe kept reporting behaviour that had already been fixed, while
 * the whole monorepo ran green.
 *
 * Identity is the test. With the alias in `vitest.config.ts` the specifier and
 * the source file are the same module. Without it the specifier resolves into
 * `dist`, and the mismatch is visible at a glance because the built output is
 * minified: the function arrives named `Je`.
 *
 * It sits beside `src/` rather than inside it because reaching into another
 * package by relative path is what this package's own `tsconfig` refuses, and
 * should. Placing it here keeps the specifier resolving the way a consumer's
 * would — through this package's `node_modules` — which is the thing under
 * test.
 */

import { createSystem as viaSpecifier } from "@directive-run/core";
import { createAuditLedger as ledgerViaSpecifier } from "@directive-run/core/plugins";
import { describe, expect, it } from "vitest";
import { createSystem as viaSource } from "../../core/src/index.js";
import { createAuditLedger as ledgerViaSource } from "../../core/src/plugins/index.js";

describe("cross-package resolution", () => {
  it("resolves a package root to source", () => {
    expect(viaSpecifier).toBe(viaSource);
  });

  it("resolves a package subpath to source", () => {
    // Subpaths are the half most likely to rot: the built layout does not
    // mirror the source layout, so the mapping is read from each package's
    // build config rather than guessed at.
    expect(ledgerViaSpecifier).toBe(ledgerViaSource);
  });
});
