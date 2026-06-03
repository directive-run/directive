/**
 * Rule metadata registry — the canonical list every consumer queries
 * to discover rule IDs. Sourced from the executable-rule list in
 * `./rules.ts`; each rule contributes its own metadata so the two
 * surfaces can never drift.
 *
 * Stays frozen at module load. Adding a rule means dropping a file
 * in `./rules/<id>.ts` and importing it from `./rules.ts` — no
 * registry edit needed.
 */

import { getExecutableRules } from "./rules.js";
import type { RuleMetadata } from "./types.js";

let cached: readonly RuleMetadata[] | null = null;

export function getAllRuleMetadata(): readonly RuleMetadata[] {
  if (!cached) {
    cached = Object.freeze(getExecutableRules().map((r) => r.metadata));
  }
  return cached;
}

export function getRuleMetadataById(id: string): RuleMetadata | undefined {
  return getAllRuleMetadata().find((r) => r.id === id);
}
