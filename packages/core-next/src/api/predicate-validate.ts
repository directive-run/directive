/**
 * Predicate validation (L11b tools): `validatePredicate` (load-time, JSON
 * round-trip safety), `validatePredicateAgainstSchema` (semantic, operator on
 * kind) and `dangerousRegex`. Ported unchanged from 1.35
 * (`core/predicate.ts`, "Load-time validation" and "Schema-aware validation").
 *
 * Its own file so `createSystem`, which imports `predicate.ts` for the
 * evaluator, never carries these: an app pays for them only if it imports one.
 */

import type {
  SchemaValidationError,
  SchemaValidationOptions,
  SchemaValidationResult,
} from "../types/predicate-validation.js";
import { MAX_PREDICATE_DEPTH, walkPredicate } from "./predicate.js";
import {
  type SchemaKindNode,
  getOperatorsForKind,
} from "./schema-introspection.js";
/** A plain `{}` literal (1.35's `isPlainObjectStrict`; kept local so predicate.ts stays unchanged). */
function isPlainObjectStrict(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return false;
  }
  const proto = Object.getPrototypeOf(v);

  return proto === Object.prototype || proto === null;
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
      if (maxOperatorCount !== undefined && operatorCount > maxOperatorCount) {
        // Don't pile up identical errors past the cap; one is enough.
        if (!errors.some((e) => e.reason.includes("maxOperatorCount"))) {
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
