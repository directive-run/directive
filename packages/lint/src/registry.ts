/**
 * Rule registry — the canonical list of every known Directive
 * anti-pattern, whether or not it has an AST `check()` implemented.
 *
 * The registry stays the metadata source-of-truth so
 * `list_review_rules` returns a stable surface across releases.
 * Rules with `executable: true` ship with a `check()` function
 * registered separately in `./rules.ts`. Rules with `fixable: true`
 * ship a `fix()` alongside.
 *
 * v0.1.0 ships the metadata layer with an empty executable + fixable
 * set. v0.2.0 of the wider `@directive-run/mcp` plan populates the
 * 10 ts-morph rules; future versions can add more without changing
 * the public API.
 */

import type { RuleMetadata } from "./types.js";

/**
 * The complete metadata-only registry. Frozen at module load. Each
 * entry's `executable` and `fixable` flags reflect what `./rules.ts`
 * actually registers — keep them in sync.
 */
const REGISTRY: readonly RuleMetadata[] = Object.freeze([
  // v0.2.0 rules go here. v0.1.0 ships an empty registry — the
  // package skeleton exists so MCP can wire up against a stable
  // public API while the rules are implemented in the next round.
] satisfies RuleMetadata[]);

export function getAllRuleMetadata(): readonly RuleMetadata[] {
  return REGISTRY;
}

export function getRuleMetadataById(id: string): RuleMetadata | undefined {
  return REGISTRY.find((r) => r.id === id);
}
