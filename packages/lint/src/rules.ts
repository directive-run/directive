/**
 * Executable rules — each entry knows how to walk a ts-morph
 * `SourceFile` and emit findings, and (optionally) how to apply a
 * mechanical fix for one of those findings.
 *
 * v0.1.0 ships an empty list. Phase 5a populates the 10 rules:
 *
 * - no-single-line-if-return (fixable)
 * - module-missing-facts-schema
 * - resolver-not-async (fixable)
 * - derivation-uses-imported-state
 * - effect-mutates-facts
 * - useState-alongside-facts (fixable)
 * - constraint-without-when-or-require
 * - resolver-naming-mismatch (fixable)
 * - module-name-not-kebab (fixable)
 * - imperative-task-in-effect
 */

import type { Finding, RuleMetadata } from "./types.js";

/**
 * Minimal SourceFile interface — declared as `unknown` so
 * `./types.ts` and `./registry.ts` can be consumed without ts-morph
 * installed (a `list_review_rules` caller is read-only and doesn't
 * need the runtime). The actual implementations in `./worker.ts`
 * import ts-morph and cast.
 */
export type SourceFileLike = unknown;

export interface ExecutableRule {
  metadata: RuleMetadata;
  check(sourceFile: SourceFileLike): Finding[];
  fix?(
    sourceFile: SourceFileLike,
    finding: Finding,
  ): {
    fixedSource: string;
  };
}

const EXECUTABLE_RULES: readonly ExecutableRule[] = Object.freeze([
  // Populated in Phase 5a.
] satisfies ExecutableRule[]);

export function getExecutableRules(): readonly ExecutableRule[] {
  return EXECUTABLE_RULES;
}

export function getExecutableRuleById(id: string): ExecutableRule | undefined {
  return EXECUTABLE_RULES.find((r) => r.metadata.id === id);
}
