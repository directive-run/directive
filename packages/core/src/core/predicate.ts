/**
 * Runtime for data-configuration predicates and templates.
 *
 * Pure module — imports only its own types. Reads facts through whatever
 * object it is handed (the reactive `Facts` proxy in production, a plain
 * snapshot in tests), so it never depends on the engine, store, or tracking.
 */

import isDevelopment from "#is-development";
import { stableStringify } from "../utils/utils.js";
import {
  type ClauseResult,
  type FactTemplate,
  PREDICATE_OPERATORS,
  type PatchSpec,
  type PredicateOp,
} from "./types/predicate.js";

// ============================================================================
// Recursion bound
// ============================================================================

/**
 * Maximum predicate-AST recursion depth. Legitimate cross-module predicates
 * nest fewer than ~15 levels; 64 is generous but bounded — past it the runtime
 * dev-warns and bails rather than risking a stack overflow on a cyclic or
 * pathologically deep spec. Shared by every structural predicate walker
 * ({@link walkPredicate}, {@link evaluatePredicate}) so the cap lives in one
 * place.
 */
export const MAX_PREDICATE_DEPTH = 64;

// ============================================================================
// Discriminators
// ============================================================================

/** A readable scope — the `Facts` proxy and a plain snapshot both satisfy it. */
type Scope = Record<string, unknown>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return false;
  }

  return !(v instanceof Date) && !(v instanceof RegExp);
}

/**
 * True when `v` is a plain `{}` literal (its prototype is `Object.prototype`
 * or `null`). Excludes class instances, Date, RegExp, Map, Set, Promise, etc.
 */
function isPlainObjectStrict(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return false;
  }
  const proto = Object.getPrototypeOf(v);

  return proto === Object.prototype || proto === null;
}

/**
 * True when every own key of `v` is a recognized `$`-operator (and there is ≥1).
 * If any key starts with `$` but is not a known operator, dev-warn (typo) and
 * still treat the value as an operator object so the typo is not masked as a
 * literal — `applyOperator` will return false for the unknown op.
 */
function isOperatorObject(v: unknown): v is Record<string, unknown> {
  if (!isPlainObject(v)) {
    return false;
  }

  let count = 0;
  let hasDollarKey = false;
  for (const k of Object.keys(v)) {
    if (k.startsWith("$")) {
      hasDollarKey = true;
      if (!PREDICATE_OPERATORS.has(k)) {
        devWarn(
          `predicate: unknown operator "${k}" — looks like a typo. Known operators: ${[...PREDICATE_OPERATORS].join(", ")}`,
        );
      }
    } else if (hasDollarKey || count === 0) {
      // Mixed $/non-$ keys aren't an operator object; let the caller treat
      // it as a literal/recursive predicate. The non-$ key check happens
      // below by short-circuiting when a non-$ key appears.
      return false;
    }
    count++;
  }

  if (!hasDollarKey) {
    return false;
  }

  // All keys are `$`-prefixed: this is an operator object, even if some keys
  // are typos. An unknown op makes applyOperator() return false.
  return count > 0;
}

/**
 * True when `v` is a data-form spec (predicate object/array) rather than a
 * function. Excludes class instances (Date, RegExp, Map, Set, Promise, etc.)
 * — only plain `{}` literals and arrays of plain clause shapes qualify.
 *
 * @example
 * ```ts
 * isPredicate({ phase: "red" }); // true
 * isPredicate((f) => f.phase === "red"); // false
 * isPredicate([{ fact: "phase", op: "$eq", value: "red" }]); // true
 * ```
 */
export function isPredicate(v: unknown): boolean {
  if (v === null) {
    return false;
  }
  if (Array.isArray(v)) {
    return v.every(
      (c) =>
        isPlainObjectStrict(c) &&
        "fact" in (c as object) &&
        "op" in (c as object),
    );
  }

  return isPlainObjectStrict(v);
}

// ============================================================================
// Structural traversal
// ============================================================================

/**
 * Visitor passed to {@link walkPredicate}. Every callback is optional; a
 * walker implements only the arms it cares about.
 */
export interface PredicateVisitor {
  /**
   * A leaf operator clause: a fact + a `$`-operator + its operand. Fires once
   * per operator in a multi-operator object.
   *
   * @param factPath - Dotted path to the fact (`elapsed`, `auth.token`).
   * @param op - The operator key (`$gte`, `$matches`, …).
   * @param operand - The operator's operand value.
   * @param operandPath - Dotted path to the operand for diagnostics
   *   (`elapsed.$gte`, `value` / `[0].value` for the array-clause form).
   */
  operator?(
    factPath: string,
    op: string,
    operand: unknown,
    operandPath: string,
  ): void;
  /**
   * A bare-value (equality) clause — a fact mapped to a non-object literal,
   * an array, or a non-plain class instance (Date, RegExp, Set, …).
   *
   * @param factPath - Dotted path to the fact.
   * @param value - The equality operand.
   */
  literal?(factPath: string, value: unknown): void;
  /**
   * A combinator node (`$all` / `$any` / `$not`), called before descending.
   * Return `false` to skip its children.
   */
  combinator?(kind: "$all" | "$any" | "$not"): boolean | void;
  /**
   * A nested-object (cross-module pivot) key, called before descending.
   * Return `false` to skip its children.
   */
  nested?(key: string): boolean | void;
  /**
   * A `$`-prefixed key appearing where a fact key was expected — either an
   * unknown/typo operator, or an operator mixed with fact keys at predicate
   * top level.
   *
   * @param key - The stray `$`-key.
   * @param factPath - Dotted path to the stray key.
   */
  strayOperatorKey?(key: string, factPath: string): void;
  /**
   * Called when traversal bails out early — a cycle was re-encountered or
   * the depth cap was hit. The subtree below the bail point is NOT visited.
   */
  bail?(reason: "cycle" | "depth"): void;
}

/**
 * Single depth-guarded, cycle-guarded structural traversal of a predicate
 * AST. The pure structural walkers — dependency extraction, `$changed`
 * detection, empty/config detection, serialization validation — share this
 * so a new operator or combinator is threaded through one place.
 *
 * Handles the object form, the array-clause form, combinator nodes, nested
 * cross-module objects, operator objects, and bare-value literals. It does
 * **not** evaluate — see {@link evaluatePredicate} for that.
 *
 * @internal
 */
