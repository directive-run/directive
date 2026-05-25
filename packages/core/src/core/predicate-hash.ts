/**
 * `predicateHash` — content-addressed fingerprint for a {@link FactPredicate}.
 *
 * Canonicalized via `stableStringify` so semantically-identical predicates
 * (different key order, different whitespace) produce the same hash.
 * Uses djb2 32-bit (8-character hex). SHA-256 reserved for v2.
 *
 * @module
 */

import { hashObject } from "../utils/utils.js";
import type { FactPredicate } from "./types/predicate.js";

/**
 * Compute a content-addressed hash for a {@link FactPredicate}. Canonicalised
 * via `stableStringify` so two semantically-identical predicates emitted
 * with different key order or whitespace produce the same hash.
 *
 * Suitable for:
 * - Cache keys, dedupe in `sweepUnder`
 * - Audit-ledger entry indexing (the `whenSpec` field has its own hash chain)
 * - Provenance records (`predicateFromIntentWithProvenance.predicateHash`)
 *
 * **NOT suitable for cryptographic use** — 32-bit djb2 is collision-prone
 * against an adversary. SHA-256 is reserved for v2.
 *
 * @example
 * ```ts
 * predicateHash({ cartTotal: { $gte: 50 } });
 * // → "a1b2c3d4" (stable across runs and runtimes)
 *
 * // Two semantically-identical predicates → same hash
 * predicateHash({ a: 1, b: 2 }) === predicateHash({ b: 2, a: 1 }); // true
 * ```
 */
export function predicateHash<F = Record<string, unknown>>(
  spec: FactPredicate<F>,
): string {
  return hashObject(spec);
}
