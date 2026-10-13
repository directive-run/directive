/**
 * Audit-ledger type definitions — entry shapes, sink interface, query
 * filter, verify result, and plugin options. Pure types + the two
 * schema-version constants (`HASH_ALGO`, `SCHEMA_VERSION`) that are
 * referenced by the entry shape.
 *
 * Kept free of runtime imports so the hash/freeze/sink modules can pull
 * types from here without a cycle.
 */

import type { FactOrigin, ModuleSchema, Plugin } from "../../core/types.js";
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
 * exports remain self-describing across library upgrades.
 */
/**
 * Schema versions an entry can carry. A reader may hold entries written by an
 * older version — an export re-loaded for verification, most obviously — so
 * this is the union rather than the current constant.
 */
export type AuditSchemaVersion = 1 | 2;

/**
 * Bumped to 2 when `fact.change` gained its required `origin` field. Entries
 * written under 1 stay verifiable: the version is part of what each entry is
 * hashed over, so the chain is checked against the schema it was written under.
 */
export const SCHEMA_VERSION: AuditSchemaVersion = 2;

// ============================================================================
// AuditEntry types
// ============================================================================

export type AuditEntryKind =
  | "constraint.evaluate"
  | "resolver.write.rejected"
  | "resolver.clobber.loop.detected"
  | "resolver.clobber.loop.resolved"
  | "fact.change"
  | "resolver.complete"
  | "resolver.error"
  | "source.attach"
  | "source.detach"
  | "source.error"
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
 * Every value {@link AuditEntryKind} can take, at runtime.
 *
 * A filter can arrive from a request body, and the erasure marker that records
 * it is frozen and permanent — so what goes into it is checked against this
 * rather than copied across.
 */
