/**
 * createAuditLedger — append-only, queryable, hash-chained
 * (djb2; SHA-256 reserved for v2) audit of every state change. For
 * forensics and "show me why this user got that decision."
 *
 * Captures (per observation event):
 *
 *   - `constraint.evaluate` → { whenSpec, whenExplain, active, whenSource? }
 *   - `resolver.write.rejected` (rejection + summary kinds)
 *   - `fact.change` → { key, prior, next }
 *   - `resolver.complete` → { resolverId, requirementId, duration }
 *   - `system.init` / `system.start` / `system.stop` / `system.destroy`
 *   - `system.snapshot` / `system.history.navigate` (lifecycle markers)
 *   - `system.truncated` (ring-buffer overflow marker)
 *   - `system.entry-erased` / `system.subject-erased` (GDPR Art.17 stub)
 *
 * Hash chain: each entry stores `prevHash` — the djb2 (`hashObject`)
 * hash of the previous entry's stable-stringified payload. Tampering
 * with any entry's payload breaks the next entry's `prevHash` link —
 * visible in `verify()`. v1 ships sync djb2 only; `verify({ strong: true })`
 * is reserved for v2 (SHA-256) and throws today.
 *
 * PII redaction: by default, fact keys whose meta carries the `pii`
 * tag (via `system.meta.byTag("pii")`) have their values replaced with
 * `"[redacted]"` in `whenExplain.actual`, `fact.change.prior`,
 * `fact.change.next`, and the cached `whenSpec` operands. Opt out with
 * `capturePII: true`.
 */

import type { ClauseResult, FactPredicate } from "../core/types/predicate.js";
import type {
  ModuleSchema,
  ObservationEvent,
  Plugin,
  System,
} from "../core/types.js";
import { walkPredicate } from "../core/predicate.js";
import { hashObject } from "../utils/utils.js";

/** Hash algorithm tag — bumped if canonicalization or hash function changes. */
const HASH_ALGO = "djb2-1" as const;

/**
 * Navigate `root` to `dottedPath` (`foo.bar.$eq`, `foo[0].value`) and
 * replace the value at the leaf. Used by `redactWhenSpec` to scrub
 * PII operands in cached predicate specs. Best-effort: silently no-ops
 * if the path doesn't resolve (caller already cloned the spec).
 */