export function walkPredicate(
  spec: unknown,
  visitor: PredicateVisitor,
  path = "",
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): void {
  if (depth > MAX_PREDICATE_DEPTH) {
    if (isDevelopment) {
      console.warn(
        `[Directive] predicate depth limit (${MAX_PREDICATE_DEPTH}) exceeded — flatten the predicate or split it into multiple constraints. If this is unexpected, check for a cyclic spec object.`,
      );
    }
    visitor.bail?.("depth");

    return;
  }

  // Array-clause form — each `{ fact, op, value }` clause is a leaf operator.
  if (Array.isArray(spec)) {
    spec.forEach((clause, i) => {
      if (!isPlainObject(clause)) {
        return;
      }
      const c = clause as Record<string, unknown>;
      if (typeof c.fact === "string" && typeof c.op === "string") {
        const clausePath = path ? `${path}[${i}]` : `[${i}]`;
        visitor.operator?.(
          path ? `${path}.${c.fact}` : c.fact,
          c.op,
          c.value,
          `${clausePath}.value`,
        );
      }
    });

    return;
  }

  if (!isPlainObject(spec)) {
    return;
  }
  if (seen.has(spec)) {
    if (isDevelopment) {
      console.warn("[Directive] walkPredicate: cyclic predicate spec");
    }
    visitor.bail?.("cycle");

    return;
  }
  seen.add(spec);

  const obj = spec as Record<string, unknown>;

  // Combinator node — descend into children unless the visitor opts out.
  for (const kind of ["$all", "$any", "$not"] as const) {
    if (kind in obj) {
      const descend = visitor.combinator?.(kind);
      if (descend === false) {
        return;
      }
      const children =
        kind === "$not" ? [obj.$not] : ((obj[kind] as unknown[]) ?? []);
      for (const child of children) {
        walkPredicate(child, visitor, path, seen, depth + 1);
      }

      return;
    }
  }

  // Object form — one entry per key.
  for (const key of Object.keys(obj)) {
    const childPath = path ? `${path}.${key}` : key;

    if (key.startsWith("$")) {
      // A `$`-key at fact position — typo operator or top-level operator
      // mixed with fact keys. Surface it; do not descend.
      visitor.strayOperatorKey?.(key, childPath);
      continue;
    }

    const value = obj[key];

    if (isOperatorObject(value)) {
      const opObj = value as Record<string, unknown>;
      for (const op of Object.keys(opObj)) {
        visitor.operator?.(childPath, op, opObj[op], `${childPath}.${op}`);
      }
      continue;
    }

    // Only a strict plain object (`{}` / `Object.create(null)`) recurses as
    // a nested cross-module predicate. A Set, Map, or class instance is a
    // bare-value leaf — surfacing it as `literal` lets a walker inspect its
    // runtime class (e.g. validatePredicate's JSON-serializability check).
    if (isPlainObjectStrict(value)) {
      const descend = visitor.nested?.(key);
      if (descend === false) {
        continue;
      }
      walkPredicate(value, visitor, childPath, seen, depth + 1);
      continue;
    }

    // Bare value — equality leaf (also array / Set / Map / class instances).
    visitor.literal?.(childPath, value);
  }
}

/**
 * True when `v` structurally passes {@link isPredicate} but contains no
 * operators, no combinators, and no fact-clause entries that resolve to a
 * primitive/operator leaf — i.e. an empty `{}` or a deeply-nested object
 * tree that never bottoms out in a leaf value. Used by the dynamic
 * `register()` / `assign()` paths to dev-warn when a config object is
 * passed where a predicate (or function) was expected.
 *
 * Returns `false` for arrays — array-form predicates with `fact`+`op`
 * clauses are handled by the structural `isPredicate` check upstream.
 *
 * @example
 * ```ts
 * isEmptyOrConfigPredicate({}); // true (empty — config-object misuse)
 * isEmptyOrConfigPredicate({ phase: "red" }); // false (real fact clause)
 * isEmptyOrConfigPredicate({ $eq: 5 }); // false (operator)
 * isEmptyOrConfigPredicate({ count: { $gt: 5 } }); // false (operator clause)
 * ```
 *
 * @internal
 */
export function isEmptyOrConfigPredicate(v: unknown): boolean {
  // Arrays and non-plain-object specs are never "empty config objects".
  if (!isPlainObjectStrict(v)) {
    return false;
  }

  // A spec is a config tree only when walkPredicate fires NONE of the
  // predicate-semantic callbacks — no operator, no combinator, no literal
  // leaf, no stray `$`-key. Nested plain objects are descended; an empty
  // `{}` or a tree of empty `{}` fires nothing and stays "config". A cycle
  // or depth-cap bail is treated as "not a config object" (can't determine
  // — fail safe so the dev-warn is not spuriously emitted).
  let isPredicateBody = false;
  walkPredicate(v, {
    operator() {
      isPredicateBody = true;
    },
    literal() {
      isPredicateBody = true;
    },
    combinator() {
      isPredicateBody = true;
    },
    strayOperatorKey() {
      isPredicateBody = true;
    },
    bail() {
      isPredicateBody = true;
    },
  });

  return !isPredicateBody;
}

/**
 * True when `v` is a {@link FactTemplate} (`{ $template: string }`).
 *
 * @example
 * ```ts
 * isTemplate({ $template: "Hi ${name}" }); // true
 * isTemplate({ $set: { name: "x" } }); // false
 * ```
 */
export function isTemplate(v: unknown): v is FactTemplate {
  return (
    isPlainObject(v) &&
    Object.hasOwn(v, "$template") &&
    typeof (v as { $template: unknown }).$template === "string"
  );
}

// ============================================================================
// Load-time validation
// ============================================================================

