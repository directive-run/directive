/**
 * `describePredicate` — turn any {@link FactPredicate} into a precise,
 * human-readable English sentence (or algebraic expression).
 *
 * Closes the LLM-emit round-trip:
 *
 *   intent (NL) → predicate (AST) → describePredicate (NL) → reprompt
 *
 * Pure tree walker. No side effects. No throws on a valid predicate. On
 * an invalid input (cyclic spec, non-object) returns a sentinel string
 * rather than throwing, so it is safe to call on user/LLM input.
 *
 * Reuses no traversal infrastructure from `walkPredicate` directly because
 * `walkPredicate` is a callback walker (flat) and English rendering needs a
 * recursive return-value walker (tree). The two are isomorphic — same
 * structural rules, same depth cap, same cycle guard. Operator/value
 * formatting mirrors `rules-diff.ts`'s prose style.
 *
 * @module
 */

import type { FactPredicate } from "./types/predicate.js";
import {
  PREDICATE_COMBINATORS,
  PREDICATE_OPERATORS,
} from "./types/predicate.js";
import { MAX_PREDICATE_DEPTH } from "./predicate.js";
import isDevelopment from "#is-development";

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Per-locale `Intl.NumberFormat` cache. `Intl.NumberFormat` construction is
 * surprisingly expensive — describing a predicate with N numeric operands
 * used to allocate N formatters. Cached lookup is O(1) after first call.
 *
 * Invalid locales (e.g. user-supplied garbage) fall back to `"en-US"`.
 *
 * @internal Exported for tests; do not import from application code.
 */
const numberFormatCache = new Map<string, Intl.NumberFormat>();

/** @internal */
export function getNumberFormat(locale: string): Intl.NumberFormat {
  let fmt = numberFormatCache.get(locale);
  if (!fmt) {
    try {
      fmt = new Intl.NumberFormat(locale);
    } catch {
      fmt = new Intl.NumberFormat("en-US"); // fallback for invalid locales
    }
    numberFormatCache.set(locale, fmt);
  }

  return fmt;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Options controlling how {@link describePredicate} renders a predicate.
 */
export interface DescribeOptions {
  /** Locale for number formatting (default: `"en-US"`). */
  locale?: string;
  /** Wrap each clause in parens when there's > 1 clause. Default `true`. */
  parenthesize?: boolean;
  /** Style: `"natural"` (English prose) or `"formal"` (algebraic). Default `"natural"`. */
  style?: "natural" | "formal";
  /**
   * Friendly fact-name renderer. Default: pass-through. Use to map e.g.
   * `cartTotal` → `"cart total"`. Only consulted in `"natural"` style — the
   * formal style preserves the raw dotted path so output stays algebraic.
   */
  factName?: (path: string) => string;
}

/**
 * Render a {@link FactPredicate} as a precise human-readable sentence.
 *
 * Renders a `FactPredicate` as English by default (`style: 'natural'`);
 * pass `style: 'formal'` for algebraic notation (`≥`, `∈`, `∧`, etc.).
 *
 * @remarks
 * Exported as `describePredicate` (not `describe`) to avoid collision with
 * vitest's `describe()`.
 *
 * @example
 * ```ts
 * describePredicate({ cartTotal: { $gte: 50 } });
 * // → "cartTotal is at least 50"
 *
 * describePredicate(
 *   { $any: [{ region: "US" }, { region: "EU" }] },
 *   { factName: (p) => p.replace(/([A-Z])/g, " $1").toLowerCase() },
 * );
 * // → "(region is US) OR (region is E U)"
 *
 * describePredicate({ cartTotal: { $gte: 50 } }, { style: "formal" });
 * // → "cartTotal ≥ 50"
 * ```
 */
export function describePredicate<F = Record<string, unknown>>(
  predicate: FactPredicate<F>,
  opts: DescribeOptions = {},
): string {
  const style = opts.style ?? "natural";
  const parenthesize = opts.parenthesize ?? true;
  const locale = opts.locale ?? "en-US";
  const factName = opts.factName ?? ((p: string) => p);

  // A non-object input is not a predicate at all.
  if (predicate === null || typeof predicate !== "object") {
    return "<invalid predicate>";
  }

  const ctx: Ctx = {
    style,
    parenthesize,
    locale,
    factName,
    seen: new WeakSet<object>(),
    cycle: false,
  };

  const out = render(predicate as unknown, ctx, 0);
  if (ctx.cycle) {
    return "<invalid predicate: cycle>";
  }

  return out;
}

// ============================================================================
// Internals
// ============================================================================

interface Ctx {
  style: "natural" | "formal";
  parenthesize: boolean;
  locale: string;
  factName: (path: string) => string;
  seen: WeakSet<object>;
  cycle: boolean;
}

const AND_NATURAL = " AND ";
const OR_NATURAL = " OR ";
const NOT_NATURAL = "NOT";
const AND_FORMAL = " ∧ ";
const OR_FORMAL = " ∨ ";
const NOT_FORMAL = "¬";

function isPlainObjectLike(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return false;
  }

  return !(v instanceof Date) && !(v instanceof RegExp);
}

