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
import { fnv1a } from "./hash.js";
import { RingBuffer } from "./ring-buffer.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAX_ENTRIES = 1000;

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
  /** reference to original audit entry this is rolling back */
  rollbackOf?: string;
}

/**
 * Create a hash-chained append-only audit log.
 *
 * @param options - Optional configuration (max entries before eviction).
 * @returns Audit log with append, query, verify, and markRolledBack methods.
 *
 * @example
 * ```typescript
 * const log = createAuditLog({ maxEntries: 500 });
 * log.append({ trigger: "demand", tool: "observe_system", ... });
 * const entries = log.query({ trigger: "demand" });
 * const valid = log.verify();
 * ```
 */
export function createAuditLog(options?: AuditLogOptions) {
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries = new RingBuffer<AuditEntry>(maxEntries);

  // C8: counter scoped to this audit log instance
  let auditCounter = 0;

  // M3: track genesis hash after eviction for chain verification
  let genesisHash: string | null = null;

  function append(opts: AppendOptions): AuditEntry {
    const lastEntry = entries.last();
    const prevHash = lastEntry ? lastEntry.hash : null;

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
    entry.hash = fnv1a(hashInput);

    // Freeze to make append-only
    Object.freeze(entry);

    // Ring buffer eviction — M3: track evicted hash as genesis
    const evicted = entries.push(entry);
    if (evicted) {
      genesisHash = evicted.hash;
    }

    return entry;
  }

  // Item 4: markRolledBack — append-only, no in-place mutation.
  // Query rollback status via rollbackOf entries in the chain.
  function markRolledBack(auditId: string): boolean {
    const allEntries = entries.toArray();
    const original = allEntries.find((e) => e.id === auditId);
    if (!original) {
      return false;
    }

    // Append a new "rollback" entry referencing the original — chain stays intact
    append({
      trigger: original.trigger,
      tool: "rollback",
      arguments: { originalAuditId: auditId },
      reasoning: original.reasoning,
      definitionType: original.definitionType,
      definitionId: original.definitionId,
      approvalRequired: false,
      approved: true,
      applied: true,
      rollbackOf: auditId,
    });

    return true;
  }

  /** Check if an entry has been rolled back by searching for rollbackOf entries. */
  function isRolledBack(auditId: string): boolean {
    for (const e of entries) {
      if (e.rollbackOf === auditId) {
        return true;
      }
    }

    return false;
  }

  function query(q?: AuditQuery): AuditEntry[] {
    if (!q) {
      return entries.toArray();
    }

    let result: AuditEntry[] = entries.toArray();

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

    return result;
  }

  function verifyChain(): boolean {
    if (entries.size === 0) {
      return true;
    }

    // M3: after eviction, first entry's prevHash should match genesisHash
    const first = entries.at(0)!;
    if (genesisHash !== null && first.prevHash !== genesisHash) {
      return false;
    }

    for (let i = 1; i < entries.size; i++) {
      const current = entries.at(i)!;
      const previous = entries.at(i - 1)!;

      if (current.prevHash !== previous.hash) {
        return false;
      }
    }

    return true;
  }

  function getAll(): AuditEntry[] {
    return entries.toArray();
  }

  function size(): number {
    return entries.size;
  }

  /** Export the full audit log as a JSON string for persistence. */
  function exportLog(): string {
    return JSON.stringify({
      version: 1,
      entries: entries.toArray().map((e) => ({ ...e })),
      exportedAt: Date.now(),
    });
  }

  /** Import a previously exported audit log. Optionally verify chain integrity. */
  function importLog(json: string, verify = false): boolean {
    try {
      const data = JSON.parse(json);

      if (!data || typeof data !== "object" || !Array.isArray(data.entries)) {
        return false;
      }

      const imported = data.entries as AuditEntry[];

      // M9: validate required fields on each entry
      for (const entry of imported) {
        if (
          typeof entry.id !== "string" ||
          typeof entry.timestamp !== "number" ||
          typeof entry.tool !== "string" ||
          typeof entry.hash !== "string" ||
          typeof entry.approved !== "boolean" ||
          typeof entry.applied !== "boolean"
        ) {
          return false;
        }
      }

      // Verify chain if requested
      if (verify) {
        for (let i = 0; i < imported.length; i++) {
          const current = imported[i]!;

          // M12: verify content hash matches
          const recomputed = fnv1a(JSON.stringify({ ...current, hash: undefined }));
          if (recomputed !== current.hash) {
            return false;
          }

          // Verify chain links
          if (i > 0) {
            const previous = imported[i - 1]!;
            if (current.prevHash !== previous.hash) {
              return false;
            }
          }
        }
      }

      // Replace current entries
      entries.clear();
      for (const entry of imported) {
        const frozen = Object.freeze({ ...entry });
        entries.push(frozen);
      }

      // Reset counter to continue after imported entries
      if (imported.length > 0) {
        const lastId = imported[imported.length - 1]!.id;
        const match = /audit-(\d+)-/.exec(lastId);
        if (match) {
          auditCounter = Number.parseInt(match[1]!, 10);
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  return {
    append,
    markRolledBack,
    isRolledBack,
    query,
    verifyChain,
    getAll,
    size,
    exportLog,
    importLog,
  };
}

export type AuditLog = ReturnType<typeof createAuditLog>;
