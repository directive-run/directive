/**
 * Fact-PII Guardrail — input guardrail at the fact-store boundary
 *
 * Closes the source → fact → agent prompt PII bypass that
 * `createPIIGuardrail` alone can't reach: `createPIIGuardrail` only
 * inspects the `data.input` string at runStream entry, so PII that a
 * source publishes into a fact (a Supabase realtime row carrying a
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
 * ## Observability
 *
 * Every detection emits a typed `"guardrail.blocked"` `ObservationEvent`
 * via `system.observe()` (RFC 0010). Backend wiring (OTel exporters,
 * `@directive-run/timeline`, audit-ledger plugins) subscribes to the
 * event stream and gets:
 *
 * ```ts
 * {
 *   type: "guardrail.blocked",
 *   plugin: "fact-pii-guardrail",
 *   key: "<fact-key>",
 *   kind: "redact" | "alert" | "detect",
 *   count: <number-of-matches>,
 *   category: "ssn" | "credit_card" | "email" | <customDetector-type>
 * }
 * ```
 *
 * The user `onBlocked` callback fires INDEPENDENTLY for backwards
 * compatibility and ad-hoc paging (Sentry, Honeycomb). Prefer
 * `system.observe()` for new integrations — observers see every
 * registered guardrail's activity through the same typed stream.
 *
 * `kind: "detect"` distinguishes "couldn't redact" from "chose not
 * to redact": `Error` instances always surface as `"detect"` because
 * the walker matches `Error.message` / `Error.cause` but cannot mint
 * a redacted Error with guaranteed `.stack` parity. A subscriber
 * counting redactions should sum `kind === "redact" || kind === "detect"`.
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

/**
 * How to handle Error / AggregateError instances whose `.message`,
 * `.cause`, or `.errors` carry PII matches.
 *
 * - `"redact"` (default in `mode: "redact"`): replace the value in the
 *   store with a new `Error(redactedMessage)`. The redacted Error
 *   preserves its `.name` but loses the original class identity
 *   (subclasses become plain `Error`), `.stack`, `.cause`, and
 *   `AggregateError.errors`, because those cannot be redacted
 *   losslessly without re-invoking the original constructor.
 * - `"preserve"`: keep the original Error in the store. Only fire
 *   `onBlocked` + emit `guardrail.blocked` with kind `"detect"`. Use
 *   this for back-compat when downstream code relies on
 *   `instanceof YourErrorSubclass` or on `.stack` parity. The raw PII
 *   remains in store under this setting.
 * - `"alert-only"`: same as `"preserve"` but emit kind `"alert"` so
 *   observability flags the leak as urgent.
 */
export type FactPIIErrorMode = "redact" | "preserve" | "alert-only";