/**
 * True when every own key of `v` starts with `$`. Mirrors the runtime's
 * operator-object boundary without the warning side-effect — describe is
 * pure, so an unknown `$`-op falls through to the generic rendering instead
 * of warning here.
 */
function isOperatorObject(v: unknown): v is Record<string, unknown> {
  if (!isPlainObjectLike(v)) {
    return false;
  }
  const keys = Object.keys(v);
  if (keys.length === 0) {
    return false;
  }
  for (const k of keys) {
    if (!k.startsWith("$")) {
      return false;
    }
  }

  return true;
}

/**
 * Recursive tree renderer. Returns the rendered string for `spec` (without
 * outer parens). Caller wraps if it needs to parenthesize.
 */
function render(spec: unknown, ctx: Ctx, depth: number): string {
  if (depth > MAX_PREDICATE_DEPTH) {
    if (isDevelopment) {
      console.warn(
        `[Directive] describePredicate: depth limit (${MAX_PREDICATE_DEPTH}) exceeded — bailing.`,
      );
    }

    return ctx.style === "formal" ? "⊥" : "always true";
  }

  // Array-clause form
  if (Array.isArray(spec)) {
    return renderArrayClauses(spec, ctx, depth);
  }

  if (!isPlainObjectLike(spec)) {
    // A non-object at a position where a predicate node was expected. This
    // happens for `{ $not: "red" }` (operand isn't a predicate). Render as
    // a literal so the caller still gets a sentence.
    return formatValue(spec, ctx);
  }

  if (ctx.seen.has(spec)) {
    ctx.cycle = true;

    return "<invalid predicate: cycle>";
  }
  ctx.seen.add(spec);

  const obj = spec as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Combinator node ($all / $any / $not). Mirrors walkPredicate's precedence —
  // the first present combinator wins; sibling fact keys (if any) are
  // ignored. Empty arrays handled: `$all: []` → "always true"; `$any: []` →
  // "never"; `$not: {}` → "never".
  for (const kind of ["$all", "$any", "$not"] as const) {
    if (kind in obj) {
      return renderCombinator(kind, obj[kind], ctx, depth);
    }
  }

  // Object form — implicit AND across keys. Skip top-level `$`-keys (stray
  // operator at fact position — the runtime warns; we drop silently).
  const clauses: string[] = [];
  for (const key of keys) {
    if (key.startsWith("$")) {
      // Stray operator at fact position — not a fact clause. Skip.
      continue;
    }
    clauses.push(renderFieldClause(key, obj[key], ctx, depth));
  }

  return joinAnd(clauses, ctx);
}

function renderArrayClauses(
  spec: readonly unknown[],
  ctx: Ctx,
  _depth: number,
): string {
  const clauses: string[] = [];
  for (const clause of spec) {
    if (!isPlainObjectLike(clause)) {
      continue;
    }
    const c = clause as Record<string, unknown>;
    if (typeof c.fact !== "string" || typeof c.op !== "string") {
      continue;
    }
    clauses.push(renderOperator(c.fact, c.op, c.value, ctx));
  }
  if (clauses.length === 0) {
    return ctx.style === "formal" ? "⊤" : "always true";
  }

  return joinAnd(clauses, ctx);
}

