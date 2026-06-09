/**
 * Fact-PII Guardrail — input guardrail at the fact-store boundary
 *
 * Closes the source → fact → agent prompt PII bypass surfaced by R5's
 * red-team / privacy / AI-integration reviewers: `createPIIGuardrail`
 * only inspects the `data.input` string at runStream entry, so PII that
 * a source publishes into a fact (a Supabase realtime row carrying a
 * customer email, a webhook payload with a SSN, an MCP server's
 * resource notification with a card number) reaches the agent's
 * prompt — via fact injection — without ever hitting the input
 * guardrail chain.
 *
 * This plugin runs as a Directive plugin (`onFactSet` / `onFactsBatch`),
 * scans every write to a pii-tagged fact against a sync regex matcher
 * for the three highest-volume PII categories (SSN, credit card, email),
 * and either **redacts** the value (the default — safe shipping posture)
 * or **rejects** the write (throws so the source's publish handler can
 * surface the violation). Operators wire it once at `createSystem`; no
 * per-source / per-fact changes are required.
 *
 * The async PII detector from `pii-enhanced.ts` is unsuitable here:
 * `onFactSet` is synchronous and a deferred detection would let the
 * raw PII reach observers + breakpoints + audit-ledger before the
 * redaction completed. Built-in matching is therefore inlined as
 * synchronous regex. Consumers who need richer detection pass a
 * synchronous `customDetector`.
 *
 * @example Defensive (redact PII writes into pii-tagged facts)
 * ```ts
 * import { createSystem, t } from '@directive-run/core';
 * import { createFactPIIGuardrail } from '@directive-run/ai/guardrails';
 *
 * const customer = createModule('customer', {
 *   schema: {
 *     facts: {
 *       email: t.string().meta({ tags: ['pii'] }),
 *       ssn: t.string().meta({ tags: ['pii'] }),
 *     },
 *   },
 *   sources: {
 *     supabase: { attach: (publish) => subscribe(publish) },
 *   },
 * });
 *
 * const system = createSystem({
 *   module: customer,
 *   plugins: [
 *     createFactPIIGuardrail({
 *       mode: 'redact',
 *       onBlocked: (key, detected) => {
 *         console.warn(`[fact-pii] redacted ${detected.length} match(es) in ${key}`);
 *       },
 *     }),
 *   ],
 * });
 * ```
 *
 * @example Monitor-only (alert on every PII match; don't mutate the fact)
 * ```ts
 * createFactPIIGuardrail({
 *   mode: 'alert',
 *   onBlocked: (key) => Sentry.captureException(new Error(`pii match: ${key}`)),
 * });
 * ```
 *
 * @example Allow specific keys (not just by tag)
 * ```ts
 * createFactPIIGuardrail({
 *   includeKeys: ['customer.email', 'customer.phone'],
 * });
 * ```
 */

import type { Plugin, System } from "@directive-run/core";

// ============================================================================
// Sync PII patterns
// ============================================================================

/**
 * Public match record for a single PII finding. Mirrors `DetectedPII` from
 * `pii-enhanced.ts` so a downstream guardrail can normalize against either
 * detection path.
 */
export interface FactPIIMatch {
  type: FactPIICategory;
  value: string;
  start: number;
  end: number;
}

/** PII categories the built-in synchronous detector covers. */
export type FactPIICategory = "ssn" | "credit_card" | "email";

interface SyncPattern {
  type: FactPIICategory;
  regex: RegExp;
  /**
   * Optional post-regex validator. Returning false drops the match.
   * Used by credit-card detection to apply the Luhn algorithm (mirrors
   * the validator in `pii-enhanced.ts`) so phone numbers / tracking IDs
   * formatted with separators don't mass-redact as credit cards.
   */
  validate?: (value: string) => boolean;
  redactionToken: string;
}

/**
 * Luhn checksum — drops credit-card false positives the regex would
 * otherwise pull in (any 13-19 digit sequence with separators). Mirrors
 * the validator in `pii-enhanced.ts` so the two detection paths agree.
 */
function luhnValid(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const ch = digits[i];
    if (!ch) continue;
    let d = Number.parseInt(ch, 10);
    if (isEven) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    isEven = !isEven;
  }
  return sum % 10 === 0;
}

