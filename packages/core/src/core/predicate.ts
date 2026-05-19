/**
 * Runtime for data-configuration predicates and templates (RFC-0004).
 *
 * Pure module — imports only its own types. Reads facts through whatever
 * object it is handed (the reactive `Facts` proxy in production, a plain
 * snapshot in tests), so it never depends on the engine, store, or tracking.
 */

import isDevelopment from "#is-development";
import {
  type ClauseResult,
  type FactTemplate,
  type PatchSpec,
  PREDICATE_OPERATORS,
  type PredicateOp,
} from "./types/predicate.js";

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

/** True when every own key of `v` is a recognized `$`-operator (and there is ≥1). */
function isOperatorObject(v: unknown): v is Record<string, unknown> {
  if (!isPlainObject(v)) {
    return false;
  }

  let count = 0;
  for (const k in v) {
    if (!PREDICATE_OPERATORS.has(k)) {
      return false;
    }
    count++;
  }

  return count > 0;
}

/**
 * True when `v` is a data-form spec (predicate object/array) rather than a
 * function. The universal escape-hatch discriminator: a function is the
 * function form, anything else object-shaped is the data form.
 */
export function isPredicateSpec(v: unknown): boolean {
  return v !== null && (typeof v === "object" || Array.isArray(v));
}

/** True when `v` is a {@link FactTemplate} (`{ $template: string }`). */
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

/** Structural equality with NaN/Date handling and a cycle guard. */
function deepEqual(a: unknown, b: unknown, seen?: Set<unknown>): boolean {
  if (Object.is(a, b)) {
    return true;
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }

  const guard = seen ?? new Set<unknown>();
  if (guard.has(a) || guard.has(b)) {
    return true; // cycle — treat as equal to avoid infinite recursion
  }
  guard.add(a);
  guard.add(b);

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }

    return a.every((v, i) => deepEqual(v, b[i], guard));
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

function relational(op: PredicateOp, actual: unknown, operand: unknown): boolean {
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

      return (
        relational("$gte", actual, operand[0]) &&
        relational("$lte", actual, operand[1])
      );
    }
    case "$matches": {
      if (typeof actual !== "string") {
        return false;
      }
      const re = operand instanceof RegExp ? operand : new RegExp(String(operand));

      return re.test(actual);
    }
    case "$contains":
      if (typeof actual === "string") {
        return actual.includes(String(operand));
      }
      if (Array.isArray(actual)) {
        return actual.some((v) => deepEqual(v, operand));
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
): boolean {
  if (isOperatorObject(value)) {
    for (const op in value) {
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
      isPlainObject(actual) ? actual : {},
      isPlainObject(prev) ? prev : undefined,
    );
  }

  // Bare value → equality.
  return deepEqual(actual, value);
}

/**
 * Evaluate a {@link FactPredicate} against a fact scope. `prev` (a previous
 * snapshot) is consulted only by the `$changed` operator.
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
  for (const key in spec) {
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
      const children = key === "$not" ? [spec.$not] : (spec[key] as unknown[]);
      for (const child of children) {
        out.push(
          ...evaluatePredicateExplained(child, facts, prev, pathPrefix),
        );
      }

      return out;
    }
  }

  for (const key in spec) {
    if (PREDICATE_OPERATORS.has(key)) {
      continue;
    }
    const value = spec[key];
    const actual = facts?.[key];
    const path = pathPrefix + key;

    if (isOperatorObject(value)) {
      for (const op in value) {
        out.push({
          path,
          op: op as PredicateOp,
          expected: value[op],
          actual,
          pass: applyOperator(op as PredicateOp, actual, value[op], prev?.[key]),
        });
      }
    } else if (isPlainObject(value)) {
      out.push(
        ...evaluatePredicateExplained(
          value,
          isPlainObject(actual) ? actual : {},
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

/**
 * Compile a predicate into a reusable closure. Specs are frozen at
 * registration, so the compiled closure is cached by spec identity.
 */
const compiledCache = new WeakMap<object, (facts: Scope, prev?: Scope) => boolean>();

export function compilePredicate(
  spec: object,
): (facts: Scope, prev?: Scope) => boolean {
  const cached = compiledCache.get(spec);
  if (cached) {
    return cached;
  }

  const fn = (facts: Scope, prev?: Scope): boolean =>
    evaluatePredicate(spec, facts, prev);
  compiledCache.set(spec, fn);

  return fn;
}

// ============================================================================
// Dependency extraction
// ============================================================================

/**
 * Collect the fact/derivation keys a predicate references. Used for static
 * analysis, devtools, and effect `on` dependency wiring. Nested predicates
 * contribute dotted keys (`auth.token`).
 */
export function extractDeps(spec: unknown, prefix = "", into?: Set<string>): Set<string> {
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

  for (const key in spec) {
    if (PREDICATE_OPERATORS.has(key)) {
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

function stringifyValue(v: unknown): string {
  if (typeof v === "symbol") {
    devWarn("template: cannot interpolate a symbol value — using empty string");

    return "";
  }
  if (v === undefined || v === null) {
    return "";
  }

  return String(v);
}

/**
 * Interpolate a {@link FactTemplate} against a scope. Single-pass character
 * scanner: `${ident}` interpolates `scope[ident]`; `$${` emits a literal
 * `${`; unknown keys dev-warn and yield an empty string.
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
        devWarn(`template: invalid placeholder "\${${key}}" — not an identifier`);
      } else {
        const value = scope?.[key];
        if (value === undefined) {
          devWarn(`template: unknown key "${key}"`);
        }
        out += stringifyValue(value);
      }
      i = end + 1;
      continue;
    }

    out += tpl[i];
    i++;
  }

  return out;
}

/** Collect the placeholder keys referenced by a template. */
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
 * Order-as-declared; JSON-encoded so distinct values never collide.
 */
export function evaluateKeySelector(
  selector: readonly string[],
  source: Record<string, unknown>,
): string {
  return selector.map((field) => JSON.stringify(source?.[field]) ?? "∅").join("|");
}

// ============================================================================
// Patch
// ============================================================================

/**
 * Apply a {@link PatchSpec} — assign facts from literals, payload copies
 * (`$ref`), or interpolated strings (`$template`). Mutates through the passed
 * `facts` proxy so change-tracking and downstream invalidation fire.
 */
export function applyPatch(
  spec: PatchSpec<Record<string, unknown>, Record<string, unknown>>,
  facts: Record<string, unknown>,
  payload: Record<string, unknown>,
): void {
  const set = spec.$set;
  for (const key in set) {
    const value = (set as Record<string, unknown>)[key];

    if (isTemplate(value)) {
      facts[key] = evaluateTemplate(value, payload ?? {});
    } else if (
      isPlainObject(value) &&
      Object.hasOwn(value, "$ref") &&
      typeof value.$ref === "string"
    ) {
      facts[key] = (payload ?? {})[value.$ref];
    } else {
      facts[key] = value;
    }
  }
}