/**
 * Throw when a predicate spec contains an operand that cannot survive a
 * JSON round-trip — i.e. that would silently mis-evaluate if the spec was
 * loaded from `JSON.parse`.
 *
 * Three failure classes are detected:
 *
 * - **Lost `RegExp` operand.** A `$matches` operand that is not a
 *   `RegExp` instance. `JSON.parse` reconstructs a serialized regex as
 *   `{}`, so a `$matches` clause with an empty-object operand is the
 *   signature of a regex that did not survive serialization. Reify it
 *   with `new RegExp(pattern, flags)` before installing the predicate.
 * - **`bigint` operand.** `JSON.stringify` throws on `bigint`, so a
 *   `bigint` operand cannot have been produced by a JSON pipeline and
 *   cannot be persisted by one either.
 * - **`Set` / `Map` operand.** Both serialize to `{}` and lose all
 *   members; a predicate carrying one is not JSON-safe.
 *
 * This is an opt-in helper — the engine does not call it automatically.
 * Users who load predicates from JSON should call it after `JSON.parse`
 * to fail loud rather than silently mis-evaluate. See the
 * "Serialization" section of RFC-0004.
 *
 * @example
 * ```ts
 * validatePredicate({ phase: { $matches: {} } });
 * // throws — empty object where a RegExp is required
 *
 * validatePredicate({ phase: "red", elapsed: { $gte: 30 } });
 * // ok — JSON-clean operands
 * ```
 */
export function validatePredicate(spec: unknown, path = ""): void {
  /**
   * Recursively walk an operand's object/array structure, throwing on any
   * value that cannot survive a JSON round-trip — `bigint`, `Set`, `Map`, or
   * a nested `RegExp`. Depth- and cycle-guarded. A top-level operand is
   * inspected by the operator-specific {@link checkOperand} (which permits a
   * `RegExp` as the direct `$matches` operand); this helper handles values
   * nested *inside* a plain-object or array operand, where a `RegExp` is just
   * as JSON-unsafe as a `Set`.
   */
  function checkValueJsonSafe(
    value: unknown,
    at: string,
    seen: WeakSet<object>,
    depth: number,
  ): void {
    if (typeof value === "bigint") {
      throw new Error(
        `[Directive] validatePredicate: bigint operand at "${at}" is not JSON-serializable (JSON.stringify throws on bigint).`,
      );
    }
    if (value instanceof Set) {
      throw new Error(
        `[Directive] validatePredicate: Set operand at "${at}" is not JSON-serializable (serializes to {} and loses all members).`,
      );
    }
    if (value instanceof Map) {
      throw new Error(
        `[Directive] validatePredicate: Map operand at "${at}" is not JSON-serializable (serializes to {} and loses all entries).`,
      );
    }
    if (value instanceof RegExp) {
      throw new Error(
        `[Directive] validatePredicate: RegExp operand at "${at}" is not JSON-serializable (a regex lost to JSON.parse becomes {}). Only a direct $matches operand may be a RegExp.`,
      );
    }
    if (value === null || typeof value !== "object") {
      return;
    }
    if (depth > MAX_PREDICATE_DEPTH) {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((el, i) => {
        checkValueJsonSafe(el, `${at}[${i}]`, seen, depth + 1);
      });

      return;
    }

    for (const k of Object.keys(value as Record<string, unknown>)) {
      checkValueJsonSafe(
        (value as Record<string, unknown>)[k],
        at ? `${at}.${k}` : k,
        seen,
        depth + 1,
      );
    }
  }

  /** Throw on a JSON-unrehydratable operand value. */
  function checkOperand(value: unknown, op: string, at: string): void {
    if (typeof value === "bigint") {
      throw new Error(
        `[Directive] validatePredicate: bigint operand at "${at}" is not JSON-serializable (JSON.stringify throws on bigint).`,
      );
    }
    if (value instanceof Set) {
      throw new Error(
        `[Directive] validatePredicate: Set operand at "${at}" is not JSON-serializable (serializes to {} and loses all members).`,
      );
    }
    if (value instanceof Map) {
      throw new Error(
        `[Directive] validatePredicate: Map operand at "${at}" is not JSON-serializable (serializes to {} and loses all entries).`,
      );
    }
    if (op === "$matches" && !(value instanceof RegExp)) {
      throw new Error(
        `[Directive] validatePredicate: $matches operand at "${at}" must be a RegExp; got ${value === null ? "null" : typeof value}. A regex lost to JSON.parse becomes {} — reify with new RegExp(pattern, flags) before installing.`,
      );
    }
    // A plain-object / array operand (e.g. `$eq: { ... }`, `$in: [ ... ]`)
    // can carry a `bigint`, `Set`, `Map`, or nested `RegExp` arbitrarily deep
    // — `checkOperand` only sees the operand's top type, so recurse into its
    // structure. The direct `$matches` RegExp is handled above and never
    // reaches this branch (a RegExp is not a plain object / array).
    if (Array.isArray(value)) {
      value.forEach((el, i) => {
        checkValueJsonSafe(el, `${at}[${i}]`, new WeakSet(), 1);
      });
    } else if (isPlainObjectStrict(value)) {
      for (const k of Object.keys(value)) {
        checkValueJsonSafe(value[k], `${at}.${k}`, new WeakSet(), 1);
      }
    }
  }

  // Top-level Set / Map node — a regex / set / map handed in directly as the
  // whole spec. walkPredicate would treat it as an empty object, so check
  // the entry node here.
  if (spec instanceof Set) {
    throw new Error(
      `[Directive] validatePredicate: Set operand${path ? ` at "${path}"` : ""} is not JSON-serializable (serializes to {} and loses all members).`,
    );
  }
  if (spec instanceof Map) {
    throw new Error(
      `[Directive] validatePredicate: Map operand${path ? ` at "${path}"` : ""} is not JSON-serializable (serializes to {} and loses all entries).`,
    );
  }

  // Single structural traversal — every operator clause and equality leaf is
  // checked for a JSON-unrehydratable operand. The walker threads the dotted
  // operand path so error messages point at the offending clause.
  walkPredicate(spec, {
    operator(_factPath, op, operand, operandPath) {
      checkOperand(operand, op, path ? `${path}.${operandPath}` : operandPath);
    },
    literal(factPath, value) {
      checkOperand(value, "", path ? `${path}.${factPath}` : factPath);
    },
  });
}

// ============================================================================
// Schema-aware validation (semantic — operator on kind, operator-count cap)
// ============================================================================

import {
  getOperatorsForKind,
  type SchemaKindNode,
} from "./schema-introspection.js";

export interface SchemaValidationError {
  /** Dotted path to the failing clause (e.g. `cartTotal`, `auth.token.$gte`). */
  readonly path: string;
  /** The operator that failed (or the literal-equality marker `$eq`). */
  readonly op: string;
  /** The kind of the fact at this path, or `undefined` when the fact wasn't in the kind map. */
  readonly kind?: SchemaKindNode;
  /** The operators that ARE allowed for this fact's kind. */
  readonly allowedOps?: readonly string[];
  /** Human-readable failure reason (suitable for feeding back to an LLM). */
  readonly reason: string;
}

