/**
 * Audit-ledger type definitions — entry shapes, sink interface, query
 * filter, verify result, and plugin options. Pure types + the two
 * schema-version constants (`HASH_ALGO`, `SCHEMA_VERSION`) that are
 * referenced by the entry shape.
 *
 * Kept free of runtime imports so the hash/freeze/sink modules can pull
 * types from here without a cycle.
 */

import type { ModuleSchema, Plugin } from "../../core/types.js";
import type {
  ClauseResult,
  FactPredicate,
} from "../../core/types/predicate.js";

// ============================================================================
// Version stamps
// ============================================================================

/** Hash algorithm tag — bumped if canonicalization or hash function changes. */
export const HASH_ALGO = "djb2-1" as const;

/**
 * Entry schema version. Bumped if `AuditEntry` field shape changes in
 * a way that breaks back-compat parsers. Persisted on every entry so
 * exports remain self-describing across library upgrades. (F-5)
 */
export const SCHEMA_VERSION = 1 as const;

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

/**
 * Internal sentinel symbol type. The actual symbol VALUE lives in
 * `hash.ts` and is never exported from this folder's public surface —
 * but the TYPE must be referenceable here so `AuditEntryBase` can
 * declare the optional `__internal` field.
 *
 * We use `symbol` rather than `typeof LEDGER_INTERNAL_TOKEN` because
 * importing the symbol value into types.ts would either re-export it
 * (defeating the defense) or create a circular import. The runtime
 * check in `verify()` compares against the actual symbol reference.
 */
type LedgerInternalSentinel = symbol;

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
  /**
   * Entry schema version — bumped if any `AuditEntry` field shape
   * changes in a way that breaks back-compat. Pair with `hashAlgo`
   * when migrating older exports. (F-5)
   */
  readonly schemaVersion: typeof SCHEMA_VERSION;
  /**
   * Private sentinel — present (and equal to the in-module token) only
   * on legitimate tombstones minted by `ledger.erase()`. Filtered out
   * of all public read paths (`query`, `recent`, `toJSON`, etc.) so
   * consumers never see or copy it. (N7)
   *
   * NOT serialized. NOT exported. Forging this from outside the module
   * is impossible without the symbol reference; `verify()` rejects any
   * `system.entry-erased` entry that lacks it.
   *
   * @internal
   */
  readonly __internal?: LedgerInternalSentinel;
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
 * `verify()` reports them in `erasedSeqs` and continues the walk from the
 * tombstone's own hash. Real tamper still surfaces as `valid: false`.
 *
 * Forged tombstones (a caller writes `kind: "system.entry-erased"`
 * directly via `sink.write()` to mask tamper as erasure) are detected:
 * legitimate tombstones carry an in-module sentinel that forgeries
 * cannot mint, so `verify()` reports them as tamper. (N7)
 */
export type VerifyResult =
  | {
      valid: true;
      entryCount: number;
      /**
       * Seq numbers of entries legitimately broken by `erase()`
       * tombstones. NOT timestamps — each entry pairs this seq with
       * the per-entry `system.entry-erased.erasedAt` (ms epoch) for
       * the timestamp. Empty unless the chain contains erasures.
       * (N1 + M1; renamed from `erasedAt` in R3)
       */
      erasedSeqs?: number[];
    }
  | {
      valid: false;
      brokenAt: number;
      expectedHash: string;
      actualHash: string;
      entry: AuditEntry;
      /**
       * Human-readable reason for the break — populated for cases
       * where the cause is more specific than "hash mismatch" (e.g.
       * tombstone forgery detected via missing sentinel).
       */
      reason?: string;
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
   * Replace matching entries with marker entries IN PLACE (preserving seq +
   * prevHash so the hash chain still verifies — the marker is a
   * tombstone in chain terms; the chain break is what makes erasure
   * visible to `verify()`). v1 implementation matches on the same
   * `QueryFilter` shape used by `query()`. Returns the count of entries
   * replaced.
   *
   * WARNING: erases only from this sink. Any external copies (toJSON
   * exports, downstream pipelines) must be erased separately.
   */
  erase?(
    filter: QueryFilter,
    markerEntryFactory: (e: AuditEntry) => AuditEntry,
  ): number;
  /**
   * Optional hook fired by the sink BEFORE shifting the oldest entry
   * out of a bounded ring buffer. The ledger plugin uses this to emit
   * a `system.truncated` marker so an auditor sees that the log was
   * truncated and where. (M23)
   */
  onTruncate?(
    handler: (droppedSeq: number, droppedCount: number) => void,
  ): void;
}

// ============================================================================
// Plugin options + public API surface
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
   * breaks — `verify()` reports them in `erasedSeqs` and continues
   * the walk from the tombstone's actual hash. Real tamper still
   * surfaces as `valid: false`. (N1 + M1)
   *
   * Forged tombstones — `kind: "system.entry-erased"` entries written
   * directly via `sink.write()` to mask tamper — are detected as
   * forgery. Legitimate tombstones carry an in-module sentinel that
   * forgeries cannot mint. (N7)
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
   * When `erased === 0` (filter matched nothing), `markerEntry` is
   * `null` and no marker is emitted into the chain — avoids polluting
   * the audit trail with empty "erased: 0" records. (MAJOR-3)
   *
   * WARNING: v1 erases only from THIS sink. External copies (toJSON
   * exports, downstream pipelines, persisted backups) must be erased
   * separately. (C8)
   */
  erase(filter: QueryFilter): {
    erased: number;
    markerEntry: AuditEntry | null;
  };
  /** Empty the sink. */
  clear(): void;
  /** Unsubscribe + drop the sink. */
  destroy(): void;
}
