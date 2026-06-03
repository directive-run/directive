/**
 * Aggregates every executable rule that ships in this version. Used
 * by `runRules` and `applyFix` in `./index.ts`.
 *
 * v0.2.0 ships these 10 rules. Adding a new rule:
 *   1. Drop a new file under `./rules/<id>.ts` exporting `rule: ExecutableRule`.
 *   2. Import it here, push into `EXECUTABLE_RULES`.
 *   3. Add a fixture test in `__tests__/rules/<id>.test.ts`.
 *   4. The `list_review_rules` MCP tool's output flips `executable: true`
 *      automatically because it reads from `getRules()`, which reflects
 *      what this file registers.
 */

import { rule as constraintWithoutWhenOrRequire } from "./rules/constraint-without-when-or-require.js";
import { rule as derivationUsesImportedState } from "./rules/derivation-uses-imported-state.js";
import { rule as effectMutatesFacts } from "./rules/effect-mutates-facts.js";
import { rule as imperativeTaskInEffect } from "./rules/imperative-task-in-effect.js";
import { rule as moduleMissingFactsSchema } from "./rules/module-missing-facts-schema.js";
import { rule as moduleNameNotKebab } from "./rules/module-name-not-kebab.js";
import { rule as noSingleLineIfReturn } from "./rules/no-single-line-if-return.js";
import { rule as resolverNamingMismatch } from "./rules/resolver-naming-mismatch.js";
import { rule as resolverNotAsync } from "./rules/resolver-not-async.js";
import type { ExecutableRule } from "./rules/types.js";
import { rule as useStateAlongsideFacts } from "./rules/useState-alongside-facts.js";

const EXECUTABLE_RULES: readonly ExecutableRule[] = Object.freeze([
  noSingleLineIfReturn,
  moduleMissingFactsSchema,
  resolverNotAsync,
  derivationUsesImportedState,
  effectMutatesFacts,
  useStateAlongsideFacts,
  constraintWithoutWhenOrRequire,
  resolverNamingMismatch,
  moduleNameNotKebab,
  imperativeTaskInEffect,
]);

export function getExecutableRules(): readonly ExecutableRule[] {
  return EXECUTABLE_RULES;
}

export function getExecutableRuleById(id: string): ExecutableRule | undefined {
  return EXECUTABLE_RULES.find((r) => r.metadata.id === id);
}

export type { ExecutableRule } from "./rules/types.js";