export const AUDIT_ENTRY_KINDS: readonly AuditEntryKind[] = [
  "constraint.evaluate",
  "resolver.write.rejected",
  "resolver.clobber.loop.detected",
  "resolver.clobber.loop.resolved",
  "fact.change",
  "resolver.complete",
  "resolver.error",
  "source.attach",
  "source.detach",
  "source.error",
  "system.init",
  "system.start",
  "system.stop",
  "system.destroy",
  "system.snapshot",
  "system.history.navigate",
  "system.truncated",
  "system.entry-erased",
  "system.subject-erased",
];

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
   * when migrating older exports.
   */
  readonly schemaVersion: AuditSchemaVersion;
  /**
   * Private sentinel — present (and equal to the in-module token) only
   * on legitimate tombstones minted by `ledger.erase()`. Filtered out
   * of all public read paths (`query`, `recent`, `toJSON`, etc.) so
   * consumers never see or copy it.
   *
   * NOT serialized. NOT exported. Forging this from outside the module
   * is impossible without the symbol reference; `verify()` rejects any
   * `system.entry-erased` entry that lacks it.
   *
   * @internal
   */
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
      kind: "resolver.clobber.loop.detected";
      /** Multi-tenant routing key from `system.meta.systemId`. */
      systemId: string;
      fact: string;
      participants: readonly string[];
      /** Window over which `count` distinct-requirement rejections accumulated. */
      windowMs: number;
      count: number;
      severity: "warn" | "error";
      /** Sequence numbers of the contributing `resolver.write.rejected` entries. */
      rejectionSeqs: readonly number[];
      /**
       * Verdict tag from the predicate-overlap proof (when available).
       * Operands are PII-redacted upstream in the plugin before the
       * event is constructed, so the audit entry never sees raw values
       * even when `capturePII: false`.
       */
      overlapVerdict?:
        | "matched"
        | "overlap"
        | "indeterminate"
        | "function-form-opaque";
    })
  | (AuditEntryBase & {
      kind: "resolver.clobber.loop.resolved";
      systemId: string;
      fact: string;
      participants: readonly string[];
      /** Time between the originating `detected` event and this `resolved` entry. */
      durationMs: number;
      resolution:
        | "no-recurrence-in-window"
        | "participant-disabled"
        | "predicate-narrowed";
    })
  | (AuditEntryBase & {
      kind: "fact.change";
      key: string;
      prior: unknown;
      next: unknown;
      /**
       * Where the write came from — `"authored"`, `"restore"` or `"hydrate"`.
       *
       * Always present, so a query for program writes names them instead of
       * testing for the absence of a label. Stamped against the write as it is
       * made, not read from a flag when the batch is reported.
       *
       * A replayed write is filed, never dropped. Dropping it would put a
       * label in charge of whether an entry exists at all, which is worth
       * forging; filing it puts the label in charge of nothing more than
       * which rows an auditor reads together.
       *
       * It is not an authenticity signal. `"authored"` means the write did not
       * arrive through a replay or a hydration door — it says nothing about
       * who or what made it.
       */
      origin: FactOrigin;
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
      kind: "source.attach" | "source.detach";
      sourceId: string;
      moduleId: string;
    })
  | (AuditEntryBase & {
      kind: "source.error";
      sourceId: string;
      moduleId: string;
      /**
       * `phase: "runtime"` (RFC 0008) flags errors the source reported
       * mid-flight via the `reportError` callback `attach` receives as
       * its second argument — distinct from lifecycle `"attach"` /
       * `"cleanup"` failures.
       */
      phase: "attach" | "cleanup" | "runtime" | "gate";
      /**
       * Truncated error message — capped at a fixed length by the source
       * manager before it reaches the ledger. Source authors who embed
       * payloads in error messages get a bounded leak surface rather than
       * an unbounded one. Pair with the matching `source.attach` /
       * `source.detach` entries for full lifecycle context.
       */
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
       * `filterShape` to see which filter fields were used.
       */
      filterHash: string;
      /**
       * Stripped-values shape of the filter — captures WHICH fields were
       * present without recording their values.
       */
      filterShape: {
        factPath: boolean;
        constraintId: boolean;
        kind: AuditEntryKind | readonly AuditEntryKind[] | undefined;
        changedBetween: "[range]" | undefined;
        /**
         * Carried by value, unlike the fields above. `origin` names no
         * subject, and an erasure scoped to replayed writes is a different
         * act from one scoped to the program's own.
         */
        origin?: FactOrigin | readonly FactOrigin[];
      };
      erased: number;
    });

// ============================================================================
// Sink interface
// ============================================================================

