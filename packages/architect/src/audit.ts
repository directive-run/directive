/**
 * Hash-chained append-only audit log.
 *
 * Each entry includes an FNV-1a hash of the previous entry, creating a
 * tamper-evident chain. Ring buffer caps at configurable max entries.
 */

import type {
  ActionReasoning,
  ArchitectAnalysis,
  ArchitectDefType,
  AuditEntry,
  AuditQuery,
} from "./types.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_ENTRIES = 1000;

// ============================================================================
// Hash Utilities
// ============================================================================

/**
 * Synchronous FNV-1a hash.
 * Not cryptographically secure — used for tamper-evidence chain integrity.
 */
function simpleHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  const unsigned = hash >>> 0;

  return unsigned.toString(16).padStart(8, "0");
}

/**
 * Synchronous hash for chain computation.
 * Uses FNV-1a for deterministic, fast hashing.
 */
function hashSync(input: string): string {
  return simpleHash(input);
}

// ============================================================================
// Audit Log
// ============================================================================

export interface AuditLogOptions {
  /** Maximum entries before oldest is evicted. Default: 1000 */
  maxEntries?: number;
}

export interface AppendOptions {
  trigger: ArchitectAnalysis["trigger"];
  tool: string;
  arguments: Record<string, unknown>;
  reasoning: ActionReasoning;
  definitionType?: ArchitectDefType;
  definitionId?: string;
  code?: string;
  approvalRequired: boolean;
  approved: boolean;
  applied: boolean;
  error?: string;
  /** M6: reference to original audit entry this is rolling back */
  rollbackOf?: string;
}

export function createAuditLog(options?: AuditLogOptions) {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries: AuditEntry[] = [];

  // C8: counter scoped to this audit log instance
  let auditCounter = 0;

  function append(opts: AppendOptions): AuditEntry {
    const prevHash =
      entries.length > 0 ? entries[entries.length - 1]!.hash : null;

    const entry: AuditEntry = {
      id: `audit-${++auditCounter}-${Date.now()}`,
      timestamp: Date.now(),
      trigger: opts.trigger,
      tool: opts.tool,
      arguments: opts.arguments,
      reasoning: opts.reasoning,
      definitionType: opts.definitionType,
      definitionId: opts.definitionId,
      code: opts.code,
      approvalRequired: opts.approvalRequired,
      approved: opts.approved,
      applied: opts.applied,
      error: opts.error,
      rolledBack: false,
      rollbackOf: opts.rollbackOf,
      hash: "", // computed below
      prevHash,
    };

    // Compute hash of this entry (excluding hash field itself)
    const hashInput = JSON.stringify({
      ...entry,
      hash: undefined,
    });
    entry.hash = hashSync(hashInput);

    // Freeze to make append-only
    Object.freeze(entry);

    // Ring buffer eviction
    if (entries.length >= maxEntries) {
      entries.shift();
    }

    entries.push(entry);

    return entry;
  }

  // M6: markRolledBack appends a new "rollback" entry referencing the original
  function markRolledBack(auditId: string): boolean {
    const index = entries.findIndex((e) => e.id === auditId);
    if (index === -1) {
      return false;
    }

    // Replace the frozen entry with an updated frozen copy
    const old = entries[index]!;
    const updated: AuditEntry = {
      ...old,
      rolledBack: true,
    };

    // Re-hash with updated rolledBack status
    const hashInput = JSON.stringify({ ...updated, hash: undefined });
    (updated as { hash: string }).hash = hashSync(hashInput);
    Object.freeze(updated);
    entries[index] = updated;

    // Append a new "rollback" entry referencing the original
    append({
      trigger: old.trigger,
      tool: "rollback",
      arguments: { originalAuditId: auditId },
      reasoning: old.reasoning,
      definitionType: old.definitionType,
      definitionId: old.definitionId,
      approvalRequired: false,
      approved: true,
      applied: true,
      rollbackOf: auditId,
    });

    return true;
  }

  function query(q?: AuditQuery): AuditEntry[] {
    if (!q) {
      return [...entries];
    }

    let result = entries;

    if (q.trigger !== undefined) {
      result = result.filter((e) => e.trigger === q.trigger);
    }

    if (q.definitionType !== undefined) {
      result = result.filter((e) => e.definitionType === q.definitionType);
    }

    if (q.after !== undefined) {
      const after = q.after;
      result = result.filter((e) => e.timestamp > after);
    }

    if (q.before !== undefined) {
      const before = q.before;
      result = result.filter((e) => e.timestamp < before);
    }

    if (q.approved !== undefined) {
      result = result.filter((e) => e.approved === q.approved);
    }

    if (q.applied !== undefined) {
      result = result.filter((e) => e.applied === q.applied);
    }

    if (q.limit !== undefined) {
      result = result.slice(-q.limit);
    }

    return [...result];
  }

  function verifyChain(): boolean {
    for (let i = 1; i < entries.length; i++) {
      const current = entries[i]!;
      const previous = entries[i - 1]!;

      if (current.prevHash !== previous.hash) {
        return false;
      }
    }

    return true;
  }

  function getAll(): AuditEntry[] {
    return [...entries];
  }

  function size(): number {
    return entries.length;
  }

  return {
    append,
    markRolledBack,
    query,
    verifyChain,
    getAll,
    size,
  };
}

export type AuditLog = ReturnType<typeof createAuditLog>;