function renderCombinator(
  kind: "$all" | "$any" | "$not",
  child: unknown,
  ctx: Ctx,
  depth: number,
): string {
  if (kind === "$not") {
    // Empty / always-true child → "never". A non-object child is treated as
    // a literal predicate (mirrors evaluatePredicate's `Boolean(spec)`
    // coercion for non-objects).
    if (isPlainObjectLike(child) && Object.keys(child).length === 0) {
      return ctx.style === "formal" ? "⊥" : "never";
    }
    const inner = render(child, ctx, depth + 1);
    if (inner === "always true") {
      return "never";
    }
    if (inner === "⊤") {
      return "⊥";
    }
    const notKw = ctx.style === "formal" ? NOT_FORMAL : `${NOT_NATURAL} `;

    return `${notKw}(${inner})`;
  }

  // $all / $any
  if (!Array.isArray(child)) {
    return ctx.style === "formal" ? "⊥" : "<invalid predicate>";
  }
  if (child.length === 0) {
    if (kind === "$all") {
      return ctx.style === "formal" ? "⊤" : "always true";
    }

    return ctx.style === "formal" ? "⊥" : "never";
  }

  const parts: string[] = [];
  for (const subSpec of child) {
    const rendered = render(subSpec, ctx, depth + 1);
    parts.push(rendered);
  }

  if (parts.length === 1) {
    return parts[0]!;
  }

  // Parenthesize each conjunct/disjunct when there's > 1 child. Disabling
  // `opts.parenthesize` drops the parens — useful for short-flat output, at
  // the cost of mixed AND/OR ambiguity.
  const wrapped = ctx.parenthesize ? parts.map((p) => `(${p})`) : parts;

  if (kind === "$all") {
    return wrapped.join(ctx.style === "formal" ? AND_FORMAL : AND_NATURAL);
  }

  return wrapped.join(ctx.style === "formal" ? OR_FORMAL : OR_NATURAL);
}

/**
 * Render `key: value` as a clause. `value` may be a bare literal (equality),
 * an operator object, or a nested-object (cross-module pivot) predicate.
 */
function renderFieldClause(
  key: string,
  value: unknown,
  ctx: Ctx,
  depth: number,
): string {
  if (isOperatorObject(value)) {
    const opObj = value as Record<string, unknown>;
    const opKeys = Object.keys(opObj);
    if (opKeys.length === 1) {
      return renderOperator(key, opKeys[0]!, opObj[opKeys[0]!], ctx);
    }
    // Multi-operator object (best-effort AND, matches runtime). Render each
    // and join.
    const subs = opKeys.map((op) => renderOperator(key, op, opObj[op], ctx));

    return joinAnd(subs, ctx);
  }

  // Nested predicate (cross-module / partial-match). Recurse with a dotted
  // path prefix so child clauses render as `auth.token is set`.
  if (isPlainObjectLike(value)) {
    const obj = value as Record<string, unknown>;
    // Combinator-keyed nested object → recurse normally; the path prefix
    // doesn't apply to a combinator wrapper.
    const hasCombinator =
      "$all" in obj || "$any" in obj || "$not" in obj;
    if (hasCombinator) {
      return render(value, ctx, depth + 1);
    }
    const subClauses: string[] = [];
    for (const subKey of Object.keys(obj)) {
      if (subKey.startsWith("$")) {
        continue;
      }
      subClauses.push(
        renderFieldClause(`${key}.${subKey}`, obj[subKey], ctx, depth + 1),
      );
    }
    if (subClauses.length === 0) {
      // Empty nested object — equality to `{}`.
      return renderOperator(key, "$eq", value, ctx);
    }

    return joinAnd(subClauses, ctx);
  }

  // Bare value — equality.
  return renderOperator(key, "$eq", value, ctx);
}