export interface SchemaValidationOptions {
  /** Reject predicates with more than this many operator clauses (DoS guard). Default unbounded. */
  readonly maxOperatorCount?: number;
  /**
   * Reject `$in` / `$nin` operands that contain more than this many elements
   * (query-planner DoS guard). Default unbounded. A typical safe cap is 1000
   * — beyond that, a downstream query compiler may degrade quadratically.
   */
  readonly maxArrayOperandLength?: number;
}

/**
 * Heuristic: flag a regex source string that has obvious nested quantifiers
 * (e.g. `(.+)+`, `(.*)*`, `(\w+)+`, `(a|a)+`) — the classic ReDoS shapes.
 * Not a full ReDoS prover; intentionally conservative so a string-rehydrated
 * `$matches` operand can be rejected before it ever reaches `RegExp.test`.
 *
 * Callers MUST NOT treat a `false` result as "safe" — a determined adversary
 * can craft patterns this heuristic misses. The right answer for untrusted
 * regex is "don't accept untrusted regex"; this helper exists to catch the
 * obvious foot-guns.
 *
 * @example
 * ```ts
 * dangerousRegex("(a+)+");      // → true
 * dangerousRegex("(.*)*");      // → true
 * dangerousRegex("(\\w+)+");    // → true
 * dangerousRegex("^[a-z]+$");   // → false
 * ```
 */
export function dangerousRegex(source: string): boolean {
  if (typeof source !== "string" || source.length === 0) {
    return false;
  }
  // Nested quantifiers — a group ending in `*` or `+` (or `{n,}`) immediately
  // followed by another `*` / `+` / `{n,}` quantifier. Allow `?` between
  // (lazy) since `(...)?+` is still pathological. Also catch `{n,m}` upper
  // bounds when they wrap a quantified group.
  //
  // Patterns flagged:
  //   (.+)+     (.*)*     (.+)*     (.*)+
  //   (\w+)+    (\d*)+    ([abc]+)+
  //   (a|a)+    (a|b|c)*   ((x))+    (?:x+)+
  //
  // The check looks for a closing `)` preceded by a quantifier-bearing token
  // (`+`, `*`, `}` from `{n,m}`, or `+?` / `*?` lazy) and followed by another
  // quantifier (`+`, `*`, or `{n,`).
  const nestedQuantifier = /\)(?:[+*]\??|\{\d+,?\d*\})\s*[+*?]\s*[+*]/;
  if (nestedQuantifier.test(source)) {
    return true;
  }
  // Group whose inner content already has a `+` / `*` / `{n,}` quantifier on
  // a character class or token, and the group is then itself quantified.
  // E.g. `(a+)+`, `(\w+)+`, `(.*)*`, `([abc]+)*`.
  const groupedQuantified =
    /\(([^()]*?[+*]|[^()]*?\{\d+,?\d*\})[^()]*\)\s*[+*]/;
  if (groupedQuantified.test(source)) {
    return true;
  }
  // Alternation of identical branches: `(a|a)+`, `(foo|foo)*`.
  const sameBranchAlt = /\(\??:?([^()|]+)\|\1\)\s*[+*]/;
  if (sameBranchAlt.test(source)) {
    return true;
  }

  return false;
}

export type SchemaValidationResult =
  | { ok: true; operatorCount: number }
  | { ok: false; errors: readonly SchemaValidationError[]; operatorCount: number };

/**
 * Cross-check an LLM-emitted (or otherwise externally-sourced) predicate
 * against a schema's runtime kind map. Catches errors that
 * {@link validatePredicate} cannot — operator-on-wrong-kind (`$gte` on a
 * boolean fact), unknown fact paths, and (optionally) operator-count
 * exhaustion DoS attempts.
 *
 * Pair with {@link validatePredicate} (structural / JSON safety) for full
 * coverage. Use {@link getSchemaFieldKinds} to derive `kindMap` from a
 * module schema.
 *
 * Designed for the LLM-emit retry loop: returns a list of errors with
 * structured `{path, op, kind, allowedOps, reason}` rather than throwing,
 * so the caller can feed the errors back to the model.
 *
 * @example
 * ```ts
 * const kindMap = getSchemaFieldKinds({ facts: { cartTotal: t.number(), active: t.boolean() } });
 * const result = validatePredicateAgainstSchema(
 *   { cartTotal: { $gte: 50 }, active: { $gte: true } },
 *   kindMap,
 * );
 * // → { ok: false, errors: [{ path: "active", op: "$gte", reason: "..." }], operatorCount: 2 }
 * ```
 */