function replaceAtPath(root: unknown, dottedPath: string, value: unknown): void {
  if (root === null || typeof root !== "object") return;
  // Split on "." but treat "[N]" segments as array indices.
  // E.g. "[0].value" → ["[0]", "value"], "foo.bar[1]" → ["foo", "bar[1]"].
  const segs: Array<string | number> = [];
  for (const part of dottedPath.split(".")) {
    if (!part) continue;
    // Pull leading `[N]` if present.
    const m = part.match(/^\[(\d+)\](.*)$/);
    if (m) {
      segs.push(Number(m[1]));
      if (m[2]) segs.push(m[2].replace(/^\./, ""));
      continue;
    }
    // Trailing `[N]` on the segment.
    const m2 = part.match(/^([^[]+)\[(\d+)\](.*)$/);
    if (m2) {
      segs.push(m2[1]!);
      segs.push(Number(m2[2]));
      if (m2[3]) segs.push(m2[3].replace(/^\./, ""));
      continue;
    }
    segs.push(part);
  }

  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    if (cur === null || typeof cur !== "object") return;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  if (cur === null || typeof cur !== "object") return;
  const lastSeg = segs[segs.length - 1];
  if (lastSeg === undefined) return;
  (cur as Record<string | number, unknown>)[lastSeg] = value;
}

/**
 * Depth-2 freeze: freeze the entry, freeze each top-level value, and
 * freeze each clause in `whenExplain`. Cycle-safe + cheap; prevents
 * in-process payload mutation that would forge the chain. (C3)
 */
function freezeEntry(entry: AuditEntry): AuditEntry {
  for (const key of Object.keys(entry)) {
    const v = (entry as unknown as Record<string, unknown>)[key];
    if (v !== null && typeof v === "object") {
      if (Array.isArray(v) && key === "whenExplain") {
        for (const clause of v) {
          if (clause !== null && typeof clause === "object") {
            Object.freeze(clause);
          }
        }
      }
      Object.freeze(v);
    }
  }
  Object.freeze(entry);

  return entry;
}

// ============================================================================
// AuditEntry types
// ============================================================================

export type AuditEntryKind =
  | "constraint.evaluate"
  | "resolver.write.rejected"
  | "fact.change"
  | "resolver.complete"
  | "resolver.error"
  | "system.init"
  | "system.start"
  | "system.stop"
  | "system.destroy"
  | "system.snapshot"
  | "system.history.navigate"
  | "system.truncated"
  | "system.entry-erased"
  | "system.subject-erased";

interface AuditEntryBase {
  /** Monotonic sequence number, starting at 0. */
  readonly seq: number;
  /** Wall-clock timestamp (ms epoch). */
  readonly ts: number;
  /** Discriminator. */
  readonly kind: AuditEntryKind;
  /** Hash of the previous entry's full payload. null on the genesis entry. */
  readonly prevHash: string | null;
  /**
   * Hash algorithm tag identifying the canonicalization + hash
   * function in use. Bumped if the algorithm or canonical form
   * changes, so exports remain verifiable across versions.
   */
  readonly hashAlgo: typeof HASH_ALGO;
}

export type AuditEntry =
  | (AuditEntryBase & {
      kind: "constraint.evaluate";
      constraintId: string;
      active: boolean;
      /** Cached at ledger start from `system.inspect().constraints[].whenSpec`. Refreshed on `register()`/`assign()`/`unregister()`. May be undefined for function-form constraints (see `whenSource`). PII operands redacted unless `capturePII: true`. */
      whenSpec?: FactPredicate<unknown>;
      whenExplain?: readonly ClauseResult[];
      /**
       * For function-form constraints (no `whenSpec`), a tamper-evident
       * identity for the function. We DO NOT capture the raw source —
       * closures routinely reference secrets, API keys, or PII (e.g.
       * `if (apiKey === "sk-live-xxx")`) and a preview would leak them
       * into the audit log. Instead, we capture a djb2 hash of the
       * stringified function (`hashObject(String(fn))`). Auditors can
       * detect "the function changed between deploys" by comparing
       * hashes across entries, without ever seeing the function body.
       *
       * Informational only — NOT replayable. (N5, M22)
       */
      whenSource?: { kind: "function"; sourceHash: string };
    })
  | (AuditEntryBase & {
      kind: "resolver.write.rejected";
      rejection: "rejection" | "summary";
      resolverId: string;
      requirementId: string;
      reason: string;
      fact?: string;
      expected?: unknown;
      actual?: unknown;
      dropped?: number;
    })
  | (AuditEntryBase & {
      kind: "fact.change";
      key: string;
      prior: unknown;
      next: unknown;
    })
  | (AuditEntryBase & {
      kind: "resolver.complete";
      resolverId: string;
      requirementId: string;
      duration: number;
    })
  | (AuditEntryBase & {
      kind: "resolver.error";
      resolverId: string;
      requirementId: string;
      error: string;
    })
  | (AuditEntryBase & {
      kind: "system.init" | "system.start" | "system.stop" | "system.destroy";
    })
  | (AuditEntryBase & {
      kind: "system.snapshot";
      snapshotId: number;
      trigger: string;
    })
  | (AuditEntryBase & {
      kind: "system.history.navigate";
      from: number;
      to: number;
    })
  | (AuditEntryBase & {
      kind: "system.truncated";
      droppedSeq: number;
      droppedCount: number;
    })
  | (AuditEntryBase & {
      kind: "system.entry-erased";
      originalKind: AuditEntryKind;
      erasedAt: number;
    })
  | (AuditEntryBase & {
      kind: "system.subject-erased";
      /**
       * djb2 hash of the filter (via `hashObject(filter)`). PII-safe —
       * the raw filter values never land in the ledger. Pair with
       * `filterShape` to see which filter fields were used. (N2)
       */
      filterHash: string;
      /**
       * Stripped-values shape of the filter — captures WHICH fields were
       * present without recording their values. (N2)
       */
      filterShape: {
        factPath: boolean;
        constraintId: boolean;
        kind: AuditEntryKind | readonly AuditEntryKind[] | undefined;
        changedBetween: "[range]" | undefined;
      };
      erased: number;
    });

// ============================================================================
// Sink interface
// ============================================================================

export interface QueryFilter {
  /** Exact-match fact path. */
  factPath?: string;
  /** Filter by constraint id. */
  constraintId?: string;
  /** Filter by entry kind. */
  kind?: AuditEntryKind | readonly AuditEntryKind[];
  /** Time range as `[startMs, endMs]`, ISO strings, or epoch numbers. */
  changedBetween?: [string | number | Date, string | number | Date];
  /** Maximum entries returned. Default 1000. */
  limit?: number;
}

/**
 * Verify result — chain valid OR a break with full context for tamper visualization.
 *
 * Erased entries (via `ledger.erase()`) appear as legitimate chain breaks —
 * `verify()` reports them in `erasedAt` and continues the walk from the
 * tombstone's own hash. Real tamper still surfaces as `valid: false`.
 */
export type VerifyResult =
  | {
      valid: true;
      entryCount: number;
      /**
       * Sequence numbers of entries that were legitimately broken by
       * `erase()` tombstones. Empty unless the chain contains erasures.
       * (N1 + M1)
       */
      erasedAt?: number[];
    }
  | {
      valid: false;
      brokenAt: number;
      expectedHash: string;
      actualHash: string;
      entry: AuditEntry;
    };

export interface AuditLedgerSink {
  write(entry: AuditEntry): void;
  query(filter: QueryFilter): readonly AuditEntry[];
  recent(n: number): readonly AuditEntry[];
  forFact(path: string, opts?: { limit?: number }): readonly AuditEntry[];
  forConstraint(id: string, opts?: { limit?: number }): readonly AuditEntry[];
  toJSON(): { entries: readonly AuditEntry[]; capturedAt: number };
  clear(): void;
  destroy(): void;
  /**
   * Replace matching entries with tombstones IN PLACE (preserving seq +
   * prevHash so the hash chain still verifies). v1 implementation
   * matches on the same `QueryFilter` shape used by `query()`.
   * Returns the count of entries replaced.
   *
   * WARNING: erases only from this sink. Any external copies (toJSON
   * exports, downstream pipelines) must be erased separately.
   */
  erase?(filter: QueryFilter, tombstoneFactory: (e: AuditEntry) => AuditEntry): number;
  /**
   * Optional hook fired by the sink BEFORE shifting the oldest entry
   * out of a bounded ring buffer. The ledger plugin uses this to emit
   * a `system.truncated` marker so an auditor sees that the log was
   * truncated and where. (M23)
   */
  onTruncate?(handler: (droppedSeq: number, droppedCount: number) => void): void;
}

// ============================================================================
// memorySink — bounded ring buffer
// ============================================================================

const DEFAULT_MEMORY_CAPACITY = 10_000;
const DEFAULT_QUERY_LIMIT = 1000;

function parseRangeBound(v: string | number | Date): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) {
      throw new Error(
        `[Directive] audit-ledger: changedBetween bound must be a finite number, ISO string, or Date.`,
      );
    }

    return v;
  }
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isFinite(t)) {
      throw new Error(
        `[Directive] audit-ledger: changedBetween bound "${v}" is not a parseable ISO date string.`,
      );
    }

    return t;
  }
  throw new Error(
    `[Directive] audit-ledger: changedBetween bound must be a number, ISO string, or Date.`,
  );
}