// ============================================================================
// Operator rendering
// ============================================================================

function renderOperator(
  factPath: string,
  op: string,
  operand: unknown,
  ctx: Ctx,
): string {
  // In formal style preserve the raw path; in natural style allow user
  // remapping (e.g. cartTotal → "cart total").
  const name =
    ctx.style === "formal" ? factPath : ctx.factName(factPath);

  if (ctx.style === "formal") {
    return renderOperatorFormal(name, op, operand, ctx);
  }

  return renderOperatorNatural(name, op, operand, ctx);
}

function renderOperatorNatural(
  name: string,
  op: string,
  operand: unknown,
  ctx: Ctx,
): string {
  switch (op) {
    case "$eq":
      if (operand === null) {
        return `${name} is null`;
      }

      return `${name} is ${formatValue(operand, ctx)}`;
    case "$ne":
      if (operand === null) {
        return `${name} is not null`;
      }

      return `${name} is not ${formatValue(operand, ctx)}`;
    case "$gt":
      return `${name} is more than ${formatValue(operand, ctx)}`;
    case "$gte":
      return `${name} is at least ${formatValue(operand, ctx)}`;
    case "$lt":
      return `${name} is less than ${formatValue(operand, ctx)}`;
    case "$lte":
      return `${name} is at most ${formatValue(operand, ctx)}`;
    case "$in":
      return `${name} is one of ${formatList(operand, ctx)}`;
    case "$nin":
      return `${name} is not one of ${formatList(operand, ctx)}`;
    case "$exists":
      return operand === true
        ? `${name} is set`
        : `${name} is not set`;
    case "$between": {
      if (Array.isArray(operand) && operand.length === 2) {
        return `${name} is between ${formatValue(operand[0], ctx)} and ${formatValue(operand[1], ctx)}`;
      }

      return `${name} is between ${formatValue(operand, ctx)}`;
    }
    case "$startsWith":
      return `${name} starts with ${formatString(operand, ctx, /*alwaysQuote=*/ true)}`;
    case "$endsWith":
      return `${name} ends with ${formatString(operand, ctx, true)}`;
    case "$contains":
      return `${name} contains ${formatString(operand, ctx, true)}`;
    case "$matches":
      if (operand instanceof RegExp) {
        return `${name} matches ${operand.toString()}`;
      }

      return `${name} matches ${formatValue(operand, ctx)}`;
    case "$changed":
      return `${name} changed`;
    default: {
      if (isDevelopment && !PREDICATE_OPERATORS.has(op)) {
        console.warn(
          `[Directive] describePredicate: unknown operator "${op}" — falling through to generic rendering.`,
        );
      }

      return `${name} ${op} ${formatValue(operand, ctx)}`;
    }
  }
}

function renderOperatorFormal(
  name: string,
  op: string,
  operand: unknown,
  ctx: Ctx,
): string {
  switch (op) {
    case "$eq":
      return `${name} = ${formatValue(operand, ctx)}`;
    case "$ne":
      return `${name} ≠ ${formatValue(operand, ctx)}`;
    case "$gt":
      return `${name} > ${formatValue(operand, ctx)}`;
    case "$gte":
      return `${name} ≥ ${formatValue(operand, ctx)}`;
    case "$lt":
      return `${name} < ${formatValue(operand, ctx)}`;
    case "$lte":
      return `${name} ≤ ${formatValue(operand, ctx)}`;
    case "$in":
      return `${name} ∈ {${formatListInner(operand, ctx)}}`;
    case "$nin":
      return `${name} ∉ {${formatListInner(operand, ctx)}}`;
    case "$exists":
      return operand === true ? `∃ ${name}` : `∄ ${name}`;
    case "$between": {
      if (Array.isArray(operand) && operand.length === 2) {
        return `${formatValue(operand[0], ctx)} ≤ ${name} ≤ ${formatValue(operand[1], ctx)}`;
      }

      return `${name} ∈ [${formatValue(operand, ctx)}]`;
    }
    case "$startsWith":
      return `${name} ^= ${formatString(operand, ctx, true)}`;
    case "$endsWith":
      return `${name} $= ${formatString(operand, ctx, true)}`;
    case "$contains":
      return `${name} ⊇ ${formatString(operand, ctx, true)}`;
    case "$matches":
      if (operand instanceof RegExp) {
        return `${name} ~ ${operand.toString()}`;
      }

      return `${name} ~ ${formatValue(operand, ctx)}`;
    case "$changed":
      return `Δ${name}`;
    default: {
      if (isDevelopment && !PREDICATE_OPERATORS.has(op)) {
        console.warn(
          `[Directive] describePredicate: unknown operator "${op}" — falling through to generic rendering.`,
        );
      }

      return `${name} ${op} ${formatValue(operand, ctx)}`;
    }
  }
}