export function validatePredicateAgainstSchema(
  spec: unknown,
  kindMap: Map<string, SchemaKindNode>,
  opts: SchemaValidationOptions = {},
): SchemaValidationResult {
  const errors: SchemaValidationError[] = [];
  let operatorCount = 0;
  const maxOperatorCount = opts.maxOperatorCount;
  const maxArrayOperandLength = opts.maxArrayOperandLength;

  walkPredicate(spec, {
    operator(factPath, op, operand, _operandPath) {
      operatorCount++;
      if (
        maxOperatorCount !== undefined &&
        operatorCount > maxOperatorCount
      ) {
        // Don't pile up identical errors past the cap; one is enough.
        if (
          !errors.some((e) => e.reason.includes("maxOperatorCount"))
        ) {
          errors.push({
            path: factPath,
            op,
            reason: `Predicate exceeds maxOperatorCount=${maxOperatorCount} — too many clauses (DoS guard).`,
          });
        }

        return;
      }

      // M1: $in / $nin operand length cap — too-large array operands choke
      // downstream query planners and OR-tree compilers.
      if (
        maxArrayOperandLength !== undefined &&
        (op === "$in" || op === "$nin") &&
        Array.isArray(operand) &&
        operand.length > maxArrayOperandLength
      ) {
        errors.push({
          path: factPath,
          op,
          reason: `Operator ${op} operand exceeds maxArrayOperandLength=${maxArrayOperandLength} (got ${operand.length}) — too large for a query planner.`,
        });

        return;
      }

      // M2: $matches operand ReDoS heuristic — flag obvious nested
      // quantifiers in either a RegExp or a string-form pattern. String-form
      // patterns are rejected at evaluation time (see applyOperator), but
      // a static check here catches them before they ever load.
      //
      // WARNING: don't rehydrate LLM-emitted string-form regex without your
      // own complexity audit; `dangerousRegex()` is a foot-gun catcher, not
      // a ReDoS prover.
      if (op === "$matches") {
        let regexSource: string | undefined;
        if (operand instanceof RegExp) {
          regexSource = operand.source;
        } else if (typeof operand === "string") {
          regexSource = operand;
        }
        if (regexSource !== undefined && dangerousRegex(regexSource)) {
          errors.push({
            path: factPath,
            op,
            reason: `Operator $matches operand at "${factPath}" contains nested quantifiers (ReDoS risk: ${JSON.stringify(regexSource)}). Reject untrusted regex or rewrite without nested + / *.`,
          });

          return;
        }
      }

      const kind = kindMap.get(factPath);
      if (!kind) {
        errors.push({
          path: factPath,
          op,
          reason: `Unknown fact "${factPath}" — not in schema. Known facts: ${
            kindMap.size === 0
              ? "(empty schema)"
              : Array.from(kindMap.keys()).join(", ")
          }`,
        });

        return;
      }

      const allowedOps = getOperatorsForKind(kind);
      if (!allowedOps.includes(op as never)) {
        errors.push({
          path: factPath,
          op,
          kind,
          allowedOps,
          reason: `Operator "${op}" is not allowed on fact "${factPath}" of kind "${kind.kind}". Allowed operators for this kind: ${allowedOps.join(", ")}.`,
        });
      }
    },
    literal(factPath, _value) {
      operatorCount++;
      // Bare-value (equality) — always permitted as long as fact exists.
      if (!kindMap.has(factPath)) {
        errors.push({
          path: factPath,
          op: "$eq",
          reason: `Unknown fact "${factPath}" — not in schema.`,
        });
      }
    },
    strayOperatorKey(key, factPath) {
      errors.push({
        path: factPath,
        op: key,
        reason: `Stray operator key "${key}" at "${factPath}" — operators must live inside a fact's operator object, not at the predicate top level.`,
      });
    },
  });

  if (errors.length === 0) return { ok: true, operatorCount };

  return { ok: false, errors, operatorCount };
}

// ============================================================================
// Equality
// ============================================================================

/**
 * Pairwise cycle-guard state shared across a single `deepEqual` traversal.
 *
 * Asymmetric cycles (only one side cyclic) must not short-circuit; we only
 * treat a pair as equal when the same `(a, b)` pair is re-encountered.
 */
interface DeepEqualSeen {
  ids: WeakMap<object, number>;
  next: { v: number };
  pairs: Set<string>;
}

function deepEqualSeen(): DeepEqualSeen {
  return { ids: new WeakMap(), next: { v: 1 }, pairs: new Set() };
}

function pairId(seen: DeepEqualSeen, obj: object): number {
  let id = seen.ids.get(obj);
  if (id === undefined) {
    id = seen.next.v++;
    seen.ids.set(obj, id);
  }

  return id;
}

/** Structural equality with NaN/Date handling and a pairwise cycle guard. */
function deepEqual(a: unknown, b: unknown, seen?: DeepEqualSeen): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }

  const guard = seen ?? deepEqualSeen();
  const key = `${pairId(guard, a)}:${pairId(guard, b)}`;
  if (guard.pairs.has(key)) {
    return true; // same (a, b) pair re-encountered — treat as equal
  }
  guard.pairs.add(key);

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }

    return a.every((v, i) => deepEqual(v, b[i], guard));
  }

  // Set equality — same size, every element of `a` has a structurally-equal
  // counterpart in `b`. Must precede the `Object.keys` fallback below because
  // `Object.keys(new Set(...))` is always `[]`, which would otherwise let
  // any two Sets (or any two Maps) compare equal regardless of contents.
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) {
      return false;
    }
    const bArr = [...b];

    return [...a].every((v) => bArr.some((w) => deepEqual(v, w, guard)));
  }

  // Map equality — same size, every key in `a` matches a key in `b` with a
  // structurally-equal value. Greedy match with a used-flag to handle
  // structural (non-reference) key equality correctly.
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) {
      return false;
    }
    const bEntries = [...b.entries()];
    const used = new Array<boolean>(bEntries.length).fill(false);
    for (const [ka, va] of a) {
      let found = false;
      for (let i = 0; i < bEntries.length; i++) {
        if (used[i]) {
          continue;
        }
        const [kb, vb] = bEntries[i]!;
        if (deepEqual(ka, kb, guard) && deepEqual(va, vb, guard)) {
          used[i] = true;
          found = true;
          break;
        }
      }
      if (!found) {
        return false;
      }
    }

    return true;
  }

  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) {
    return false;
  }

  return ak.every(
    (k) =>
      Object.hasOwn(b as object, k) &&
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        guard,
      ),
  );
}

// ============================================================================
// Operators
// ============================================================================

function toComparable(v: unknown): number | bigint | string | undefined {
  if (v instanceof Date) {
    return v.getTime();
  }
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "string") {
    return v;
  }

  return undefined;
}

function relational(
  op: PredicateOp,
  actual: unknown,
  operand: unknown,
): boolean {
  const a = toComparable(actual);
  const b = toComparable(operand);
  if (a === undefined || b === undefined || typeof a !== typeof b) {
    return false;
  }

  switch (op) {
    case "$gt":
      return a > b;
    case "$gte":
      return a >= b;
    case "$lt":
      return a < b;
    case "$lte":
      return a <= b;
    default:
      return false;
  }
}