export interface FactPIIGuardrailOptions {
  /** Default: `"redact"` */
  mode?: FactPIIGuardrailMode;
  /**
   * Error / AggregateError handling. Defaults to `"redact"` when top-level
   * `mode` is `"redact"`, `"alert-only"` when `mode` is `"alert"`. See
   * {@link FactPIIErrorMode} for the per-option semantics.
   *
   * **Migration note:** prior to v1.21, the guardrail did NOT redact
   * Errors regardless of the top-level `mode`. Consumers depending on
   * the original Error class identity or `.stack` parity after a block
   * must opt out by setting `errorMode: "preserve"`.
   */
  errorMode?: FactPIIErrorMode;
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
   * value. Default `4` (raised from `2` to cover Supabase realtime row
   * shapes and MCP resource notification lists zero-config — those
   * payloads are `payload.new = [{ email }]` which is four levels:
   * object → array → object → string). At depth 4 the scanner
   * inspects top-level strings, recurses into nested objects / arrays,
   * and recurses three more levels. Each array level burns one depth
   * slot. Maps and Sets are still NOT walked by the built-in scanner;
   * PII inside those structures must go through a `customDetector`.
   *
   * Real-world common shapes and the `walkDepth` they need:
   * - **Flat object** (`{ email, ssn }`) — works at any `walkDepth >= 1`.
   * - **Nested object** (`{ profile: { email } }`) — needs `walkDepth >= 2`
   *   (covered by the default).
   * - **Error with cause** (`new Error(m, { cause: prev })`) — the cause
   *   chain is recursed at `depth - 1`, so `walkDepth >= 2` is needed
   *   to scan one cause level (covered by the default). Deeper cause
   *   chains (`cause.cause.cause`) need `walkDepth >= 3`.
   * - **AggregateError** with nested error PII — `walkDepth >= 2` for
   *   the first layer; deeper for nested aggregates.
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
   * - `walkDepth` clamps to `[1, 5]`. Non-finite values (`NaN`,
   *   `Infinity`, non-number casts) clamp to `1`.
   * - The walker caps any single array's element count at 10,000
   *   (warns + truncates). Pass a `customDetector` for larger
   *   payloads.
   * - Before walking, the value is passed through `structuredClone`
   *   to strip any Proxies, exotic getters, Symbol-iterator
   *   overrides, and functions the consumer might have attached.
   *   Cyclic inputs throw `DataCloneError` from `structuredClone`
   *   and the walker treats them as "no match" with a warning.
   *   Non-cloneable values (functions, DOM nodes, WeakMaps, etc.)
   *   throw the same way — wire a `customDetector` for those shapes.
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
    /** Added in core 1.28. Absent on older cores, which is handled below. */
    revision?: () => number;
  };
  facts?: {
    $store?: {
      set?: (k: string, v: unknown) => void;
    };
  };
  notify?: {
    guardrailBlocked?: (
      plugin: string,
      key: string,
      kind: "redact" | "alert" | "detect",
      count: number,
      category?: string,
    ) => void;
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
/** Returned when nothing scannable could be recovered from a value. */
const UNSALVAGEABLE = Symbol("unsalvageable");

/**
 * A plain copy of everything the structured cloner would not take.
 *
 * Reads every own enumerable property exactly once and keeps only values the
 * scanner can act on — strings, numbers, booleans, null, and plain
 * objects/arrays of the same. Functions, symbols, and exotic objects are
 * dropped rather than allowed to abort the scan of their siblings.
 *
 * Depth- and width-bounded on the way down, so a hostile payload cannot turn
 * the salvage path into the CPU sink the clone path is bounded against.
 * Cycles resolve to `UNSALVAGEABLE` for the offending branch rather than
 * looping.
 */
function salvageForScan(
  value: unknown,
  depth: number,
  seen: WeakSet<object> = new WeakSet(),
  maxWidth = 10_000,
): unknown {
  if (value === null) {
    return null;
  }

  const kind = typeof value;
  if (kind === "string" || kind === "number" || kind === "boolean") {
    return value;
  }

  if (kind !== "object" || depth <= 0) {
    return UNSALVAGEABLE;
  }

  const object = value as object;
  if (seen.has(object)) {
    return UNSALVAGEABLE;
  }
  seen.add(object);

  if (Array.isArray(value)) {
    const width = Math.min(value.length, maxWidth);
    const out: unknown[] = [];
    for (let i = 0; i < width; i++) {
      const salvaged = salvageForScan(value[i], depth - 1, seen, maxWidth);
      if (salvaged !== UNSALVAGEABLE) {
        out.push(salvaged);
      }
    }

    return out;
  }

  const out: Record<string, unknown> = Object.create(null);
  let kept = 0;
  for (const [key, member] of Object.entries(object)) {
    if (kept >= maxWidth) {
      break;
    }
    const salvaged = salvageForScan(member, depth - 1, seen, maxWidth);
    if (salvaged !== UNSALVAGEABLE) {
      out[key] = salvaged;
      kept += 1;
    }
  }

  return kept > 0 ? out : UNSALVAGEABLE;
}

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
    walkDepth = 4,
    // Default errorMode follows top-level `mode`: when the operator
    // configures `mode: "redact"`, Errors actually get redacted; when
    // `mode: "alert"`, Errors emit kind "alert" via the same path the
    // walker uses for non-Error matches.
    errorMode = mode === "redact" ? "redact" : "alert-only",
  } = options;

  const typeSet = new Set<FactPIICategory>(types);
  const screenedKeys = new Set<string>(includeKeys);
  const excludedSet = new Set(excludeKeys);
  // Clamp walkDepth to [1, 5]. Lower bound prevents accidental no-op
  // scans (`walkDepth: 0` would skip even top-level string members);
  // upper bound caps pathological recursion on cyclic structures.
  // `Number.isFinite` guards against NaN / Infinity / non-numeric
  // casts — `Math.floor(NaN) === NaN`, `Math.min/max(5, NaN) ===
  // NaN`, so the chain collapsed to NaN without the finite guard;
  // recursion then used `depth - 1 === NaN` and the bound never
  // triggered.
  const effectiveWalkDepth = Number.isFinite(walkDepth)
    ? Math.max(1, Math.min(5, Math.floor(walkDepth as number)))
    : 1;

  // Hard cap on per-array element count. After the structuredClone
  // pass the walker only ever sees plain arrays (any Proxy is
  // stripped), so the cap exists purely to bound CPU on legitimate
  // huge payloads (a 1M-element array shipped as one realtime row).
  // Anything past the cap is left as-is on the redacted output AND
  // reported via `console.warn` so consumers see the truncation
  // rather than a silent miss.
  const MAX_ARRAY_SCAN = 10_000;
  let initialized = false;
  let systemRef: System | null = null;
  // The meta revision the screened set was built against. `null` means it has
  // never been built, or was built against a core too old to report one.
  let screenedAtRevision: number | null = null;

  /**
   * Rebuild the screened set from the system's pii-tagged facts.
   *
   * Built once on init and never again, until this. A module registered after
   * the plugin started brings its own facts, and a pii tag on one of them was
   * simply never read — the write then took the same early return as an
   * untagged key, so the value reached the agent prompt unscreened and nothing
   * was reported, because a key missing from the set and a key that scanned
   * clean leave exactly the same trace.
   *
   * Cheap to keep current: the walk behind `byTag` is only paid when the
   * revision has actually moved.
   */
  function syncScreenedKeys(system: System): void {
    const meta = (system as unknown as MetaCapableSystem).meta;
    const revision = meta?.revision?.();

    if (
      initialized &&
      typeof revision === "number" &&
      revision === screenedAtRevision
    ) {
      return;
    }

    systemRef = system;

    // Built to the side, then swapped in — never edited in place.
    //
    // The first version of this cleared the live set and advanced the revision
    // marker before asking which keys to screen. One throw from that question,
    // and plugin callbacks swallow throws, left the screen holding nothing with
    // the marker already moved — so every later write took the early return
    // above and the screen never rebuilt. A transient fault became permanent,
    // silent exposure: strictly worse than the staleness it replaced, which at
    // least only missed modules registered later.
    //
    // Nothing below touches `screenedKeys` or `screenedAtRevision` until the
    // rebuild has finished, so a failure leaves the previous screen in place
    // with the marker unmoved, and the next write tries again.
    const rebuilt = new Set<string>();
    // `includeKeys` is caller-supplied and survives every rebuild.
    for (const key of includeKeys) {
      rebuilt.add(key);
    }

    let piiTagged: Array<{ type?: string; id?: string }> | undefined;
    try {
      piiTagged = meta?.byTag?.("pii");
    } catch (error) {
      // Keep screening with whatever is already in place, and say so. A screen
      // running on a stale key set is a different posture from one running on a
      // current set, and the two must not leave the same trace.
      console.warn(
        "[Directive] fact-pii: could not refresh the screened keys",
        {
          plugin: "fact-pii-guardrail",
          error,
        },
      );

      return;
    }

    // An answer that never arrived is not an answer of "nothing is tagged".
    //
    // `byTag` returning nothing while the method exists means the lookup did
    // not answer. Treating that as an empty tag set empties the screen and
    // advances the marker, which latches exactly as a throw did — the failure
    // this whole rebuild was restructured to prevent, surviving in the path
    // that does not throw. An empty *array* is different and is honoured: it
    // genuinely means nothing carries the tag.
    if (meta?.byTag && !piiTagged) {
      console.warn(
        "[Directive] fact-pii: the screened-key lookup returned nothing",
        {
          plugin: "fact-pii-guardrail",
        },
      );

      return;
    }

    if (piiTagged) {
      for (const entry of piiTagged) {
        // MetaMatch shape: { type: "fact" | "module" | "event" | ..., id: string, meta }.
        // We screen FACT-typed matches only — agent prompts read facts, not
        // event / constraint / derivation metadata.
        if (entry.type !== "fact") continue;
        if (entry.id && !excludedSet.has(entry.id)) {
          rebuilt.add(entry.id);
        }
      }
    }

    // Swap, then mark. Both only on the success path.
    screenedKeys.clear();
    for (const key of rebuilt) {
      screenedKeys.add(key);
    }
    initialized = true;
    screenedAtRevision = typeof revision === "number" ? revision : null;
  }

  /**
   * Build a redacted Error from an original Error whose message / cause /
   * errors contained PII matches. Returns a fresh `Error` instance whose
   * `.message` has every detected match substituted via `redactText`. The
   * original `.cause`, `.stack`, and `AggregateError.errors` are dropped
   * because they cannot be redacted without re-invoking the original
   * constructor (which we don't know how to do generically). The new
   * Error's `.name` is set to the original class's name so downstream
   * `name`-based dispatch (e.g. `if (err.name === "ValidationError")`)
   * still works.
   */
  function buildRedactedError(
    original: Error,
    detected: FactPIIMatch[],
  ): Error {
    // Collect every detected match string, redact a synthesized
    // composite message that includes whatever string surfaces the
    // walker found (message + cause-if-string + AggregateError.errors
    // string members). The composite is dominated by `original.message`
    // for most real-world payloads.
    const originalMessage =
      typeof original.message === "string" ? original.message : "";
    const redactedMessage = redactText(originalMessage, detected);
    const fresh = new Error(redactedMessage);
    // Preserve the original class name so consumers branching on
    // `err.name === "TypeError"` keep working after redaction.
    if (typeof original.name === "string" && original.name !== "Error") {
      Object.defineProperty(fresh, "name", {
        value: original.name,
        configurable: true,
        writable: true,
      });
    }
    return fresh;
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

  // Walker — sanitization-first design.
  //
  // Successive patches to a manual structural walker operated on the
  // consumer-supplied value directly. Each patch closed one class of
  // Proxy-based bypass and opened another:
  //
  //   - array-shaped payloads silently bypass (added array branch).
  //   - deeply nested arrays bypass the depth bound; Proxy whose
  //     `get` returns different values per read leaks PII via TOCTOU
  //     (added depth decrement + array snapshot).
  //   - Proxy whose `Symbol.iterator` yields a billion items
  //     OOMs the worker; Proxy whose iterator returns undefined
  //     crashes the walker; cycle guard via permanent WeakSet
  //     false-skips shared-leaf references (added size cap +
  //     try/catch islands + in-progress cycle tracking).
  //
  // The pattern of "patch round → new bypass surface" is the signal
  // that the walker needs to operate on a value that the consumer
  // CANNOT inject hostile behavior into. `structuredClone` is the
  // canonical primitive: the cloned value has no Proxies (they're
  // unwrapped to their underlying target shape), no exotic getters,
  // no functions (they throw at clone time), no Symbol-iterator
  // overrides, no cycles (clone throws on cyclic input). The walker
  // operates on the safe clone with a simple recursive descent — no
  // try/catch islands, no cycle tracking, no per-trap defense.
  //
  // Non-cloneable inputs (DOM nodes, class instances with method
  // refs, WeakMaps, Promises, etc.) throw `DataCloneError` at the
  // clone call; we catch, warn, and treat as "no match" — same
  // posture as the previous per-trap try/catches. The hard cap on
  // top-level array element count caps the clone cost, since
  // `structuredClone` of a 100k-element array is still O(N).
  function inspect(
    value: unknown,
    depth: number = effectiveWalkDepth,
  ):
    | { matched: false }
    | { matched: true; redacted: unknown; detected: FactPIIMatch[] } {
    if (typeof value === "string") {
      const detected = runScan(value);
      if (detected.length === 0) return { matched: false };
      return { matched: true, redacted: redactText(value, detected), detected };
    }
    if (depth <= 0) return { matched: false };
    if (value === null || typeof value !== "object") {
      return { matched: false };
    }

    // Pre-clone cap: a 1M-element array shipped as one realtime row
    // would otherwise burn CPU inside `structuredClone` BEFORE the
    // walker ever sees it. (regression of the prior-round array cap.) Follow-up:
    // the previous `.slice()` path re-read `value.length` on a Proxy,
    // which can lie (return 5 on the first read, 1e9 on the next) and
    // bypass the cap. Materialize via `Array.from` so each index is
    // read EXACTLY once and the resulting array's length is fixed by
    // the cap value — the Proxy's traps can no longer TOCTOU us.
    let cloneInput: unknown = value;
    if (Array.isArray(value)) {
      // Read length once; coerce to a finite number; clamp.
      const rawLen = (value as unknown[]).length;
      const len =
        Number.isFinite(rawLen) && rawLen > 0
          ? Math.min(Math.floor(rawLen as number), MAX_ARRAY_SCAN)
          : 0;
      if (rawLen > MAX_ARRAY_SCAN) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Directive] fact-pii walker truncated top-level array at ${MAX_ARRAY_SCAN} elements before clone — pass a customDetector for larger payloads`,
        );
      }
      // Materialize a plain Array of exactly `len` entries by reading
      // each index ONCE. structuredClone of this plain Array can't
      // re-trigger the Proxy's traps. Inner Proxies still get cloned
      // by structuredClone's own algorithm, but inner-array length
      // lying is bounded by the recursive walkClone array cap.
      const snapshot = new Array(len);
      for (let i = 0; i < len; i++) snapshot[i] = (value as unknown[])[i];
      cloneInput = snapshot;
    }

    // Sanitization step — strip Proxies, exotic getters, etc. before
    // walking. structuredClone has been native since Node 17 /
    // workerd / Bun / Deno / browsers ≥ 2022 — the entire runtime
    // matrix Directive supports.
    let safe: unknown;
    try {
      safe = structuredClone(cloneInput);
    } catch (err) {
      // Non-cloneable members: functions, DOM nodes, class instances carrying
      // methods, WeakMaps, getters that throw.
      //
      // This used to return "no match" — which the caller cannot tell apart
      // from "scanned and found nothing". A single function property beside a
      // social security number therefore committed the number raw, with no
      // event and no redaction, on a value the schema had tagged as personal.
      // The comment here claimed the opposite: that it bailed rather than
      // commit raw data silently. It committed, and it was silent.
      //
      // A member the cloner refuses says nothing about its siblings. So the
      // refused members are dropped and the rest is scanned. Each property is
      // read exactly once, which is the same guarantee the array snapshot
      // above exists to provide — a Proxy cannot answer differently the second
      // time because there is no second time.
      const salvaged = salvageForScan(value, depth);
      if (salvaged === UNSALVAGEABLE) {
        console.warn(
          "[Directive] fact-pii walker: value could not be scanned — leaving it as-is. Wire a customDetector for shapes containing cycles or exotic members.",
          err instanceof Error ? err.message : String(err),
        );

        return { matched: false };
      }

      return walkClone(salvaged, depth);
    }
    return walkClone(safe, depth);
  }

  // Walks a structured clone — guaranteed Proxy-free, cycle-free,
  // function-free. Simple recursive descent; no try/catch (the
  // input cannot throw on `Object.entries` / `[...arr]` because
  // structuredClone produces only plain objects + arrays + JSON
  // primitives + structured types like Date, Map, Set).
  function walkClone(
    value: unknown,
    depth: number,
  ):
    | { matched: false }
    | { matched: true; redacted: unknown; detected: FactPIIMatch[] } {
    if (typeof value === "string") {
      const detected = runScan(value);
      if (detected.length === 0) return { matched: false };
      return { matched: true, redacted: redactText(value, detected), detected };
    }
    if (depth <= 0) return { matched: false };
    if (Array.isArray(value)) {
      // Cap on element count — even on a structured clone, walking
      // 100k elements at 6 regex `.exec` per string element is real
      // CPU. Beyond the cap, elements are left as-is in the redacted
      // output and a warning is logged. Pass a `customDetector` for
      // larger payloads.
      if (value.length > MAX_ARRAY_SCAN) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Directive] fact-pii walker truncated array at ${MAX_ARRAY_SCAN} elements — pass a customDetector for larger payloads`,
        );
      }
      const limit = Math.min(value.length, MAX_ARRAY_SCAN);
      let mutatedArr: unknown[] | null = null;
      const all: FactPIIMatch[] = [];
      for (let i = 0; i < limit; i++) {
        const nested = walkClone(value[i], depth - 1);
        if (!nested.matched) continue;
        if (mutatedArr === null) mutatedArr = [...value];
        mutatedArr[i] = nested.redacted;
        for (const d of nested.detected) all.push(d);
      }
      if (mutatedArr === null) return { matched: false };
      return { matched: true, redacted: mutatedArr, detected: all };
    }
    if (value && typeof value === "object") {
      // structuredClone preserves a handful of "structured" types
      // (Map, Set, Date, RegExp, Blob, File, ArrayBuffer + views,
      // Error) as their native class. Walking them with
      // `Object.entries` would either yield nothing (the interesting
      // data is on the prototype / in internal slots) or
      // false-trigger PII matches inside Error.stack frames. We
      // exit early; consumers pass a `customDetector` to inspect
      // these structures.
      if (
        value instanceof Map ||
        value instanceof Set ||
        value instanceof Date ||
        value instanceof RegExp ||
        value instanceof Error ||
        ArrayBuffer.isView(value) ||
        value instanceof ArrayBuffer ||
        (typeof Blob !== "undefined" && value instanceof Blob)
      ) {
        // Error class: detection-only path. `Error.message` is a
        // user-controlled string a transport often surfaces, so
        // we scan it along with `.cause` and (for AggregateError)
        // `.errors`. PII can hide inside wrapped causes).
        // Errors are returned as-is in `redacted` (the instance ref is
        // the input); the caller MUST treat Error matches as alert-mode,
        // not redact-mode, because the same-ref return would otherwise
        // cause the redact follow-up write to be a no-op while the
        // `onBlocked` callback claimed redaction.
        if (value instanceof Error) {
          const detected: FactPIIMatch[] = [];
          if (typeof value.message === "string") {
            for (const d of runScan(value.message)) detected.push(d);
          }
          if (typeof value.cause === "string") {
            for (const d of runScan(value.cause)) detected.push(d);
          } else if (value.cause instanceof Error && depth > 1) {
            const sub = walkClone(value.cause, depth - 1);
            if (sub.matched) for (const d of sub.detected) detected.push(d);
          }
          if (
            typeof AggregateError !== "undefined" &&
            value instanceof AggregateError &&
            Array.isArray(value.errors) &&
            depth > 1
          ) {
            for (const inner of value.errors) {
              if (typeof inner === "string") {
                for (const d of runScan(inner)) detected.push(d);
              } else if (inner instanceof Error) {
                const sub = walkClone(inner, depth - 1);
                if (sub.matched) for (const d of sub.detected) detected.push(d);
              }
            }
          }
          if (detected.length > 0) {
            // Error redaction strategy is controlled by `errorMode`.
            //
            // - `"redact"` builds a NEW Error whose `.message` is the
            //   original message with PII matches substituted; the
            //   downstream onFactSet sees `redacted !== value` and
            //   schedules a follow-up `$store.set` that REPLACES the
            //   raw Error with the redacted one. This is the bug fix
            //   for "Error PII persists silently in `mode: redact`".
            // - `"preserve"` returns the input reference (same as the
            //   pre-v1.21 behavior). Downstream treats the same-ref
            //   return as "couldn't redact, only detect" — `kind`
            //   becomes `"detect"`, the follow-up write is skipped,
            //   raw Error stays in store.
            // - `"alert-only"` returns same-ref like `"preserve"`,
            //   but downstream maps `kind` to `"alert"` so observers
            //   can route it through the urgent-alert path.
            return {
              matched: true,
              redacted:
                errorMode === "redact"
                  ? buildRedactedError(value, detected)
                  : value,
              detected,
            };
          }
        }
        return { matched: false };
      }
      let mutated: Record<string, unknown> | null = null;
      const all: FactPIIMatch[] = [];
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === "string") {
          const detected = runScan(v);
          if (detected.length === 0) continue;
          if (mutated === null) {
            mutated = { ...(value as Record<string, unknown>) };
          }
          mutated[k] = redactText(v, detected);
          for (const d of detected) all.push(d);
        } else if (depth > 1 && v && typeof v === "object") {
          const nested = walkClone(v, depth - 1);
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
      syncScreenedKeys(system);
    },

    onFactSet(key, value, _prev) {
      if (!initialized) return;
      // Cheap: an integer compare unless a module has registered since the last
      // write. Without it the screened set is whatever the system happened to
      // hold at init, and a later module's tagged facts are indistinguishable
      // from untagged ones on the line below.
      if (systemRef) syncScreenedKeys(systemRef);
      if (!screenedKeys.has(key)) return;
      // Idempotent skip — primitives only. For object
      // references, `value === _prev` is true when a source mutates
      // a held reference in place and re-publishes; skipping there
      // would let mutated PII slip through. Re-scanning an object
      // is bounded by the walker's array + depth caps anyway.
      if (value === _prev && (typeof value !== "object" || value === null)) {
        return;
      }
      const result = inspect(value);
      if (!result.matched) return;
      onBlocked?.(key, result.detected, mode);
      // RFC 0010 — fan out to system.observe() / OTel / timeline /
      // audit-ledger subscribers.
      //
      // `kind` mapping:
      // - top-level `mode: "alert"` always emits `"alert"`
      // - else if `errorMode: "alert-only"` and the value is an Error
      //   (same-ref return from the walker), emit `"alert"` so observers
      //   route it through the urgent path
      // - else `redacted === value` means the walker chose not to
      //   redact (Error with `errorMode: "preserve"`) — emit `"detect"`
      // - else the walker built a redacted replacement — emit `"redact"`
      const blockedKind: "redact" | "alert" | "detect" =
        mode === "alert"
          ? "alert"
          : errorMode === "alert-only" && value instanceof Error
            ? "alert"
            : result.redacted === value
              ? "detect"
              : "redact";
      const sys = systemRef as unknown as MetaCapableSystem | null;
      sys?.notify?.guardrailBlocked?.(
        "fact-pii-guardrail",
        key,
        blockedKind,
        result.detected.length,
        result.detected[0]?.type,
      );
      if (mode === "alert") return;
      // Skip the follow-up store write when the walker returned the
      // input reference (Error with `errorMode: "preserve"` or
      // `"alert-only"`). The follow-up would be a no-op AND would trip
      // the primitives-only idempotency gate on re-entry.
      if (result.redacted === value) return;
      // `onFactSet` fires post-commit, so the raw value briefly exists
      // in the store; the follow-up write overwrites it before the next
      // reconcile / agent read. Subscribers that snapshot the raw value
      // during the same microtask see it; the LLM call after the next
      // settle does not.
      const facts = (systemRef as unknown as MetaCapableSystem | null)?.facts;
      if (facts?.$store?.set) {
        try {
          facts.$store.set(key, result.redacted);
        } catch (error) {
          // Store rejected (e.g. unknown key, mid-destroy). `onBlocked`
          // already fired so the consumer knows redaction WAS detected,
          // but the follow-up write didn't land — the raw value remains
          // in store. Log structured so log scrapers can flag a guardrail
          // that thinks it succeeded but didn't.
          console.warn("[Directive] guardrail redact write failed", {
            plugin: "fact-pii-guardrail",
            key,
            phase: "onFactSet",
            error,
          });
        }
      }
    },

    onFactsBatch(changes) {
      if (!initialized) return;
      if (systemRef) syncScreenedKeys(systemRef);
      for (const change of changes) {
        if (change.type !== "set") continue;
        if (!screenedKeys.has(change.key)) continue;
        // Primitives-only idempotency gate ; see onFactSet.
        const prev = (change as { prev?: unknown }).prev;
        if (
          change.value === prev &&
          (typeof change.value !== "object" || change.value === null)
        ) {
          continue;
        }
        const result = inspect(change.value);
        if (!result.matched) continue;
        onBlocked?.(change.key, result.detected, mode);
        // RFC 0010 fan-out (mirrors onFactSet — see kind-mapping comment
        // there for the full table).
        const blockedKind: "redact" | "alert" | "detect" =
          mode === "alert"
            ? "alert"
            : errorMode === "alert-only" && change.value instanceof Error
              ? "alert"
              : result.redacted === change.value
                ? "detect"
                : "redact";
        const sysB = systemRef as unknown as MetaCapableSystem | null;
        sysB?.notify?.guardrailBlocked?.(
          "fact-pii-guardrail",
          change.key,
          blockedKind,
          result.detected.length,
          result.detected[0]?.type,
        );
        if (mode === "alert") continue;
        // Skip same-ref redacted return — Error path.
        if (result.redacted === change.value) continue;
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
          } catch (error) {
            // Same posture as `onFactSet` redact-write failure: detected
            // and onBlocked fired, follow-up write didn't land. Log so a
            // misbehaving store (mid-destroy, unknown key) is visible to
            // log scrapers rather than silently leaving raw PII in place.
            console.warn("[Directive] guardrail redact write failed", {
              plugin: "fact-pii-guardrail",
              key: change.key,
              phase: "onFactsBatch",
              error,
            });
          }
        }
      }
    },
  };
}