function matchesFilter(entry: AuditEntry, filter: QueryFilter): boolean {
  if (filter.kind) {
    const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind];
    if (!kinds.includes(entry.kind)) return false;
  }
  if (filter.factPath !== undefined) {
    // Exact match — no LIKE wildcards. (SEC M2)
    if (entry.kind === "fact.change") {
      if (entry.key !== filter.factPath) return false;
    } else if (entry.kind === "resolver.write.rejected") {
      if (entry.fact !== filter.factPath) return false;
    } else {
      return false;
    }
  }
  if (filter.constraintId !== undefined) {
    if (entry.kind !== "constraint.evaluate") return false;
    if (entry.constraintId !== filter.constraintId) return false;
  }
  if (filter.changedBetween) {
    const [a, b] = filter.changedBetween;
    const start = parseRangeBound(a);
    const end = parseRangeBound(b);
    if (entry.ts < start || entry.ts > end) return false;
  }

  return true;
}

/**
 * In-memory bounded ring-buffer sink. Drops oldest entries past
 * `capacity` (default 10,000). Use this as the default sink for dev,
 * tests, and StackBlitz demos.
 */
export function memorySink(
  opts: { capacity?: number } = {},
): AuditLedgerSink {
  const capacity = opts.capacity ?? DEFAULT_MEMORY_CAPACITY;
  let entries: AuditEntry[] = [];
  let truncateHandler:
    | ((droppedSeq: number, droppedCount: number) => void)
    | null = null;

  const sink: AuditLedgerSink = {
    write(entry) {
      if (entries.length >= capacity) {
        // (M23) About to overflow — notify the owner BEFORE the shift
        // so the dropped seq is still known. The handler may push an
        // entry of its own (a truncation marker), which will itself
        // push us over capacity; we shift one for one until we're back
        // at capacity (handlers must be O(1) writers — typically one).
        const dropped = entries[0]!;
        truncateHandler?.(dropped.seq, 1);
        entries.shift();
      }
      entries.push(entry);
      // If the handler wrote a marker (entries.length now > capacity),
      // drop one more from the head to keep us at capacity exactly.
      while (entries.length > capacity) {
        entries.shift();
      }
    },
    query(filter) {
      const limit = filter.limit ?? DEFAULT_QUERY_LIMIT;
      const out: AuditEntry[] = [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!;
        if (matchesFilter(e, filter)) {
          out.push(e);
          if (out.length >= limit) break;
        }
      }

      return out;
    },
    recent(n) {
      const start = Math.max(0, entries.length - n);

      return entries.slice(start);
    },
    forFact(path, opts2 = {}) {
      return this.query({ factPath: path, limit: opts2.limit });
    },
    forConstraint(id, opts2 = {}) {
      return this.query({ constraintId: id, limit: opts2.limit });
    },
    toJSON() {
      return { entries: entries.slice(), capturedAt: Date.now() };
    },
    clear() {
      entries = [];
    },
    destroy() {
      entries = [];
      truncateHandler = null;
    },
    erase(filter, tombstoneFactory) {
      let count = 0;
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        if (matchesFilter(e, filter)) {
          entries[i] = tombstoneFactory(e);
          count++;
        }
      }

      return count;
    },
    onTruncate(handler) {
      truncateHandler = handler;
    },
  };

  return sink;
}

