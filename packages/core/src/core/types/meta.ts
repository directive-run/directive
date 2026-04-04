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