/** Apply one operator. `prevValue` is supplied only for `$changed`. */
function applyOperator(
  op: PredicateOp,
  actual: unknown,
  operand: unknown,
  prevValue: unknown,
): boolean {
  switch (op) {
    case "$eq":
      return deepEqual(actual, operand);
    case "$ne":
      return !deepEqual(actual, operand);
    case "$in":
      return (
        Array.isArray(operand) && operand.some((v) => deepEqual(actual, v))
      );
    case "$nin":
      return (
        Array.isArray(operand) && !operand.some((v) => deepEqual(actual, v))
      );
    case "$exists":
      return operand === (actual !== undefined);
    case "$changed":
      return !deepEqual(actual, prevValue);
    case "$gt":
    case "$gte":
    case "$lt":
    case "$lte":
      return relational(op, actual, operand);
    case "$between": {
      if (!Array.isArray(operand) || operand.length !== 2) {
        return false;
      }
      const lo = toComparable(operand[0]);
      const hi = toComparable(operand[1]);
      if (
        lo !== undefined &&
        hi !== undefined &&
        typeof lo === typeof hi &&
        lo > hi
      ) {
        devWarn("$between: reversed pair — [min, max] required");

        return false;
      }

      return (
        relational("$gte", actual, operand[0]) &&
        relational("$lte", actual, operand[1])
      );
    }
    case "$matches": {
      if (!(operand instanceof RegExp)) {
        // String operands are not accepted — a string cannot carry flags
        // (case-insensitivity, dotall, multiline) and would also enable a
        // ReDoS surface for data-loaded predicates. Throw immediately so
        // the bug surfaces at the point of use.
        throw new Error(
          "[Directive] $matches: operand must be a RegExp (string operands are no longer accepted; pass /pattern/flags directly).",
        );
      }
      if (typeof actual !== "string") {
        return false;
      }

      return operand.test(actual);
    }
    case "$startsWith":
      if (typeof actual !== "string") {
        return false;
      }

      return actual.startsWith(String(operand));
    case "$endsWith":
      if (typeof actual !== "string") {
        return false;
      }

      return actual.endsWith(String(operand));
    case "$contains":
      if (typeof actual === "string") {
        return actual.includes(String(operand));
      }
      if (Array.isArray(actual)) {
        return actual.some((v) => deepEqual(v, operand));
      }
      // Set membership — uses `.has()` which is reference-equality for
      // objects (matches native Set semantics) and value-equality for
      // primitives. Map `$contains` is deferred to v2; users who need it
      // today can fall back to a function-form predicate.
      if (actual instanceof Set) {
        return actual.has(operand);
      }

      return false;
    default:
      return false;
  }
}

// ============================================================================
// Evaluation
// ============================================================================

function devWarn(message: string): void {
  if (isDevelopment) {
    console.warn(`[Directive] ${message}`);
  }
}

function evalField(
  value: unknown,
  actual: unknown,
  prev: unknown,
  depth: number,
): boolean {
  if (isOperatorObject(value)) {
    const keys = Object.keys(value);
    // Type rejects multi-operator objects; the runtime ANDs them on a
    // best-effort basis but dev-warns so the author knows to switch to the
    // array form or `$all`.
    if (keys.length > 1) {
      devWarn(
        `predicate: operator object has ${keys.length} operators (${keys.join(", ")}) — write the array form or $all instead. The runtime ANDs them as a best-effort fallback.`,
      );
    }
    for (const op of keys) {
      if (!applyOperator(op as PredicateOp, actual, value[op], prev)) {
        return false;
      }
    }

    return true;
  }

  // A plain (non-operator) object recurses — nested / namespaced predicate.
  if (isPlainObject(value)) {
    return evaluatePredicate(
      value,
      isPlainObject(actual) ? actual : Object.create(null),
      isPlainObject(prev) ? prev : undefined,
      depth + 1,
    );
  }

  // Bare value → equality.
  return deepEqual(actual, value);
}

/**
 * Evaluate a {@link FactPredicate} against a fact scope. `prev` (a previous
 * snapshot) is consulted only by the `$changed` operator.
 *
 * @example
 * ```ts
 * evaluatePredicate({ phase: "red", elapsed: { $gte: 30 } }, { phase: "red", elapsed: 45 });
 * // → true
 * evaluatePredicate({ $any: [{ phase: "red" }, { phase: "yellow" }] }, { phase: "green" });
 * // → false
 * ```
 */
