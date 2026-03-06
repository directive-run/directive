/**
 * Persistence Layer — pluggable audit storage and state checkpointing.
 *
 * Provides interfaces for persisting the architect's audit trail
 * and operational state across restarts. Ships with in-memory
 * implementations that wrap existing behavior.
 */

import type {
  AuditEntry,
  AuditQuery,
  ArchitectAction,
  RollbackEntry,
  CircuitBreakerState,
} from "./types.js";

// ============================================================================
// Audit Store
// ============================================================================

/** Pluggable audit storage interface. */
export interface AuditStore {
  /** Append an audit entry. */
  append(entry: AuditEntry): Promise<void>;
  /** Query audit entries. */
  query(q?: AuditQuery): Promise<AuditEntry[]>;
  /** Count total entries. */
  count(): Promise<number>;
  /** Verify hash chain integrity. */
  verifyChain(): Promise<boolean>;
  /** Initialize the store (e.g., connect to database). */
  init?(): Promise<void>;
  /** Flush and close the store. */
  close?(): Promise<void>;
}

// ============================================================================
// Checkpoint Store
// ============================================================================

/** Snapshot of guard state for serialization. */
export interface GuardStateSnapshot {
  tokensUsed: number;
  dollarsUsed: number;
  alertedThresholds: number[];
  circuitBreakerState: CircuitBreakerState;
  failureCount: number;
}

/** Full architect state checkpoint for persistence. */
export interface ArchitectCheckpoint {
  /** Schema version for forward compatibility. */
  version: 1;
  /** When this checkpoint was created. */
  createdAt: string;
  /** Active dynamic definition IDs (e.g., "constraint::my-constraint"). */
  dynamicIds: string[];
  /** Applied actions as [actionId, ArchitectAction] pairs. */
  actions: Array<[string, ArchitectAction]>;
  /** Rollback entries as [actionId, RollbackEntry] pairs. */
  rollbackEntries: Array<[string, RollbackEntry]>;
  /** Previously approved definition keys. */
  approvedDefinitions: string[];
  /** Action timestamps for hourly rate limiting. */
  actionTimestamps: number[];
  /** Pipeline action counter. */
  versionCounter: number;
  /** Guard state snapshot. */
  guardState: GuardStateSnapshot;
  /** Audit counter for continued ID generation. */
  auditCounter: number;
}

/** Pluggable checkpoint storage interface. */
export interface CheckpointStore {
  /** Save a checkpoint. */
  save(checkpoint: ArchitectCheckpoint): Promise<void>;
  /** Load the most recent checkpoint. Returns null if none exists. */
  load(): Promise<ArchitectCheckpoint | null>;
  /** Initialize the store. */
  init?(): Promise<void>;
  /** Close the store. */
  close?(): Promise<void>;
}

/** Persistence configuration for the architect. */
export interface PersistenceConfig {
  /** External audit store. If provided, audit entries are routed here. */
  audit?: AuditStore;
  /** Checkpoint store for state persistence. */
  checkpoint?: CheckpointStore;
  /** Auto-checkpoint interval. Default: "5m". Set to null to disable. */
  checkpointInterval?: string | null;
}

// ============================================================================
// In-Memory Implementations
// ============================================================================

/**
 * Create an in-memory audit store. Useful for testing and as a reference
 * implementation. Wraps a simple array with hash chain verification.
 *
 * @param maxEntries - Maximum entries before FIFO eviction. Default: 10000.
 * @returns An AuditStore backed by an in-memory array.
 */
export function createInMemoryAuditStore(maxEntries = 10_000): AuditStore {
  const entries: AuditEntry[] = [];
  let genesisHash: string | null = null;

  return {
    async append(entry: AuditEntry): Promise<void> {
      // Ring buffer eviction
      if (entries.length >= maxEntries) {
        const evicted = entries.shift()!;
        genesisHash = evicted.hash;
      }

      entries.push(entry);
    },

    async query(q?: AuditQuery): Promise<AuditEntry[]> {
      if (!q) {
        return [...entries];
      }

      let result: AuditEntry[] = entries;

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
    },

    async count(): Promise<number> {
      return entries.length;
    },

    async verifyChain(): Promise<boolean> {
      if (entries.length === 0) {
        return true;
      }

      // Check genesis hash after eviction
      const first = entries[0]!;
      if (genesisHash !== null && first.prevHash !== genesisHash) {
        return false;
      }

      for (let i = 1; i < entries.length; i++) {
        const current = entries[i]!;
        const previous = entries[i - 1]!;

        if (current.prevHash !== previous.hash) {
          return false;
        }
      }

      return true;
    },
  };
}

/**
 * Create an in-memory checkpoint store. Stores a single checkpoint
 * in memory. Useful for testing.
 *
 * @returns A CheckpointStore backed by a single in-memory slot.
 */
export function createInMemoryCheckpointStore(): CheckpointStore {
  let stored: ArchitectCheckpoint | null = null;

  return {
    async save(checkpoint: ArchitectCheckpoint): Promise<void> {
      stored = checkpoint;
    },

    async load(): Promise<ArchitectCheckpoint | null> {
      return stored;
    },
  };
}