// ============================================================================
// Hash chain — canonicalization
// ============================================================================
//
// `syncHash(entry)` calls `hashObject(entry)` which calls
// `stableStringify(entry)` — every entry shape (seq, ts, kind, prevHash,
// hashAlgo, ...payload) is canonicalized via key-sorted JSON, then
// djb2-hashed to a 32-bit hex string.
//
//   - Fast, sync, isomorphic Node/Bun/Deno/browser.
//   - Tamper-DETECTION against accidental + light adversarial probing.
//   - Collision-prone against a determined attacker, by design (32 bits).
//
// Any future change to the canonicalization or hash function breaks
// existing exports, so each entry carries `hashAlgo: "djb2-1"`. Verifiers
// must check that tag matches what they expect.
//
// `verify({ strong: true })` is reserved for v2 (SHA-256 chain via Web
// Crypto). It throws today — there is no silent fallback. v1 ships sync
// djb2 only.

function syncHash(entry: AuditEntry): string {
  // stableStringify guarantees same hash across runtimes regardless of
  // key insertion order (architecture review #11, security review C1).
  return hashObject(entry);
}

/**
 * Dispatch to the right hash function based on the entry's `hashAlgo`
 * discriminator. v1 has a single arm (`djb2-1`); the switch is in
 * place so v2 can add `"sha256-1"` without touching call sites. (N5)
 *
 * v2 promise: when SHA-256 lands, this becomes `case "sha256-1": return
 * await asyncSha256(entry);` — verify() will become async accordingly.
 */
function hashForEntry(entry: AuditEntry): string {
  switch (entry.hashAlgo) {
    case "djb2-1":
      return syncHash(entry);
    default:
      throw new Error(
        `[Directive] audit-ledger: unknown hashAlgo "${String((entry as { hashAlgo: unknown }).hashAlgo)}" on entry seq=${entry.seq}. Cannot verify chain integrity. Known algorithms: "djb2-1".`,
      );
  }
}

// ============================================================================
// AuditLedger plugin
// ============================================================================

export interface AuditLedgerOptions {
  /** Sink to write entries to. Default: in-memory ring buffer (capacity 10k). */
  sink?: AuditLedgerSink;
  /**
   * Whether to capture raw fact values (`prior`/`next` on fact.change,
   * `actual` in whenExplain). Default `false` — PII-tagged facts are
   * redacted by default. Set `true` to opt out of redaction.
   */
  capturePII?: boolean;
  /**
   * Optional caller-supplied redactor. Runs AFTER the default
   * pii-tag-based redaction. Useful for additional sanitization.
   */
  redact?: (entry: AuditEntry) => AuditEntry;
}

export interface AuditLedger {
  /** The plugin to pass to `createSystem({ plugins: [...] })`. */
  readonly plugin: Plugin<ModuleSchema>;
  /** Query entries matching the filter. */
  query(filter?: QueryFilter): readonly AuditEntry[];
  /** Most recent N entries (chronological). */
  recent(n: number): readonly AuditEntry[];
  /** All entries that touch this fact path (exact match). */
  forFact(path: string, opts?: { limit?: number }): readonly AuditEntry[];
  /** All entries for this constraint id. */
  forConstraint(id: string, opts?: { limit?: number }): readonly AuditEntry[];
  /** Full ledger snapshot for export / serialization. */
  toJSON(): { entries: readonly AuditEntry[]; capturedAt: number };
  /**
   * Walk the hash chain genesis → tip. Returns `{ valid: true }` iff
   * every entry's `prevHash` matches the (sync, djb2-based) hash of
   * the previous entry. On break, returns the index of the first
   * broken link plus the expected vs actual hashes — feed into a
   * "TAMPERED" visualization.
   *
   * Erased entries (via `ledger.erase()`) appear as legitimate chain
   * breaks — `verify()` reports them in `erasedAt` and continues the
   * walk from the tombstone's actual hash. Real tamper still surfaces
   * as `valid: false`. (N1 + M1)
   *
   * v1 ships sync djb2 only. `verify({ strong: true })` is reserved
   * for v2 (SHA-256) and THROWS today — there is no silent fallback.
   * Call `verify()` (no args) for tamper detection.
   */
  verify(opts?: { strong?: boolean }): VerifyResult;
  /**
   * Per-subject erasure (GDPR Art. 17 stub). Replaces matching entries
   * in this sink with `system.entry-erased` tombstones (preserving
   * seq + prevHash so verify() can resync), then appends a chained
   * `system.subject-erased` marker entry that summarises the erasure.
   *
   * Returns `{ erased, markerEntry }` — `markerEntry` is the chained
   * `system.subject-erased` summary (the N per-entry tombstones live
   * in the sink, not on the return value). (M7)
   *
   * WARNING: v1 erases only from THIS sink. External copies (toJSON
   * exports, downstream pipelines, persisted backups) must be erased
   * separately. (C8)
   */
  erase(filter: QueryFilter): { erased: number; markerEntry: AuditEntry };
  /** Empty the sink. */
  clear(): void;
  /** Unsubscribe + drop the sink. */
  destroy(): void;
}

