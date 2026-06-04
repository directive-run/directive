/**
 * Rule metadata registry. Sources from `./rule-metadata.ts` which
 * has zero `ts-morph` dependency chain — so `index.ts`'s static
 * import of this module does NOT eagerly load ts-morph at consumer
 * `import` time (the v0.1.0 / v0.2.0 regression that AE Audit
 * 0.2.2 P0-1 flagged).
 *
 * Executable rule implementations live in `./rules/*.ts` and load
 * ts-morph; they're loaded only when `runRules` / `applyFix` is
 * actually called via the `./executable.ts` entry.
 *
 * The api.test.ts "metadata array matches executable rules" test
 * verifies `./rule-metadata.ts` stays in sync with the actual
 * rule implementations.
 */

import { RULE_METADATA } from "./rule-metadata.js";
import type { RuleMetadata } from "./types.js";

export function getAllRuleMetadata(): readonly RuleMetadata[] {
  return RULE_METADATA;
}

export function getRuleMetadataById(id: string): RuleMetadata | undefined {
  return RULE_METADATA.find((r) => r.id === id);
}
