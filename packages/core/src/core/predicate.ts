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
// Deep freeze
// ============================================================================

/**
 * Recursively `Object.freeze` an object including nested objects, arrays, and
 * array elements. Uses a `WeakSet` to handle cycles. Skips primitives and
 * already-frozen values to avoid wasted work.
 *
 * Used at definition-registration sites (constraints, derivations, effects,
 * events, prefixed specs) so post-registration mutation of a nested operand
 * cannot silently change the compiled closure's behavior.
 */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const obj = value as unknown as object;
  if (seen.has(obj) || Object.isFrozen(obj)) {
    return value;
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item, seen);
    }
  } else {
    for (const key of Object.keys(obj)) {
      deepFreeze((obj as Record<string, unknown>)[key], seen);
    }
  }

  Object.freeze(obj);
  return value;
}

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
  let allKnown = true;
  for (const k of Object.keys(v)) {
    if (k.startsWith("$")) {
      hasDollarKey = true;
      if (!PREDICATE_OPERATORS.has(k)) {
        devWarn(
          `predicate: unknown operator "${k}" — looks like a typo. Known operators: ${[...PREDICATE_OPERATORS].join(", ")}`,
        );
        allKnown = false;
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
  // are typos. Unknown ops cause applyOperator() to return false (DX-C1).
  // `allKnown` is read but not consumed externally — left for future use.
  void allKnown;

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

function evalField(value: unknown, actual: unknown, prev: unknown): boolean {
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
): boolean {
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
      evaluatePredicate(p, facts, prev),
    );
  }
  if ("$any" in spec) {
    return (spec.$any as unknown[]).some((p) =>
      evaluatePredicate(p, facts, prev),
    );
  }
  if ("$not" in spec) {
    return !evaluatePredicate(spec.$not, facts, prev);
  }

  // Object form — every key AND-ed.
  for (const key of Object.keys(spec)) {
    if (PREDICATE_OPERATORS.has(key)) {
      devWarn(
        `predicate: operator "${key}" mixed with fact keys — wrap operators in a per-fact object`,
      );

      return false;
    }
    if (!evalField(spec[key], facts?.[key], prev?.[key])) {
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
export function extractDeps(
  spec: unknown,
  prefix = "",
  into?: Set<string>,
): Set<string> {
  const deps = into ?? new Set<string>();

  if (Array.isArray(spec)) {
    for (const clause of spec) {
      if (isPlainObject(clause) && typeof clause.fact === "string") {
        deps.add(prefix + clause.fact);
      }
    }

    return deps;
  }

  if (!isPlainObject(spec)) {
    return deps;
  }

  if ("$all" in spec || "$any" in spec) {
    const list = (spec.$all ?? spec.$any) as unknown[];
    for (const child of list) {
      extractDeps(child, prefix, deps);
    }

    return deps;
  }
  if ("$not" in spec) {
    return extractDeps(spec.$not, prefix, deps);
  }

  for (const key of Object.keys(spec)) {
    if (PREDICATE_OPERATORS.has(key)) {
      continue;
    }
    // A typo'd `$`-prefixed operator (e.g. `$eqq`) must NOT synthesize a
    // phantom dep like `"phase.$eqq"`. Skip the clause and dev-warn — the
    // operator-object detection emits its own warn on first eval.
    if (key.startsWith("$")) {
      devWarn(
        `extractDeps: unknown operator "${key}" — skipping. Known operators: ${[...PREDICATE_OPERATORS].join(", ")}`,
      );
      continue;
    }
    const value = spec[key];
    if (isPlainObject(value) && !isOperatorObject(value)) {
      extractDeps(value, `${prefix}${key}.`, deps);
    } else {
      deps.add(prefix + key);
    }
  }

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