/**
 * Create an audit ledger that subscribes to the given system's
 * observation stream. Returns a `Plugin` to install + a query/verify
 * API for the ledger.
 *
 * @example
 * ```ts
 * import { createAuditLedger } from "@directive-run/core/plugins";
 *
 * const ledger = createAuditLedger();
 * const system = createSystem({ module, plugins: [ledger.plugin] });
 * system.start();
 *
 * // Six months later — auditor asks "what changed cart-total in March?"
 * ledger.query({
 *   factPath: "cartTotal",
 *   changedBetween: ["2026-03-01", "2026-04-01"],
 * });
 *
 * // Verify nobody tampered with the ledger
 * const verdict = await ledger.verify();
 * if (!verdict.valid) {
 *   console.error("Tamper at entry", verdict.brokenAt);
 * }
 * ```
 */
export function createAuditLedger(
  opts: AuditLedgerOptions = {},
): AuditLedger {
  const sink = opts.sink ?? memorySink();
  const capturePII = opts.capturePII ?? false;
  const userRedact = opts.redact;

  let seq = 0;
  let lastHashCache: string | null = null; // Cache hash of last-written entry payload

  let system: System<ModuleSchema> | null = null;
  let unobserve: (() => void) | null = null;

  /**
   * Cache of constraint.id → whenSpec (snapshotted at start, refreshed
   * on register/assign/unregister). Spec is already PII-redacted at
   * cache time, so the operand pointer that flows into every
   * `constraint.evaluate` entry can never leak. (C2)
   */
  const whenSpecCache = new Map<string, FactPredicate<unknown>>();

  /**
   * Cache of constraint.id → sourceHash for function-form constraints.
   * (N5, M22)
   *
   * We hash the stringified function rather than store any preview of
   * its source. Closures frequently reference secrets in scope
   * (`apiKey`, `dbPassword`, customer PII pulled from outer state) and
   * a preview would land those in the audit trail in plaintext. The
   * hash is a tamper-evident identity — auditors can verify "this
   * constraint's source has not changed across these entries" without
   * ever seeing the source itself.
   */
  const whenSourceCache = new Map<string, string>();

  /** Cache of PII-tagged fact paths. */
  const piiTaggedFacts = new Set<string>();

  /**
   * Walk a predicate spec and replace operands at PII-tagged fact paths
   * with `"[redacted]"`. Cached operand pointers (e.g. `{ email: { $eq:
   * "alice@x.com" } }`) flow into every `constraint.evaluate` entry —
   * without this scrub the email would land in the audit trail in
   * plaintext on every evaluation. (C2)
   */
  function redactWhenSpec(spec: unknown): unknown {
    if (capturePII || piiTaggedFacts.size === 0) return spec;
    if (spec === null || typeof spec !== "object") return spec;

    // Deep-clone so we don't mutate the user's source predicate. JSON
    // round-trip handles plain objects + arrays cheaply; predicates are
    // already JSON-safe (validatePredicate enforces this).
    let cloned: unknown;
    try {
      cloned = JSON.parse(JSON.stringify(spec));
    } catch {
      // Spec contained something non-serializable; bail rather than crash.
      return spec;
    }

    walkPredicate(cloned, {
      operator(factPath, op, _operand, operandPath) {
        if (!piiTaggedFacts.has(factPath)) return;
        // Navigate cloned tree to operandPath and replace value.
        replaceAtPath(cloned, operandPath, "[redacted]");
        void op;
      },
      literal(factPath) {
        if (!piiTaggedFacts.has(factPath)) return;
        // Replace bare-value leaf at this factPath.
        replaceAtPath(cloned, factPath, "[redacted]");
      },
    });

    return cloned;
  }

  function refreshWhenSpecCache(): void {
    whenSpecCache.clear();
    whenSourceCache.clear();
    if (!system) return;
    try {
      const inspect = (
        system as {
          inspect?: () => {
            constraints?: Array<{
              id: string;
              whenSpec?: unknown;
              when?: unknown;
            }>;
          };
        }
      ).inspect;
      if (typeof inspect !== "function") return;
      const inspection = inspect();
      const constraints = inspection?.constraints ?? [];
      // Best-effort access to merged constraint defs for function-form
      // source capture. Not exposed via the public type; we feature-detect.
      const mergedDefs = (
        system as {
          $internal?: {
            mergedConstraints?: Record<string, { when?: unknown }>;
          };
        }
      ).$internal?.mergedConstraints;
      for (const c of constraints) {
        if (c.whenSpec !== undefined) {
          // Redact PII operands at cache time so the cached pointer
          // flowing into evaluate entries is already safe. (C2)
          whenSpecCache.set(
            c.id,
            redactWhenSpec(c.whenSpec) as FactPredicate<unknown>,
          );
        } else {
          // No whenSpec means function-form `when:` (or no when at
          // all). Capture a HASH of the function source rather than
          // the source itself — closures may reference secrets in
          // scope, and any preview would leak them into the audit
          // trail. (N5, M22)
          const def = mergedDefs?.[c.id];
          const whenFn = def && typeof def.when === "function" ? def.when : undefined;
          if (whenFn) {
            whenSourceCache.set(c.id, hashObject(String(whenFn)));
          } else if (c.when !== undefined && typeof c.when === "function") {
            whenSourceCache.set(c.id, hashObject(String(c.when)));
          } else {
            // Function-form constraint we couldn't reach the source
            // of. Mark it so audit entries still surface the form.
            // We hash the marker string for consistency with the
            // sourceHash field shape.
            whenSourceCache.set(c.id, hashObject("[function]"));
          }
        }
      }
    } catch {
      // System not yet ready — skip silently.
    }
  }

  function refreshPIITags(): void {
    piiTaggedFacts.clear();
    if (capturePII || !system) return;
    try {
      const meta = (system as { meta?: { byTag?: (tag: string) => Array<{ id: string }> } }).meta;
      if (!meta || typeof meta.byTag !== "function") return;
      const tagged = meta.byTag("pii") ?? [];
      for (const m of tagged) {
        piiTaggedFacts.add(m.id);
      }
    } catch {
      // No meta accessor — skip.
    }
  }

  function redactValue(factPath: string, value: unknown): unknown {
    if (capturePII) return value;
    if (piiTaggedFacts.has(factPath)) return "[redacted]";

    return value;
  }

  function redactClauses(
    clauses: ClauseResult[] | undefined,
  ): ClauseResult[] | undefined {
    if (!clauses) return clauses;
    if (capturePII || piiTaggedFacts.size === 0) return clauses;
    let mutated = false;
    const out: ClauseResult[] = clauses.map((c) => {
      if (piiTaggedFacts.has(c.path)) {
        mutated = true;
        return { ...c, actual: "[redacted]" };
      }
      // Recurse into combinator children.
      if (c.children) {
        const inner = redactClauses(c.children);
        if (inner !== c.children) {
          mutated = true;
          return { ...c, children: inner };
        }
      }

      return c;
    });

    return mutated ? out : clauses;
  }

  /**
   * `partial` is the entry-specific payload (no seq/ts/prevHash). It's
   * typed as `Record<string, unknown>` because TS's distributed Omit
   * over the AuditEntry discriminated union doesn't compose cleanly;
   * runtime construction is safe because each call site passes a
   * known-shape literal.
   *
   * Entries are deeply-frozen at write time (depth 2 — top-level
   * values + whenExplain clauses) so that downstream consumers cannot
   * mutate payloads in place and forge the chain. (C3)
   */
  function emit(partial: Record<string, unknown>): AuditEntry {
    const entry = {
      ...partial,
      seq: seq++,
      ts: Date.now(),
      prevHash: lastHashCache,
      hashAlgo: HASH_ALGO,
    } as AuditEntry;

    const finalEntry = userRedact ? userRedact(entry) : entry;
    freezeEntry(finalEntry);
    sink.write(finalEntry);

    // Sync hash of this entry — stashed as the next entry's prevHash.
    // Whole entry is hashed (including its own prevHash field) so
    // verify() can rebuild the chain deterministically.
    lastHashCache = hashForEntry(finalEntry);

    return finalEntry;
  }

  function onEvent(event: ObservationEvent): void {
    switch (event.type) {
      case "constraint.evaluate": {
        const whenSpec = whenSpecCache.get(event.id);
        const whenSourceHash = whenSourceCache.get(event.id);
        const partial: Record<string, unknown> = {
          kind: "constraint.evaluate",
          constraintId: event.id,
          active: event.active,
          whenExplain: redactClauses(event.whenExplain),
        };
        if (whenSpec !== undefined) {
          partial.whenSpec = whenSpec;
        } else if (whenSourceHash !== undefined) {
          // Function-form constraint — sourceHash is informational and
          // NOT replayable. We deliberately do NOT include any source
          // preview because closures may reference secrets in scope. (N5, M22)
          partial.whenSource = {
            kind: "function",
            sourceHash: whenSourceHash,
          };
        }
        emit(partial);
        break;
      }
      case "fact.change":
        emit({
          kind: "fact.change",
          key: event.key,
          prior: redactValue(event.key, event.prev),
          next: redactValue(event.key, event.next),
        });
        break;
      case "resolver.write.rejected":
        if (event.kind === "summary") {
          emit({
            kind: "resolver.write.rejected",
            rejection: "summary",
            resolverId: event.resolver,
            requirementId: event.requirementId,
            reason: event.reason,
            dropped: event.dropped,
          });
        } else {
          emit({
            kind: "resolver.write.rejected",
            rejection: "rejection",
            resolverId: event.resolver,
            requirementId: event.requirementId,
            reason: event.reason,
            fact: event.fact,
            expected: redactValue(event.fact, event.expected),
            actual: redactValue(event.fact, event.actual),
          });
        }
        break;
      case "resolver.complete":
        emit({
          kind: "resolver.complete",
          resolverId: event.resolver,
          requirementId: event.requirementId,
          duration: event.duration,
        });
        break;
      case "resolver.error":
        emit({
          kind: "resolver.error",
          resolverId: event.resolver,
          requirementId: event.requirementId,
          error: String(event.error),
        });
        break;
      case "system.init":
      case "system.start":
      case "system.stop":
      case "system.destroy":
        emit({ kind: event.type });
        break;
      default:
        // Other observation events ignored in v1 (derivation.compute,
        // requirement.created/met/canceled, effect.run/error,
        // reconcile.start/end). They're available via .observe()
        // directly if a consumer wants them.
        break;
    }
  }

  /**
   * Re-entrance guard for the truncation handler. The marker entry is
   * itself a write that may trigger another shift; without this we'd
   * recurse and overflow. (M23)
   */
  let emittingTruncate = false;

  function attach(sys: System<ModuleSchema>): void {
    system = sys;
    refreshPIITags();
    refreshWhenSpecCache();
    unobserve = sys.observe(onEvent);
    // Wire up the truncation marker — fires BEFORE the sink drops the
    // oldest entry, so the dropped seq is still known. The guard
    // prevents the marker's own write from recursing back through the
    // capacity overflow path. (M23)
    sink.onTruncate?.((droppedSeq, droppedCount) => {
      if (emittingTruncate) return;
      emittingTruncate = true;
      try {
        emit({
          kind: "system.truncated",
          droppedSeq,
          droppedCount,
        });
      } finally {
        emittingTruncate = false;
      }
    });
  }

  function detach(): void {
    if (unobserve) {
      unobserve();
      unobserve = null;
    }
    system = null;
    whenSpecCache.clear();
    whenSourceCache.clear();
    piiTaggedFacts.clear();
  }

  const plugin: Plugin<ModuleSchema> = {
    name: "audit-ledger",
    onInit(sys) {
      attach(sys as System<ModuleSchema>);
    },
    onStop() {
      // Keep the sink populated so query() works after stop, but
      // drop the subscription to avoid leaks.
      if (unobserve) {
        unobserve();
        unobserve = null;
      }
    },
    onDestroy() {
      detach();
    },
    onDefinitionRegister(type, id) {
      if (type === "constraint") refreshWhenSpecCache();
      if (type === "constraint" || type === "resolver" || type === "effect") {
        // Re-pull PII tags too — a dynamically-registered fact (rare)
        // could have brought new meta.
        refreshPIITags();
      }
      void id;
    },
    onDefinitionAssign(type, id) {
      // (C4) Constraint assigned a new spec — refresh the cache so the
      // NEXT evaluate emits the new whenSpec, not the stale one.
      if (type === "constraint") refreshWhenSpecCache();
      void id;
    },
    onDefinitionUnregister(type, id) {
      if (type === "constraint") refreshWhenSpecCache();
      void id;
    },
    onSnapshot(snapshot) {
      // (M9) Capture history snapshot as a lifecycle marker. Snapshot
      // contents (facts) are NOT included to keep the entry small and
      // avoid duplicating PII through a different channel.
      emit({
        kind: "system.snapshot",
        snapshotId: snapshot.id,
        trigger: snapshot.trigger,
      });
    },
    onHistoryNavigate(from, to) {
      // (M9) Capture time-travel navigation as a lifecycle marker.
      emit({
        kind: "system.history.navigate",
        from,
        to,
      });
    },
  };

  return {
    plugin,
    query: (filter = {}) => sink.query(filter),
    recent: (n) => sink.recent(n),
    forFact: (path, opts2) => sink.forFact(path, opts2),
    forConstraint: (id, opts2) => sink.forConstraint(id, opts2),
    toJSON: () => sink.toJSON(),
    verify(opts?: { strong?: boolean }): VerifyResult {
      // (C1) v1 ships sync djb2 only. Strong (SHA-256) verify is
      // reserved for v2 and must NOT silently no-op — the previous
      // implementation returned `{ valid: true }` regardless of the
      // chain's actual state, which lied to callers.
      if (opts?.strong === true) {
        throw new Error(
          "[Directive] verify({ strong: true }) is reserved for v2 — v1 ships sync djb2 chain only. Use verify() (sync) for tamper detection.",
        );
      }

      const { entries } = sink.toJSON();
      if (entries.length === 0) {
        return { valid: true, entryCount: 0 };
      }

      // Sync walk — catches anything the djb2 chain would see.
      // (N1 + M1) Erased-entry tombstones (kind: "system.entry-erased")
      // legitimately break the chain — the tombstone's payload differs
      // from the original entry it replaced, so the NEXT entry's
      // prevHash no longer matches. When we detect a break whose
      // PREVIOUS entry is a tombstone (or the broken entry itself is
      // one), record the seq in `erasedAt` and resync the walk from
      // the tombstone's own hash.
      const erasedAt: number[] = [];
      let prevHash: string | null = null;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        if (entry.prevHash !== prevHash) {
          // Legitimate break? Either:
          //   (a) the entry itself is the tombstone, or
          //   (b) the previous entry was the tombstone whose payload
          //       was rewritten by erase().
          const prevEntry = i > 0 ? entries[i - 1]! : null;
          const brokenByErasure =
            entry.kind === "system.entry-erased" ||
            prevEntry?.kind === "system.entry-erased";
          if (brokenByErasure) {
            // Record the seq of the tombstone that broke the chain and
            // resync the walk by hashing this entry as our new pointer
            // for the next iteration.
            const tombstoneEntry =
              entry.kind === "system.entry-erased" ? entry : prevEntry!;
            erasedAt.push(tombstoneEntry.seq);
            prevHash = hashForEntry(entry);

            continue;
          }

          return {
            valid: false,
            brokenAt: i,
            expectedHash: prevHash ?? "<genesis>",
            actualHash: entry.prevHash ?? "<genesis>",
            entry,
          };
        }
        prevHash = hashForEntry(entry);
      }

      const result: { valid: true; entryCount: number; erasedAt?: number[] } = {
        valid: true,
        entryCount: entries.length,
      };
      if (erasedAt.length > 0) {
        result.erasedAt = erasedAt;
      }

      return result;
    },
    erase(filter) {
      // (C8) Replace matching entries with tombstones IN PLACE, keeping
      // seq + prevHash + hashAlgo so verify() can resync the chain.
      const erasedAt = Date.now();
      let count = 0;
      if (typeof sink.erase === "function") {
        count = sink.erase(filter, (e) => {
          // Build a tombstone preserving the immutable chain fields.
          const tombstone = {
            seq: e.seq,
            ts: e.ts,
            kind: "system.entry-erased" as const,
            prevHash: e.prevHash,
            hashAlgo: e.hashAlgo,
            originalKind: e.kind,
            erasedAt,
          } as AuditEntry;
          // CAUTION: replacing the payload changes the entry's hash —
          // which means the NEXT entry's prevHash will no longer match.
          // verify() recognises `system.entry-erased` as a legitimate
          // chain break and reports it in `erasedAt` rather than as
          // tamper. (N1 + M1)
          freezeEntry(tombstone);

          return tombstone;
        });
      }
      // (N2) Don't store the raw filter — PII can land in the values
      // (e.g. `factPath: "alice@x.com"`). Capture a hash + a shape
      // descriptor so an auditor sees WHICH fields were used without
      // exposing the values.
      const filterShape = {
        factPath: filter.factPath !== undefined,
        constraintId: filter.constraintId !== undefined,
        kind: filter.kind,
        changedBetween:
          filter.changedBetween !== undefined
            ? ("[range]" as const)
            : undefined,
      };
      // Emit a single chained `system.subject-erased` marker — recorded
      // AFTER the erasure so auditors see what was removed and why.
      const markerEntry = emit({
        kind: "system.subject-erased",
        filterHash: hashObject(filter),
        filterShape,
        erased: count,
      });

      return { erased: count, markerEntry };
    },
    clear() {
      sink.clear();
      seq = 0;
      lastHashCache = null;
    },
    destroy() {
      detach();
      sink.destroy();
    },
  };
}
