/**
 * The audit ledger's runtime constants, from 1.35
 * (packages/core/src/plugins/audit-ledger/types.ts), unchanged. Its type
 * declarations are 1.35's public types, copied into src/types/audit-ledger.ts;
 * they are re-exported here so the ledger's files import as they do in 1.35.
 */

import type {
  AuditEntryKind,
  AuditSchemaVersion,
} from "../../types/audit-ledger.js";

export type {
  AuditEntry,
  AuditEntryKind,
  AuditLedger,
  AuditLedgerOptions,
  AuditLedgerSink,
  AuditSchemaVersion,
  QueryFilter,
  VerifyResult,
} from "../../types/audit-ledger.js";

/** Hash algorithm tag — bumped if canonicalization or hash function changes. */
export const HASH_ALGO = "djb2-1" as const;

/**
 * Entry schema version. Bumped if `AuditEntry` field shape changes in
 * a way that breaks back-compat parsers. Persisted on every entry so
 * exports remain self-describing across library upgrades.
 *
 * Bumped to 2 when `fact.change` gained its required `origin` field. Entries
 * written under 1 stay verifiable: the version is part of what each entry is
 * hashed over, so the chain is checked against the schema it was written under.
 */
export const SCHEMA_VERSION: AuditSchemaVersion = 2;

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
