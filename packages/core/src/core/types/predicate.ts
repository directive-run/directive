/**
 * Data-configuration predicates and templates (RFC-0004).
 *
 * A {@link FactPredicate} is a declarative, serializable boolean spec over a
 * module's fact + derivation namespace — the data form of a constraint
 * `when`, an effect `on`, or a boolean derivation. A {@link FactTemplate} is
 * the value-producing counterpart: a fact-interpolating string.
 *
 * Sigil discipline: `$` marks an *operator/expression node* inside a
 * predicate or template body (`$eq`, `$gte`, `$all`, `$template`, `$set`,
 * `$ref`). Definition arms (`compute`, `handler`, `patch`) stay sigil-free.
 *
 * Operators are `$`-prefixed so they can never collide with a fact key —
 * schema keys starting with `$` are already rejected by `engine.validateKeys`.
 */

// ============================================================================
// Operators
// ============================================================================

/** Comparison operator names — the `$`-prefixed keys inside an operator object. */
export type PredicateOp =
  | "$eq"
  | "$ne"
  | "$in"
  | "$nin"
  | "$exists"
  | "$gt"
  | "$gte"
  | "$lt"
  | "$lte"
  | "$between"
  | "$matches"
  | "$contains"
  | "$changed";

/** Combinator node keys. */
export type PredicateCombinatorKey = "$all" | "$any" | "$not";

/** Every reserved `$`-key recognized inside a predicate body. */
export const PREDICATE_OPERATORS: ReadonlySet<string> = new Set<string>([
  "$eq",
  "$ne",
  "$in",
  "$nin",
  "$exists",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$between",
  "$matches",
  "$contains",
  "$changed",
]);

/** Combinator keys, as a runtime set. */
export const PREDICATE_COMBINATORS: ReadonlySet<string> = new Set<string>([
  "$all",
  "$any",
  "$not",
]);

// ============================================================================
// Operator object
// ============================================================================

/**
 * `true` when `V` supports relational operators (`$gt` … `$between`).
 * `[V]` tuple-wrapping suppresses distribution over union-typed facts.
 */
type IsOrderable<V> = [V] extends [number | bigint | Date]
  ? true
  : [V] extends [string]
    ? true
    : false;

/**
 * The operator object permitted for a fact of type `V`. Built as a
 * **per-operator union** (one operator per member) rather than an
 * intersection — a typo'd operator (`$eqq`) then matches no member and is a
 * compile error, and a relational operator on a non-orderable fact resolves
 * to `never`.
 */
export type OperatorObject<V> =
  | { $eq: V }
  | { $ne: V }
  | { $in: readonly V[] }
  | { $nin: readonly V[] }
  | { $exists: boolean }
  | { $changed: true }
  | (IsOrderable<V> extends true
      ?
          | { $gt: V }
          | { $gte: V }
          | { $lt: V }
          | { $lte: V }
          | { $between: readonly [V, V] }
      : never)
  | ([V] extends [string]
      ? { $matches: RegExp | string } | { $contains: string }
      : never)
  | ([V] extends [readonly (infer E)[]] ? { $contains: E } : never);

/**
 * The spec for a single fact key: a bare value (equality), an operator
 * object, or — for an object-typed fact — a nested predicate (partial match).
 */
type PredicateField<V> =
  | V
  | OperatorObject<V>
  | ([V] extends [readonly unknown[]]
      ? never
      : [V] extends [object]
        ? PredicateObject<V>
        : never);

// ============================================================================
// FactPredicate
// ============================================================================

/**
 * Object form — every key is a fact/derivation name, every value a
 * {@link PredicateField}. Multiple keys are AND-ed. A nested object value
 * recurses (partial match), which is how cross-module namespaced predicates
 * (`{ self: { phase: "red" }, auth: { token: { $exists: true } } }`) work.
 */
export type PredicateObject<F> = {
  [K in keyof F]?: PredicateField<F[K]>;
};

/** Array form — explicit clauses, AND-ed. The codegen/devtools-friendly form. */
export type PredicateClause<F> = {
  [K in keyof F]: { readonly fact: K; readonly op: PredicateOp; readonly value: unknown };
}[keyof F];

/** Combinator node — exactly one of `$all` / `$any` / `$not`. */
export type PredicateCombinator<F> =
  | { $all: readonly FactPredicate<F>[]; $any?: never; $not?: never }
  | { $any: readonly FactPredicate<F>[]; $all?: never; $not?: never }
  | { $not: FactPredicate<F>; $all?: never; $any?: never };

/**
 * A declarative boolean spec over a fact + derivation namespace `F`.
 * The data form of a constraint `when`, an effect `on`, or a boolean
 * derivation. Accepts an object form, an array-of-clauses form, or a
 * combinator node.
 */
export type FactPredicate<F> =
  | PredicateObject<F>
  | readonly PredicateClause<F>[]
  | PredicateCombinator<F>;

// ============================================================================
// FactTemplate
// ============================================================================

/**
 * A fact-interpolating string expression. `${key}` placeholders are replaced
 * with the named fact's value; `$${` emits a literal `${`. The value-producing
 * counterpart to {@link FactPredicate} — usable as a string derivation, a
 * constraint `require` field value, or an event `patch` value.
 *
 * @example { $template: "Phase ${phase} for ${elapsed}s" }
 */
export interface FactTemplate {
  readonly $template: string;
}

// ============================================================================
// Selectors (resolver key, event patch)
// ============================================================================

/**
 * A resolver dedup key written as data: an ordered list of requirement-payload
 * field names. `key: ["type", "to"]` dedupes requirements by those fields.
 */
export type KeySelector<R> = readonly (keyof R & string)[];

/** A typed single-field copy from an event payload. */
export interface PayloadRef<P> {
  readonly $ref: keyof P & string;
}

/** A patch value: a literal, a typed payload copy, or (for string facts) a template. */
export type PatchValue<V, P> =
  | V
  | PayloadRef<P>
  | ([V] extends [string] ? FactTemplate : never);

/**
 * An event handler written as data: assigns facts from literals, payload
 * fields (`$ref`), or interpolated strings (`$template`).
 *
 * @example { $set: { status: "active", label: { $template: "user ${name}" } } }
 */
export interface PatchSpec<F, P> {
  readonly $set: { [K in keyof F]?: PatchValue<F[K], P> };
}

// ============================================================================
// Explain
// ============================================================================

/** The per-clause result of an explained predicate evaluation. */
export interface ClauseResult {
  /** Dotted path to the fact/derivation (`elapsed`, `auth.token`). */
  readonly path: string;
  /** The operator applied (`$gte`, `$eq`, …) — `$eq` for a bare value. */
  readonly op: PredicateOp | PredicateCombinatorKey;
  /** The value the predicate expected. */
  readonly expected: unknown;
  /** The actual fact value at evaluation time. */
  readonly actual: unknown;
  /** Whether this clause passed. */
  readonly pass: boolean;
}