// Synchronous patterns. These mirror the highest-volume categories from
// pii-enhanced.ts; richer detection (addresses, names, phones) is the
// caller's responsibility via `customDetector` because they require
// context-aware logic that's a poor fit for a per-fact-write hook.
//
// SSN pattern accepts the canonical XXX-XX-XXXX format. Internal IDs
// formatted the same way will false-positive; the trade-off favors
// safety (the redaction token is harmless if applied to a non-SSN).
//
// Credit-card pattern combines the broad 13-19-digit regex with a Luhn
// validator so phone numbers, tracking IDs, and other long digit
// sequences with separators are NOT swept up. This mirrors how
// `pii-enhanced.ts` keeps its credit-card detection accurate.
const SYNC_PATTERNS: SyncPattern[] = [
  {
    type: "ssn",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    redactionToken: "[SSN]",
  },
  {
    type: "credit_card",
    regex: /\b((?:\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4})|\d{13,19})\b/g,
    validate: luhnValid,
    redactionToken: "[CREDIT_CARD]",
  },
  {
    type: "email",
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    redactionToken: "[EMAIL]",
  },
];

function scanText(
  text: string,
  types: ReadonlySet<FactPIICategory>,
): FactPIIMatch[] {
  const out: FactPIIMatch[] = [];
  for (const pattern of SYNC_PATTERNS) {
    if (!types.has(pattern.type)) continue;
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic exec loop
    while ((match = pattern.regex.exec(text)) !== null) {
      if (pattern.validate && !pattern.validate(match[0])) continue;
      out.push({
        type: pattern.type,
        value: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return out;
}

function redactText(text: string, matches: FactPIIMatch[]): string {
  if (matches.length === 0) return text;
  // Sort matches by start position descending so splicing doesn't shift
  // subsequent offsets.
  const sorted = [...matches].sort((a, b) => b.start - a.start);
  const tokenByType: Record<FactPIICategory, string> = {
    ssn: "[SSN]",
    credit_card: "[CREDIT_CARD]",
    email: "[EMAIL]",
  };
  let out = text;
  for (const m of sorted) {
    out = out.slice(0, m.start) + tokenByType[m.type] + out.slice(m.end);
  }
  return out;
}

// ============================================================================
// Options
// ============================================================================

/**
 * Behavior when a pii-tagged fact's incoming value contains detected PII.
 *
 * - `"redact"` (default): the fact is rewritten with redacted text (e.g.
 *   `"[SSN]"`) via a follow-up store write. The system briefly observes
 *   the raw value during the same microtask the publish landed in, then
 *   the redacted value overwrites it before any reconcile / agent runs.
 *   Safe shipping posture for production: the LLM call always sees the
 *   redacted value.
 * - `"alert"`: fire `onBlocked` but DO NOT mutate the fact. The raw value
 *   stays in the store. Use this for monitoring-only deployments where
 *   the source's transport is already trusted but a regression detector
 *   is needed (paging ops on every match).
 *
 * Note: Directive plugin hooks (`onFactSet`, `onFactsBatch`) are
 * wrapped by the plugin manager's `safeCall` so a throw from inside the
 * hook is swallowed. The guardrail therefore cannot reject the write
 * itself — it can only observe + redact-via-followup-write or alert.
 * For hard rejection at the publish boundary, a future RFC will add a
 * pre-commit transform hook on the source primitive.
 */
export type FactPIIGuardrailMode = "redact" | "alert";

export interface FactPIIGuardrailOptions {
  /** Default: `"redact"` */
  mode?: FactPIIGuardrailMode;
  /**
   * Built-in categories to scan for. Default: all three (`ssn`,
   * `credit_card`, `email`). Pass `[]` to opt out of the built-ins and
   * rely entirely on `customDetector`.
   */
  types?: readonly FactPIICategory[];
  /**
   * Specific fact keys to scan in addition to the auto-detected
   * `pii`-tagged set. Useful when a consumer can't change the schema's
   * meta but knows the key should be screened.
   */
  includeKeys?: readonly string[];
  /**
   * Exclude these fact keys even if they're pii-tagged. Escape hatch for
   * a key that's already pre-sanitized upstream of the manager.
   */
  excludeKeys?: readonly string[];
  /**
   * Called whenever the guardrail detects PII and acts on it. Receives the
   * fact key, the detected matches, and the action that was taken. Fires
   * AFTER redact + before any throw in `reject` mode. Use this to alert
   * SREs without coupling the guardrail to a specific logging backend.
   */
  onBlocked?: (
    key: string,
    detected: readonly FactPIIMatch[],
    action: FactPIIGuardrailMode,
  ) => void;
  /**
   * Custom synchronous detector that runs alongside the built-in regex
   * scanner. The union of detections is acted on. Useful when the
   * consumer ships a domain-specific PII detector (e.g. internal
   * account-number format). MUST be synchronous — `onFactSet` cannot
   * await deferred work.
   */
  customDetector?: (text: string) => readonly FactPIIMatch[];
  /**
   * Maximum nesting depth to walk when scanning a structured fact
   * value. Default `1` — the scanner inspects top-level strings AND
   * recurses one level into nested objects / arrays. Each array level
   * burns one depth slot (so `[[email]]` at `walkDepth: 1` walks the
   * outer array but its inner array is NOT scanned). Maps and Sets
   * are still NOT walked by the built-in scanner; PII inside those
   * structures must go through a `customDetector`.
   *
   * Real-world common shapes and the `walkDepth` they need:
   * - **Flat object** (`{ email, ssn }`) — works at default `1`.
   * - **Nested object** (`{ profile: { email } }`) — needs `walkDepth: 2`.
   * - **Supabase realtime row payload** (`payload.new = [{ email }]`,
   *   passed as the fact value) — the fact's value is the object
   *   `{ new: [...] }`, so the chain is object → array → object →
   *   string and needs `walkDepth: 4`.
   * - **MCP resource notification list** (`{ resources: [{...}] }`) —
   *   same shape, needs `walkDepth: 4`.
   *
   * For deeper or non-object structures (Maps, Sets, class instances
   * with getters, Symbol-keyed properties), pass a `customDetector`
   * that walks the consumer-specific shape and returns concrete
   * matches.
   *
   * **Hard caps for safety:**
   * - `walkDepth` clamps to `[1, 5]` to prevent pathological recursion
   *   on cyclic structures. Non-finite values (`NaN`, `Infinity`,
   *   non-number casts) clamp to `1`.
   * - The walker caps any single array's element count at 10,000
   *   (warns + truncates). Pass a `customDetector` for larger
   *   payloads.
   * - Cycles via shared object references are detected and the
   *   walker treats re-encountered ancestors as "no match" rather
   *   than recursing.
   *
   * Property iteration uses `Object.entries`, which skips
   * Symbol-keyed properties and non-enumerable string keys. If you
   * store PII under a Symbol key (unusual), a `customDetector` is the
   * right escape hatch.
   */
  walkDepth?: number;
}

// ============================================================================
// Plugin factory
// ============================================================================

interface MetaCapableSystem {
  meta?: {
    byTag?: (tag: string) => Array<{ type?: string; id?: string }>;
  };
  facts?: {
    $store?: {
      set?: (k: string, v: unknown) => void;
    };
  };
}

/**
 * Create a Directive plugin that scans pii-tagged fact writes for PII and
 * redacts or rejects them at the manager boundary.
 *
 * Wire it once at `createSystem({ plugins: [...] })`. The plugin caches
 * the pii-tagged key set on `onInit` so per-write hooks are O(1) lookups.
 *
 * @returns a `Plugin` instance ready to add to `SystemConfig.plugins`.
 */
export function createFactPIIGuardrail(
  options: FactPIIGuardrailOptions = {},
): Plugin {
  const {
    mode = "redact",
    types = ["ssn", "credit_card", "email"] as const,
    includeKeys = [],
    excludeKeys = [],
    onBlocked,
    customDetector,
    walkDepth = 1,
  } = options;

  const typeSet = new Set<FactPIICategory>(types);
  const screenedKeys = new Set<string>(includeKeys);
  const excludedSet = new Set(excludeKeys);
  // Clamp walkDepth to [1, 5]. Lower bound prevents accidental no-op
  // scans (`walkDepth: 0` would skip even top-level string members);
  // upper bound caps pathological recursion on cyclic structures.
  // `Number.isFinite` guards against NaN / Infinity / non-numeric
  // casts (R15) — `Math.floor(NaN) === NaN`, `Math.min/max(5, NaN) ===
  // NaN`, so the chain collapsed to NaN without the finite guard;
  // recursion then used `depth - 1 === NaN` and the bound never
  // triggered.
  const effectiveWalkDepth = Number.isFinite(walkDepth)
    ? Math.max(1, Math.min(5, Math.floor(walkDepth as number)))
    : 1;

  // Hard cap on per-array element count. A `Proxy` whose
  // `Symbol.iterator` yields a billion items would block the event
  // loop / OOM the worker during `[...value]` spread — and the throw
  // from V8's allocation failure is swallowed by `safeCall` at the
  // plugin boundary so the raw PII would commit to the store
  // unredacted (R15-CRIT-1). Anything past the cap is left as-is on
  // the redacted output AND reported via `console.warn` so consumers
  // see the truncation rather than a silent miss.
  const MAX_ARRAY_SCAN = 10_000;
  let initialized = false;
  let systemRef: System | null = null;

  function initScreenedKeys(system: System): void {
    if (initialized) return;
    initialized = true;
    systemRef = system;
    const piiTagged = (system as unknown as MetaCapableSystem).meta?.byTag?.(
      "pii",
    );
    if (!piiTagged) return;
    for (const entry of piiTagged) {
      // MetaMatch shape: { type: "fact" | "module" | "event" | ..., id: string, meta }.
      // We screen FACT-typed matches only — agent prompts read facts, not
      // event / constraint / derivation metadata.
      if (entry.type !== "fact") continue;
      if (entry.id && !excludedSet.has(entry.id)) {
        screenedKeys.add(entry.id);
      }
    }
  }

  function runScan(text: string): FactPIIMatch[] {
    const all: FactPIIMatch[] = [];
    if (typeSet.size > 0) {
      for (const m of scanText(text, typeSet)) all.push(m);
    }
    if (customDetector) {
      for (const m of customDetector(text)) all.push(m);
    }
    return all;
  }

  // R15 cycle guard — switched from a permanent WeakSet (which
  // false-skipped a non-cyclic payload that re-used the same object
  // reference at multiple slots; R15-CRIT-3) to a per-walk
  // "in-progress" set: add on entry, REMOVE on exit. This catches
  // true cycles (a re-encountered ancestor still on the walk path) but
  // permits a shared leaf (`{ primary: user, secondary: user }`) to
  // redact at every occurrence.
  function inspect(
    value: unknown,
    depth: number = effectiveWalkDepth,
    inProgress: WeakSet<object> = new WeakSet(),
  ):
    | { matched: false }
    | { matched: true; redacted: unknown; detected: FactPIIMatch[] } {
    if (typeof value === "string") {
      const detected = runScan(value);
      if (detected.length === 0) return { matched: false };
      return { matched: true, redacted: redactText(value, detected), detected };
    }
    if (depth <= 0) return { matched: false };
    if (value !== null && typeof value === "object") {
      if (inProgress.has(value as object)) return { matched: false };
      inProgress.add(value as object);
    }
    try {
      return inspectStructural(value, depth, inProgress);
    } catch (err) {
      // R15-CRIT-2 — a `Proxy` whose `Symbol.iterator` returns `undefined`
      // (or whose `ownKeys` trap throws) used to crash the walker; the
      // throw was swallowed by `safeCall` at the plugin boundary so the
      // raw PII committed to the store unredacted. Wrap the structural
      // walk in try/catch so a hostile shape becomes "no match" rather
      // than a silent commit + audit-trail leak.
      // eslint-disable-next-line no-console
      console.warn(
        "[Directive] fact-pii walker threw on shape — leaving value as-is and skipping inspection",
        err instanceof Error ? err.message : String(err),
      );
      return { matched: false };
    } finally {
      if (value !== null && typeof value === "object") {
        inProgress.delete(value as object);
      }
    }
  }

  function inspectStructural(
    value: unknown,
    depth: number,
    inProgress: WeakSet<object>,
  ):
    | { matched: false }
    | { matched: true; redacted: unknown; detected: FactPIIMatch[] } {
    if (Array.isArray(value)) {
      // Walk array elements with the same depth budget the object
      // branch uses. R13 added the array branch (Supabase realtime
      // payloads ship as `payload.new = [{ ... }]`). R14 decremented
      // depth and snapshotted before iterating to close the per-index
      // TOCTOU. R15 caps the snapshot length to MAX_ARRAY_SCAN —
      // beyond that, the spread itself is the DoS vector (a Proxy
      // whose `Symbol.iterator` yields a billion items would block
      // the event loop). Element 0..MAX-1 are scanned; element
      // MAX..N is left in the redacted output as-is and a warning
      // is logged so consumers see the truncation. Symbol keys,
      // Maps, and Sets remain out of scope (use a `customDetector`).
      let snapshot: unknown[];
      let truncated = false;
      try {
        if (value.length > MAX_ARRAY_SCAN) {
          snapshot = Array.prototype.slice.call(
            value as unknown as ArrayLike<unknown>,
            0,
            MAX_ARRAY_SCAN,
          );
          truncated = true;
        } else {
          snapshot = [...value];
        }
      } catch {
        // Proxy whose Symbol.iterator throws — treat as no match.
        return { matched: false };
      }
      if (truncated) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Directive] fact-pii walker truncated array at ${MAX_ARRAY_SCAN} elements — pass a customDetector for larger payloads`,
        );
      }
      let mutatedArr: unknown[] | null = null;
      const all: FactPIIMatch[] = [];
      for (let i = 0; i < snapshot.length; i++) {
        const nested = inspect(snapshot[i], depth - 1, inProgress);
        if (!nested.matched) continue;
        if (mutatedArr === null) mutatedArr = [...snapshot];
        mutatedArr[i] = nested.redacted;
        for (const d of nested.detected) all.push(d);
      }
      if (mutatedArr === null) return { matched: false };
      return { matched: true, redacted: mutatedArr, detected: all };
    }
    if (value && typeof value === "object") {
      // Walk plain objects up to `walkDepth` levels deep so a source
      // publishing a nested PII shape (e.g. `{ profile: { email } }`) is
      // screened when the consumer opts into `walkDepth: 2+`. Maps and
      // Sets are out of scope — pass a `customDetector` for those.
      // Symbol-keyed properties are NOT walked because `Object.entries`
      // skips them (documented in the JSDoc at the top of this file).
      let mutated: Record<string, unknown> | null = null;
      const all: FactPIIMatch[] = [];
      // R15 — `Object.entries` snapshots own enumerable [key, value]
      // pairs once, so the iteration itself is TOCTOU-safe (the array
      // returned by Object.entries doesn't re-read from the source on
      // subsequent index reads). The `entries` call itself can throw
      // when `value` is a `Proxy` whose `ownKeys` trap throws — the
      // outer `inspect()` try/catch catches it.
      let entries: Array<[string, unknown]>;
      try {
        entries = Object.entries(value as Record<string, unknown>);
      } catch {
        return { matched: false };
      }
      for (const [k, v] of entries) {
        if (typeof v === "string") {
          const detected = runScan(v);
          if (detected.length === 0) continue;
          if (mutated === null) {
            mutated = { ...(value as Record<string, unknown>) };
          }
          mutated[k] = redactText(v, detected);
          for (const d of detected) all.push(d);
        } else if (depth > 1 && v && typeof v === "object") {
          // Includes arrays — recurse and let the array branch above
          // handle the structural walk. Burns one depth level whether
          // the child is an array or another plain object so the
          // configured walkDepth bounds total recursion.
          const nested = inspect(v, depth - 1, inProgress);
          if (!nested.matched) continue;
          if (mutated === null) {
            mutated = { ...(value as Record<string, unknown>) };
          }
          mutated[k] = nested.redacted;
          for (const d of nested.detected) all.push(d);
        }
      }
      if (mutated === null) return { matched: false };
      return { matched: true, redacted: mutated, detected: all };
    }
    return { matched: false };
  }

  return {
    name: "fact-pii-guardrail",

    onInit(system) {
      initScreenedKeys(system);
    },

    onFactSet(key, value, _prev) {
      if (!initialized) return;
      if (!screenedKeys.has(key)) return;
      const result = inspect(value);
      if (!result.matched) return;
      onBlocked?.(key, result.detected, mode);
      if (mode === "alert") return;
      // Redact mode: schedule a follow-up store write. `onFactSet` fires
      // post-commit, so the raw value briefly exists in the store; the
      // follow-up write overwrites it before the next reconcile / agent
      // read. Subscribers that snapshot the raw value during the same
      // microtask see it; the LLM call after the next settle does not.
      const facts = (systemRef as unknown as MetaCapableSystem | null)?.facts;
      if (facts?.$store?.set) {
        try {
          facts.$store.set(key, result.redacted);
        } catch {
          // Store rejected (e.g. unknown key, mid-destroy). onBlocked
          // already fired so the consumer has the signal.
        }
      }
    },

    onFactsBatch(changes) {
      if (!initialized) return;
      for (const change of changes) {
        if (change.type !== "set") continue;
        if (!screenedKeys.has(change.key)) continue;
        const result = inspect(change.value);
        if (!result.matched) continue;
        onBlocked?.(change.key, result.detected, mode);
        if (mode === "alert") continue;
        // Best-effort in-place mutation of the change record so post-batch
        // subscribers reading `change.value` see the redacted value
        // immediately. Frozen change records fall through silently.
        try {
          (change as { value: unknown }).value = result.redacted;
        } catch {
          // Frozen change record — fall through.
        }
        // Follow-up store write so the next read of `system.facts.<key>`
        // returns the redacted value too. Required because the batch
        // already committed the raw value at this point.
        const facts = (systemRef as unknown as MetaCapableSystem | null)?.facts;
        if (facts?.$store?.set) {
          try {
            facts.$store.set(change.key, result.redacted);
          } catch {
            /* store may reject mid-destroy; onBlocked already fired */
          }
        }
      }
    },
  };
}
