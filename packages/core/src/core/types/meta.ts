/**
 * Definition Metadata - Optional annotations for debugging and devtools
 */

// ============================================================================
// Definition Meta
// ============================================================================

/**
 * Optional metadata for module, fact, event, constraint, resolver, effect, and derivation definitions.
 *
 * Meta is purely informational — it is never read during the reconciliation
 * hot path. It surfaces in `system.inspect()`, `system.explain()`, and the
 * devtools plugin to provide human-readable context for debugging.
 *
 * **Note:** Meta values are string literals that survive minification and ship
 * in production bundles. Avoid putting internal API paths or sensitive business
 * logic in meta fields.
 *
 * @example
 * ```typescript
 * constraints: {
 *   needsLogin: {
 *     when: (facts) => !facts.user,
 *     require: { type: "LOGIN" },
 *     meta: { label: "Requires Auth", category: "auth" },
 *   },
 * },
 * ```
 */
export interface DefinitionMeta {
  /** Human-readable name shown in inspect(), explain(), and devtools. */
  label?: string;
  /** Longer explanation. Shown in explain() causal chains and devtools tooltips. */
  description?: string;
  /** Grouping key for devtools filtering. Suggested: "auth", "data", "ui", "logging", "lifecycle". */
  category?: string;
  /** CSS hex color for devtools visualization (e.g., "#f59e0b"). */
  color?: string;
  /** Multi-dimensional labels for filtering. Use alongside category for fine-grained grouping. */
  tags?: string[];
  /**
   * Whether a derivation picks up the tags of the facts it reads. Defaults to
   * `true`; only a derivation reads it.
   *
   * A tag on a fact is a claim about the value, and a derivation carries that
   * value forward — often unchanged — so `meta.byTag("pii")` reports a
   * derivation of a tagged fact as tagged too, and `meta.derivation(id)`
   * exposes what it picked up under {@link inheritedTags}.
   *
   * Set `false` where the derivation is the point at which the claim stops
   * holding: a hash, a bucket, a count, a redaction. That is a statement about
   * the value, and inheritance stops there for anything downstream too — a
   * derivation reading a sanitized one is not walked through to its inputs.
   *
   * Opting out is a separate key rather than an empty `tags: []` so that
   * "sanitized" and "tagged something unrelated" can both be said at once.
   */
  inheritsTags?: boolean;
  /**
   * Tags this derivation picked up from its inputs — read-only, never authored.
   *
   * Present on what `system.meta.derivation(id)` returns when the walk found
   * anything, and disjoint from {@link tags}: a tag the author wrote is
   * reported as authored, not as inherited.
   *
   * These reflect what the derivation read on its last computation. A body that
   * branches on a fact records the branch the current state takes, so this is
   * accurate about the value now and silent about the value in a state the
   * program has not reached.
   */
  readonly inheritedTags?: readonly string[];
  /** Extensible — plugins can read custom keys without core releases. */
  [key: string]: unknown;
}

/**
 * Freeze a meta object at registration time.
 * Uses `Object.create(null)` to prevent prototype pollution,
 * then `Object.freeze` to prevent mutation after registration.
 *
 * @internal
 */
export function freezeMeta(
  meta: DefinitionMeta | undefined,
): DefinitionMeta | undefined {
  if (!meta) {
    return undefined;
  }

  const frozen = Object.assign(Object.create(null), meta);
  // Deep-freeze tags array so meta.tags.push() throws
  if (Array.isArray(frozen.tags)) {
    Object.freeze(frozen.tags);
  }

  return Object.freeze(frozen);
}

/**
 * Type guard for derivation definitions using the object form `{ compute, meta }`.
 * Uses `Object.hasOwn` to avoid prototype chain traversal.
 *
 * @internal
 */
export function isDerivationWithMeta(
  def: unknown,
): def is { compute: (...args: unknown[]) => unknown; meta?: DefinitionMeta } {
  return (
    typeof def === "object" &&
    def !== null &&
    Object.hasOwn(def, "compute") &&
    typeof (def as Record<string, unknown>).compute === "function"
  );
}