export function evaluatePredicate(
  spec: unknown,
  facts: Scope,
  prev?: Scope,
  depth = 0,
): boolean {
  // `freezeSpec` permits cycles (it uses a WeakSet seen-guard), so a
  // registered spec can be self-referential. Cap recursion to defend the
  // reconcile loop against a stack overflow at evaluation time.
  if (depth > MAX_PREDICATE_DEPTH) {
    devWarn(
      `predicate depth limit (${MAX_PREDICATE_DEPTH}) exceeded — flatten the predicate or split it into multiple constraints. If this is unexpected, check for a cyclic spec object.`,
    );

    return false;
  }
  // Array form — clauses AND-ed.
  if (Array.isArray(spec)) {
    return spec.every((clause) => {
      if (!isPlainObject(clause)) {
        return false;
      }
      const { fact, op, value } = clause as {
        fact: string;
        op: PredicateOp;
        value: unknown;
      };

      return applyOperator(op, facts?.[fact], value, prev?.[fact]);
    });
  }

  if (!isPlainObject(spec)) {
    return Boolean(spec);
  }

  // Combinator node.
  if ("$all" in spec) {
    return (spec.$all as unknown[]).every((p) =>
      evaluatePredicate(p, facts, prev, depth + 1),
    );
  }
  if ("$any" in spec) {
    return (spec.$any as unknown[]).some((p) =>
      evaluatePredicate(p, facts, prev, depth + 1),
    );
  }
  if ("$not" in spec) {
    return !evaluatePredicate(spec.$not, facts, prev, depth + 1);
  }

  // Object form — every key AND-ed.
  for (const key of Object.keys(spec)) {
    if (PREDICATE_OPERATORS.has(key)) {
      devWarn(
        `predicate: operator "${key}" mixed with fact keys — wrap operators in a per-fact object`,
      );

      return false;
    }
    if (!evalField(spec[key], facts?.[key], prev?.[key], depth)) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluate a predicate and return a per-clause breakdown — the data feed for
 * devtools, `system.explain()`, and `directive explain`.
 *
 * @example
 * ```ts
 * evaluatePredicateExplained(
 *   { phase: "red", elapsed: { $gte: 30 } },
 *   { phase: "red", elapsed: 20 },
 * );
 * // → [
 * //   { path: "phase",   op: "$eq",  expected: "red", actual: "red", pass: true  },
 * //   { path: "elapsed", op: "$gte", expected: 30,    actual: 20,    pass: false },
 * // ]
 * ```
 */
export function evaluatePredicateExplained(
  spec: unknown,
  facts: Scope,
  prev?: Scope,
  pathPrefix = "",
): ClauseResult[] {
  const out: ClauseResult[] = [];

  if (Array.isArray(spec)) {
    for (const clause of spec) {
      if (!isPlainObject(clause)) {
        continue;
      }
      const { fact, op, value } = clause as {
        fact: string;
        op: PredicateOp;
        value: unknown;
      };
      const actual = facts?.[fact];
      out.push({
        path: pathPrefix + fact,
        op,
        expected: value,
        actual,
        pass: applyOperator(op, actual, value, prev?.[fact]),
      });
    }

    return out;
  }

  if (!isPlainObject(spec)) {
    return out;
  }

  for (const key of ["$all", "$any", "$not"] as const) {
    if (key in spec) {
      const childSpecs =
        key === "$not" ? [spec.$not] : (spec[key] as unknown[]);
      const children: ClauseResult[] = [];
      for (const child of childSpecs) {
        children.push(
          ...evaluatePredicateExplained(child, facts, prev, pathPrefix),
        );
      }
      const passCount = children.filter((c) => c.pass).length;
      let pass: boolean;
      if (key === "$all") {
        pass = children.length === 0 || passCount === children.length;
      } else if (key === "$any") {
        pass = children.length > 0 && passCount > 0;
      } else {
        // $not — single child wrapped above
        pass = !children.every((c) => c.pass);
      }
      out.push({
        path: pathPrefix || key,
        op: key,
        expected: childSpecs.length,
        actual: passCount,
        pass,
        children,
      });

      return out;
    }
  }

  for (const key of Object.keys(spec)) {
    if (PREDICATE_OPERATORS.has(key)) {
      continue;
    }
    const value = spec[key];
    const actual = facts?.[key];
    const path = pathPrefix + key;

    if (isOperatorObject(value)) {
      for (const op of Object.keys(value)) {
        out.push({
          path,
          op: op as PredicateOp,
          expected: value[op],
          actual,
          pass: applyOperator(
            op as PredicateOp,
            actual,
            value[op],
            prev?.[key],
          ),
        });
      }
    } else if (isPlainObject(value)) {
      out.push(
        ...evaluatePredicateExplained(
          value,
          isPlainObject(actual) ? actual : Object.create(null),
          isPlainObject(prev?.[key]) ? (prev?.[key] as Scope) : undefined,
          `${path}.`,
        ),
      );
    } else {
      out.push({
        path,
        op: "$eq",
        expected: value,
        actual,
        pass: deepEqual(actual, value),
      });
    }
  }

  return out;
}

const memoizedCache = new WeakMap<
  object,
  (facts: Scope, prev?: Scope) => boolean
>();

/**
 * Memoize a predicate as a reusable evaluation closure.
 *
 * The returned function accepts any `facts` scope (the reactive proxy in
 * production, a plain object in tests) plus an optional `prev` snapshot for
 * `$changed`. The closure is cached **by predicate identity** in a
 * `WeakMap`, so passing the same `predicate` reference repeatedly is
 * allocation-free; cleanup is automatic once the predicate is no longer
 * reachable.
 *
 * Note: no actual compilation happens — the returned closure re-walks the
 * spec on every call via `evaluatePredicate`. The name reflects what the
 * function does (closure memoization keyed by predicate identity), not a
 * bytecode/AST compile step.
 *
 * Intended for advanced users who want a stable function reference per
 * predicate (custom devtools, batched analyses). Regular module code does
 * not need to call this — the engine wraps data-form `when` / `on` specs
 * automatically at registration.
 *
 * @example
 * ```ts
 * const predicate = { phase: "red", elapsed: { $gte: 30 } };
 * const check = memoizePredicate(predicate);
 * check({ phase: "red", elapsed: 45 }); // → true
 * check({ phase: "red", elapsed: 5  }); // → false
 * ```
 */
export function memoizePredicate(
  predicate: object,
): (facts: Scope, prev?: Scope) => boolean {
  if (predicate === null || typeof predicate !== "object") {
    throw new Error(
      `[Directive] memoizePredicate: predicate must be a plain object or array; got ${typeof predicate}`,
    );
  }
  const cached = memoizedCache.get(predicate);
  if (cached) {
    return cached;
  }

  const fn = (facts: Scope, prev?: Scope): boolean =>
    evaluatePredicate(predicate, facts, prev);
  memoizedCache.set(predicate, fn);

  return fn;
}

// ============================================================================
// Dependency extraction
// ============================================================================

/**
 * Collect the fact keys a predicate references. Used for static analysis,
 * devtools, and effect `on` dependency wiring. Nested predicates contribute
 * dotted keys (`auth.token`).
 *
 * @example
 * ```ts
 * extractDeps({ phase: "red", elapsed: { $gte: 30 } });
 * // → Set { "phase", "elapsed" }
 * extractDeps({ self: { phase: "red" }, auth: { token: { $exists: true } } });
 * // → Set { "self.phase", "auth.token" }
 * ```
 */
export function extractDeps(spec: unknown, prefix = ""): Set<string> {
  const deps = new Set<string>();

  // Single structural traversal — every operator clause and equality leaf
  // contributes its dotted fact path. Combinators and nested objects are
  // descended automatically; stray `$`-keys never synthesize phantom deps.
  walkPredicate(spec, {
    operator(factPath) {
      deps.add(prefix + factPath);
    },
    literal(factPath) {
      deps.add(prefix + factPath);
    },
    strayOperatorKey(key) {
      // A `$`-key at fact position never synthesizes a phantom dep. A typo'd
      // operator (e.g. `$eqq`) additionally dev-warns; a known operator
      // mixed with fact keys is skipped silently (evaluatePredicate warns).
      if (!PREDICATE_OPERATORS.has(key)) {
        devWarn(
          `extractDeps: unknown operator "${key}" — skipping. Known operators: ${[...PREDICATE_OPERATORS].join(", ")}`,
        );
      }
    },
  });

  return deps;
}

// ============================================================================
// Templates
// ============================================================================

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Stringify a value without dev-warns for null/undefined — used when the
 *  caller has already emitted a higher-level diagnostic (e.g. "unknown key"). */
function stringifyValueQuiet(v: unknown): string {
  if (typeof v === "symbol") {
    return "";
  }
  if (v === undefined || v === null) {
    return "";
  }

  return String(v);
}

function stringifyValue(v: unknown, key?: string): string {
  if (typeof v === "symbol") {
    devWarn("template: cannot interpolate a symbol value — using empty string");

    return "";
  }
  if (v === undefined) {
    devWarn(
      `template: ${key ? `key "${key}" is ` : ""}undefined — using empty string`,
    );

    return "";
  }
  if (v === null) {
    devWarn(
      `template: ${key ? `key "${key}" is ` : ""}null — using empty string`,
    );

    return "";
  }

  return String(v);
}

/**
 * Interpolate a {@link FactTemplate} against a scope. Single-pass character
 * scanner: `${ident}` interpolates `scope[ident]`; `$${` emits a literal
 * `${`; unknown keys dev-warn and yield an empty string.
 *
 * @example
 * ```ts
 * evaluateTemplate({ $template: "Hi ${name}!" }, { name: "Ada" });
 * // → "Hi Ada!"
 * evaluateTemplate({ $template: "$${price}" }, {});
 * // → "${price}"
 * ```
 */
export function evaluateTemplate(spec: FactTemplate, scope: Scope): string {
  const tpl = spec.$template;
  let out = "";
  let i = 0;

  while (i < tpl.length) {
    if (tpl[i] === "$" && tpl[i + 1] === "$" && tpl[i + 2] === "{") {
      out += "${";
      i += 3;
      continue;
    }

    if (tpl[i] === "$" && tpl[i + 1] === "{") {
      const end = tpl.indexOf("}", i + 2);
      if (end === -1) {
        devWarn(`template: unterminated "\${" in ${JSON.stringify(tpl)}`);
        out += tpl.slice(i);
        break;
      }
      const key = tpl.slice(i + 2, end);
      if (!IDENTIFIER.test(key)) {
        devWarn(
          `template: invalid placeholder "\${${key}}" — not an identifier`,
        );
      } else {
        // `stringifyValue` dev-warns separately for null vs undefined; here
        // we only warn when the key itself is missing from the scope (vs
        // present-but-null), so users see distinct diagnostics. Use
        // Object.hasOwn rather than `in` so prototype-chain keys (e.g.
        // `toString`, `constructor`) are never interpolated.
        const present = scope != null && Object.hasOwn(scope, key);
        const value = present ? scope[key] : undefined;
        if (!present) {
          devWarn(`template: unknown key "${key}"`);
          out += stringifyValueQuiet(value);
        } else {
          out += stringifyValue(value, key);
        }
      }
      i = end + 1;
      continue;
    }

    out += tpl[i];
    i++;
  }

  return out;
}

/**
 * Collect the placeholder keys referenced by a template. The static-analysis
 * counterpart to {@link extractDeps} — useful for devtools, codegen, and
 * "which facts does this template read" inspections. Only valid identifier
 * placeholders are collected; malformed ones are ignored.
 *
 * @example
 * ```ts
 * extractTemplateKeys({ $template: "${firstName} ${lastName}" });
 * // → Set { "firstName", "lastName" }
 * extractTemplateKeys({ $template: "$${literal}" });
 * // → Set {} (escaped — not a placeholder)
 * ```
 */
export function extractTemplateKeys(spec: FactTemplate): Set<string> {
  const keys = new Set<string>();
  const tpl = spec.$template;
  let i = 0;

  while (i < tpl.length) {
    if (tpl[i] === "$" && tpl[i + 1] === "$" && tpl[i + 2] === "{") {
      i += 3;
      continue;
    }
    if (tpl[i] === "$" && tpl[i + 1] === "{") {
      const end = tpl.indexOf("}", i + 2);
      if (end === -1) {
        break;
      }
      const key = tpl.slice(i + 2, end);
      if (IDENTIFIER.test(key)) {
        keys.add(key);
      }
      i = end + 1;
      continue;
    }
    i++;
  }

  return keys;
}

// ============================================================================
// Selectors
// ============================================================================

/**
 * Build a stable dedup key by selecting fields from a requirement payload.
 * Order-as-declared; values are stable-stringified (keys sorted recursively)
 * so two payloads with the same fields in different orders dedupe to the
 * same key.
 *
 * @example
 * ```ts
 * evaluateKeySelector(["url", "method"], { url: "/a", method: "GET" });
 * // → '"/a"|"GET"'
 * evaluateKeySelector(["id"], { id: 42 });
 * // → '42'
 * ```
 */
export function evaluateKeySelector(
  selector: readonly string[],
  source: Record<string, unknown>,
): string {
  return selector.map((field) => stableStringify(source?.[field])).join("|");
}

// ============================================================================
// Patch
// ============================================================================

/**
 * Apply a {@link PatchSpec} — assign facts from literals, payload copies
 * (`$ref`), or interpolated strings (`$template`). Mutates through the passed
 * `facts` proxy so change-tracking and downstream invalidation fire.
 *
 * @example
 * ```ts
 * const spec = {
 *   $set: {
 *     active: true,
 *     userId: { $ref: "id" },
 *     label: { $template: "user ${name}" },
 *   },
 * };
 * applyPatch(spec, facts, { id: "u_1", name: "Ada" });
 * // facts.active = true; facts.userId = "u_1"; facts.label = "user Ada"
 * ```
 */
export function applyPatch(
  spec: PatchSpec<Record<string, unknown>, Record<string, unknown>>,
  facts: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  const set = spec.$set;
  const safePayload = payload ?? {};
  for (const key of Object.keys(set)) {
    const value = (set as Record<string, unknown>)[key];

    if (isTemplate(value)) {
      facts[key] = evaluateTemplate(value, safePayload);
    } else if (
      isPlainObject(value) &&
      Object.hasOwn(value, "$ref") &&
      typeof value.$ref === "string"
    ) {
      const refKey = value.$ref;
      // Use Object.hasOwn rather than `in` — tightens defense against
      // prototype-chain lookups so a payload `__proto__` shape can't smuggle
      // an inherited property into the fact assignment. The proxy already
      // blocks writes to dangerous keys, but this keeps the read symmetric.
      if (!Object.hasOwn(safePayload, refKey)) {
        devWarn(
          `applyPatch: $ref "${refKey}" is missing from event payload — assigning undefined to fact "${key}"`,
        );
      }
      facts[key] = safePayload[refKey];
    } else {
      facts[key] = value;
    }
  }
}
