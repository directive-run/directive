/**
 * Definition Metadata - Optional annotations for debugging and devtools
 */

// ============================================================================
// Definition Meta
// ============================================================================

/**
 * Optional metadata for module, fact, event, constraint, resolver, effect, and derivation definitions.
 *
 * `label`, `description`, `category` and `color` are informational — they are
 * read only by `system.inspect()`, `system.explain()`, and the devtools plugin,
 * to give a human something to read while debugging.
 *
 * **`tags` and `tagBoundary` are not.** They decide what gets redacted before a
 * value reaches a model, a log, or an audit ledger, and `system.meta
 * .carriesTag()` is designed to be asked on every fact write. That question is
 * O(1) for a fact, because tags are fixed at registration and the runtime keeps
 * its own copy.
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
   * Marks this derivation as the point where tag inheritance stops. Defaults to
   * `false`; only a derivation reads it.
   *
   * A tag on a fact is a claim about the value, and a derivation carries that
   * value forward — often unchanged — so `meta.byTag("pii")` reports a
   * derivation of a tagged fact as tagged too, and `meta.derivation(id)`
   * exposes what it picked up under {@link inheritedTags}.
   *
   * Set `true` where the derivation is the point at which the claim stops
   * holding: a hash, a bucket, a count, a redaction. Inheritance stops there
   * for everything downstream too — a derivation reading a boundary is not
   * walked through to its inputs.
   *
   * **This stops tag propagation and nothing else.** The runtime does not
   * inspect the value and cannot tell whether the claim really stopped holding;
   * it is your declaration, taken at face value. Named for the mechanism rather
   * than the intent for exactly that reason — a name promising the value was
   * scrubbed would be a guarantee nothing here makes.
   *
   * A separate key rather than an empty `tags: []` so that "the claim stops
   * here" and "tagged something unrelated" can both be said at once.
   */
  tagBoundary?: boolean;
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

  // `tags` decides whether a value is redacted, so it has to be a plain array
  // of strings and nothing cleverer. An Array subclass passes `Array.isArray`
  // while overriding `includes`, which would let the tag answer a different
  // way on each call — the value would be screened or not depending on when
  // you asked. Copied into a fresh array so the caller cannot keep a handle
  // on the one the runtime reads.
  if (frozen.tags !== undefined) {
    if (!Array.isArray(frozen.tags)) {
      throw new Error(
        "[Directive] meta.tags must be an array of strings, and it decides what gets redacted — so it is read strictly.",
      );
    }
    if (Object.getPrototypeOf(frozen.tags) !== Array.prototype) {
      throw new Error(
        "[Directive] meta.tags must be a plain array. A subclass can override `includes` and answer differently on each call, which would make redaction depend on when it was asked.",
      );
    }
    for (const tag of frozen.tags) {
      if (typeof tag !== "string") {
        throw new Error(
          `[Directive] meta.tags must contain only strings; got ${typeof tag}.`,
        );
      }
    }
    frozen.tags = Object.freeze([...frozen.tags]);
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