// ============================================================================
// Value formatting
// ============================================================================

/**
 * True if a string needs quoting in natural style (contains whitespace,
 * commas, quotes, or is empty).
 */
function stringNeedsQuotes(s: string): boolean {
  if (s.length === 0) {
    return true;
  }

  return /[\s,"']/.test(s);
}

function formatString(
  v: unknown,
  _ctx: Ctx,
  alwaysQuote: boolean,
): string {
  if (typeof v !== "string") {
    return JSON.stringify(v);
  }
  if (alwaysQuote || stringNeedsQuotes(v)) {
    return JSON.stringify(v);
  }

  return v;
}

function formatValue(v: unknown, ctx: Ctx): string {
  if (v === null) {
    return "null";
  }
  if (v === undefined) {
    return "undefined";
  }
  if (typeof v === "boolean") {
    return v ? "true" : "false";
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      return String(v);
    }
    try {
      return getNumberFormat(ctx.locale).format(v);
    } catch {
      return String(v);
    }
  }
  if (typeof v === "bigint") {
    if (ctx.style === "formal") {
      return `${v.toString()}n`;
    }

    return v.toString();
  }
  if (typeof v === "string") {
    if (ctx.style === "formal") {
      return JSON.stringify(v);
    }

    return stringNeedsQuotes(v) ? JSON.stringify(v) : v;
  }
  if (v instanceof Date) {
    return v.toISOString();
  }
  if (v instanceof RegExp) {
    return v.toString();
  }
  if (Array.isArray(v)) {
    return `[${v.map((x) => formatValue(x, ctx)).join(", ")}]`;
  }
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return "[object]";
    }
  }

  return String(v);
}

/** Render an `$in` / `$nin` operand for natural style — comma list, no braces. */
function formatList(operand: unknown, ctx: Ctx): string {
  if (!Array.isArray(operand)) {
    return formatValue(operand, ctx);
  }

  return operand
    .map((v) => {
      if (typeof v === "string") {
        return stringNeedsQuotes(v) ? JSON.stringify(v) : v;
      }

      return formatValue(v, ctx);
    })
    .join(", ");
}

/** Render an `$in` / `$nin` operand for formal style — comma list, no braces (caller wraps in {}). */
function formatListInner(operand: unknown, ctx: Ctx): string {
  if (!Array.isArray(operand)) {
    return formatValue(operand, ctx);
  }

  return operand
    .map((v) => {
      if (typeof v === "string") {
        return stringNeedsQuotes(v) ? JSON.stringify(v) : v;
      }

      return formatValue(v, ctx);
    })
    .join(", ");
}

// ============================================================================
// Join helpers
// ============================================================================

function joinAnd(clauses: string[], ctx: Ctx): string {
  if (clauses.length === 0) {
    return ctx.style === "formal" ? "⊤" : "always true";
  }
  if (clauses.length === 1) {
    return clauses[0]!;
  }
  const sep = ctx.style === "formal" ? AND_FORMAL : AND_NATURAL;
  if (!ctx.parenthesize) {
    return clauses.join(sep);
  }

  return clauses.join(sep);
}

// (Re-export the combinator set so consumers can introspect what describe
// understands without round-tripping through `types/predicate`.)
export const DESCRIBE_COMBINATORS = PREDICATE_COMBINATORS;
