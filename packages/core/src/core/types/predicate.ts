/**
 * Data-configuration predicates and templates.
 *
 * A {@link FactPredicate} is a declarative, serializable boolean spec over a
 * module's fact + derivation namespace — the data form of a constraint
 * `when`, an effect `on`, or a boolean derivation. A {@link FactTemplate} is
 * the value-producing counterpart: a fact-interpolating string.
 *
 * Convention: `$` marks an operator/expression node inside a predicate or
 * template body (`$eq`, `$gte`, `$all`, `$template`, `$set`, `$ref`).
 * Definition arms (`compute`, `handler`, `patch`) stay sigil-free.
 *
 * Operators are `$`-prefixed so they can never collide with a fact key —
 * schema keys starting with `$` are rejected at registration.
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
  | "$startsWith"
  | "$endsWith"
  | "$contains"
  | "$changed";

/** Combinator node keys. */
export type PredicateCombinatorKey = "$all" | "$any" | "$not";

/**
 * Every reserved `$`-key recognized inside a predicate body.
 *
 * @internal
 */
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
  "$startsWith",
  "$endsWith",
  "$contains",
  "$changed",
]);

/**
 * Combinator keys, as a runtime set.
 *
 * @internal
 */
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
 *
 * One operator per object — for two operators on the same fact, write the
 * array form or `$all`. This is by design (the type is the source of truth).
 *
 * `$matches` accepts a `RegExp` only — string operands cannot express flags
 * (case-insensitivity, dotall, etc.), so the type rejects them. Pass a real
 * `RegExp` instance for flag control. (The runtime still accepts a string
 * operand for one cycle for back-compat, but emits a dev-warn.)
 *
 * @example
 * ```ts
 * const op1: OperatorObject<number> = { $gte: 30 };
 * const op2: OperatorObject<string> = { $matches: /^J/i };
 * const op3: OperatorObject<string> = { $in: ["red", "yellow"] };
 * const op4: OperatorObject<string> = { $startsWith: "Ada" };
 * const op5: OperatorObject<string> = { $endsWith: ".com" };
 * ```
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
      ?
          | { $matches: RegExp }
          | { $contains: string }
          | { $startsWith: string }
          | { $endsWith: string }
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
  [K in keyof F]: {
    readonly fact: K;
    readonly op: PredicateOp;
    readonly value: unknown;
  };
}[keyof F];

/** Combinator node — exactly one of `$all` / `$any` / `$not`. */
export type PredicateCombinator<F> =
  | { $all: readonly FactPredicate<F>[]; $any?: never; $not?: never }
  | { $any: readonly FactPredicate<F>[]; $all?: never; $not?: never }
  | { $not: FactPredicate<F>; $all?: never; $any?: never };

/**
 * A declarative boolean spec over a fact namespace `F`. The data form of a
 * constraint `when`, an effect `on`, or a boolean derivation. Accepts an
 * object form, an array-of-clauses form, or a combinator node.
 *
 * Keys are **fact names only** — derivations are not addressable from inside
 * a predicate. To gate on a derivation, either reference the underlying fact
 * the derivation reads, or fall back to the function form of `when` / `on`.
 *
 * @example
 * ```ts
 * // Object form (the common case)
 * const p1: FactPredicate<{ phase: string; elapsed: number }> = {
 *   phase: "red",
 *   elapsed: { $gte: 30 },
 * };
 *
 * // Combinator form
 * const p2: FactPredicate<{ phase: string }> = {
 *   $any: [{ phase: "red" }, { phase: "yellow" }],
 * };
 * ```
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
 *
 * @example
 * ```ts
 * resolvers: {
 *   fetch: {
 *     requirement: "FETCH",
 *     key: ["url", "method"] satisfies KeySelector<{ url: string; method: string }>,
 *     resolve: doFetch,
 *   },
 * }
 * ```
 */
export type KeySelector<R> = readonly (keyof R & string)[];

/**
 * A typed single-field copy from an event payload. Lives in the patch-spec
 * namespace — used inside a {@link PatchSpec} `$set` value.
 *
 * @example
 * ```ts
 * patch: { $set: { userId: { $ref: "id" } satisfies PayloadRef<{ id: string }> } }
 * ```
 */
export interface PayloadRef<P> {
  readonly $ref: keyof P & string;
}

/**
 * A patch value: a literal, a typed payload copy, or (for string facts) a
 * template. Lives in the patch-spec namespace — used inside a {@link PatchSpec}
 * `$set` block.
 *
 * @example
 * ```ts
 * const v1: PatchValue<boolean, { active: boolean }> = true;
 * const v2: PatchValue<string, { name: string }> = { $ref: "name" };
 * const v3: PatchValue<string, { name: string }> = { $template: "user ${name}" };
 * ```
 */
export type PatchValue<V, P> =
  | V
  | PayloadRef<P>
  | ([V] extends [string] ? FactTemplate : never);

/**
 * An event handler written as data: assigns facts from literals, payload
 * fields (`$ref`), or interpolated strings (`$template`).
 *
 * @example
 * ```ts
 * const spec: PatchSpec<{ status: string; label: string }, { name: string }> = {
 *   $set: {
 *     status: "active",
 *     label: { $template: "user ${name}" },
 *   },
 * };
 * ```
 */
export interface PatchSpec<F, P> {
  readonly $set: { [K in keyof F]?: PatchValue<F[K], P> };
}

// ============================================================================
// Explain
// ============================================================================

/**
 * The per-clause result of an explained predicate evaluation. One entry per
 * leaf operator (`$eq`, `$gte`, …); combinator nodes (`$all`, `$any`, `$not`)
 * may also appear as headers when the runtime emits them — hence the union
 * over {@link PredicateCombinatorKey}.
 *
 * @example
 * ```ts
 * const result: ClauseResult = {
 *   path: "elapsed",
 *   op: "$gte",
 *   expected: 30,
 *   actual: 20,
 *   pass: false,
 * };
 * ```
 */
export interface ClauseResult {
  /** Dotted path to the fact (`elapsed`, `auth.token`). */
  readonly path: string;
  /** The operator applied (`$gte`, `$eq`, …) — `$eq` for a bare value. */
  readonly op: PredicateOp | PredicateCombinatorKey;
  /**
   * The value the predicate expected. For combinator clauses (`$all`,
   * `$any`, `$not`) this is the child count.
   */
  readonly expected: unknown;
  /**
   * The actual fact value at evaluation time. For combinator clauses this
   * is the number of child clauses that passed.
   */
  readonly actual: unknown;
  /** Whether this clause passed. */
  readonly pass: boolean;
  /**
   * Children of a combinator clause (`$all`, `$any`, `$not`). Preserves the
   * tree shape of the original predicate so renderers (devtools,
   * `system.explain()`) can indent nested clauses.
   */
  readonly children?: ClauseResult[];
}