export interface QueryFilter {
  /** Exact-match fact path. */
  factPath?: string;
  /**
   * Filter `fact.change` entries by where the write came from.
   *
   * Applied by the sink while it walks, which is the reason this exists rather
   * than leaving callers to filter the result. `query()` walks newest-first and
   * stops once it has `limit` rows, so a caller filtering afterwards is
   * filtering a page that was already chosen — a fact whose recent history is
   * mostly replayed writes can fill the page and leave nothing behind.
   */
  origin?: FactOrigin | readonly FactOrigin[];
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
 * cannot mint, so `verify()` reports them as tamper.
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
       * (renamed from `erasedAt`)
       */
      erasedSeqs?: number[];
      /**
       * Set when the surviving entries are a window into a longer chain —
       * the sink dropped older entries to stay within capacity, so the walk
       * began partway in. The value is the `seq` the window starts at;
       * everything below it is gone.
       *
       * Its absence means the chain still reaches back to its first entry.
       * A verified window is not the same claim as a verified chain: the
       * entries that are here are intact and in order, and nothing can be
       * said about the ones that rotated out.
       */
      windowStartSeq?: number;
      /**
       * Present with {@link windowStartSeq}. True when the surviving entries
       * contain `system.truncated` markers, which is what a sink writes as it
       * rotates — so the missing prefix has an account of itself.
       *
       * False means entries are missing and nothing in the record explains
       * why. That is not proof of tampering: a system that has been quiet for
       * a long time can outlive its own markers. It is the difference between
       * a gap with a receipt and a gap without one, and it is worth a question.
       */
      truncationExplained?: boolean;
      /**
       * Whether the provenance of erasure tombstones and truncation markers
       * could be checked.
       *
       * The runtime records which entries it wrote, in memory and off the
       * entries themselves — so the record does not survive serialisation. A
       * ledger reloaded from an export reports `false`, and so does any sink
       * that does not hand back the same object it was given, which includes
       * most durable ones.
       *
       * `false` does not mean tampering. The chain is still checked; what is
       * not is whether those two kinds — the two `verify()` treats as
       * legitimate chain breaks — came from the runtime or were appended.
       *
       * Always present, because a caller checking `valid` alone should not be
       * able to miss it. An unkeyed chain cannot do better than reporting
       * this: an attacker can always present a forgery as a copy.
       */
      marksChecked: boolean;
      /**
       * Seq numbers that are absent from the middle of the chain and that
       * nothing accounts for — an entry the sink refused, most likely.
       *
       * Not a break. The chain closes over a refused entry deliberately, so
       * that one failed write does not report the whole record as tampered.
       * But an entry that is simply gone is worth surfacing rather than
       * passing over in silence, which is what closing over it would otherwise
       * do. Pair with `onWriteError` to catch them as they happen.
       *
       * Entries dropped from the *head* by a bounded sink are not listed here;
       * see `windowStartSeq`.
       */
      missingSeqs?: number[];
      /**
       * How many seq numbers are missing in total. Always exact.
       * {@link missingSeqs} lists at most the first hundred of them — the
       * input to a verification is often a file from elsewhere, and a number
       * in it should not decide how much memory the check allocates.
       */
      missingSeqCount?: number;
      /**
       * Erasure tombstones that this runtime did not write, among entries
       * where it wrote others.
       *
       * Reported rather than fatal. The mark that says "the runtime wrote
       * this" is held in memory against the entry object, so it does not
       * survive being stored or exported — which means "written by the
       * runtime" and "appended by someone" are indistinguishable in any record
       * that has been anywhere. Making it decide the verdict was tried in both
       * directions and each accused an honest ledger: once every sink that
       * persists anything, once every restart from an export.
       *
       * A non-empty list is worth a question, not a conclusion. Real tampering
       * with an entry's contents still breaks the chain and returns
       * `valid: false`.
       */
      unmarkedTombstoneSeqs?: number[];
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
   * truncated and where.
   */
  onTruncate?(
    handler: (droppedSeq: number, droppedCount: number) => void,
  ): void;
}

// ============================================================================
// Plugin options + public API surface
// ============================================================================

export interface AuditLedgerOptions {
  /**
   * Called when the sink refuses an entry, with the error and the entry that
   * did not land.
   *
   * A sink can fail — a quota, a disk, a remote that returns 500. When it
   * does, that entry is not in the record and nothing downstream will say so:
   * the failure happens inside a plugin hook whose errors are caught and
   * logged by the plugin manager, so the application never sees it. Handle
   * this if a gap in the record is something you need to know about.
   *
   * Defaults to a `console.error` naming the entry's seq and kind.
   */
  onWriteError?: (error: unknown, entry: AuditEntry) => void;

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
   * surfaces as `valid: false`.
   *
   * Forged tombstones — `kind: "system.entry-erased"` entries written
   * directly via `sink.write()` to mask tamper — are detected as
   * forgery. Legitimate tombstones carry an in-module sentinel that
   * forgeries cannot mint.
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
   * in the sink, not on the return value).
   *
   * When `erased === 0` (filter matched nothing), `markerEntry` is
   * `null` and no marker is emitted into the chain — avoids polluting
   * the audit trail with empty "erased: 0" records.
   *
   * WARNING: v1 erases only from THIS sink. External copies (toJSON
   * exports, downstream pipelines, persisted backups) must be erased
   * separately.
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
