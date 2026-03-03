/**
 * Persistent Checkpointing — Serialize/restore full orchestrator state.
 *
 * Enables long-running workflows, process restarts, and fork-and-replay by
 * capturing a complete snapshot of orchestrator state at rest.
 *
 * @module
 */

// ============================================================================
// Types
// ============================================================================

/** Checkpoint local state for single-agent orchestrators */
export interface SingleAgentCheckpointLocalState {
  type: "single";
}

/** Checkpoint local state for multi-agent orchestrators */
export interface MultiAgentCheckpointLocalState {
  type: "multi";
  globalTokenCount: number;
  globalStatus: "idle" | "paused";
  agentStates: Record<
    string,
    {
      status: "idle" | "running" | "completed" | "error";
      lastInput?: string;
      lastOutput?: unknown;
      lastError?: string;
      runCount: number;
      totalTokens: number;
    }
  >;
  handoffCounter: number;
  pendingHandoffs: unknown[];
  handoffResults: unknown[];
  roundRobinCounters: Record<string, number> | null;
  /** Serialized task states (task run functions are closures, not serializable) */
  taskStates?: Record<string, { lastOutput?: string; lastError?: string }>;
}

/** Union of local state types */
export type CheckpointLocalState =
  | SingleAgentCheckpointLocalState
  | MultiAgentCheckpointLocalState;

/** Full checkpoint data */
export interface Checkpoint {
  version: 1;
  id: string;
  createdAt: string;
  label?: string;
  systemExport: string;
  timelineExport: string | null;
  localState: CheckpointLocalState;
  memoryExport: unknown | null;
  orchestratorType: "single" | "multi";
  /** Associated time-travel snapshot ID */
  snapshotId?: number;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/** Checkpoint store interface */
export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<string>;
  load(checkpointId: string): Promise<Checkpoint | null>;
  list(): Promise<Array<{ id: string; label?: string; createdAt: string }>>;
  delete(checkpointId: string): Promise<boolean>;
  clear(): Promise<void>;
  /** Prune old checkpoints based on retention policy. Returns number pruned. */
  prune(): Promise<number>;
}

// ============================================================================
// Helpers
// ============================================================================

const BLOCKED_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "valueOf",
  "hasOwnProperty",
]);

/** Create a unique checkpoint ID */
export function createCheckpointId(): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomUUID().slice(0, 8);

  return `ckpt_${timestamp}_${random}`;
}

/** Validate that an unknown value is a valid Checkpoint */
export function validateCheckpoint(data: unknown): data is Checkpoint {
  if (!data || typeof data !== "object") {
    return false;
  }

  // Prototype pollution defense
  for (const key of Object.keys(data)) {
    if (BLOCKED_KEYS.has(key)) {
      return false;
    }
  }

  const obj = data as Record<string, unknown>;

  if (obj.version !== 1) {
    return false;
  }

  if (typeof obj.id !== "string" || obj.id.length === 0) {
    return false;
  }

  if (typeof obj.createdAt !== "string") {
    return false;
  }

  if (typeof obj.systemExport !== "string") {
    return false;
  }

  if (obj.timelineExport !== null && typeof obj.timelineExport !== "string") {
    return false;
  }

  if (!obj.localState || typeof obj.localState !== "object") {
    return false;
  }

  // Validate localState prototype pollution
  for (const key of Object.keys(obj.localState)) {
    if (BLOCKED_KEYS.has(key)) {
      return false;
    }
  }

  const localState = obj.localState as Record<string, unknown>;
  if (localState.type !== "single" && localState.type !== "multi") {
    return false;
  }

  if (obj.orchestratorType !== "single" && obj.orchestratorType !== "multi") {
    return false;
  }

  return true;
}

// ============================================================================
// InMemoryCheckpointStore
// ============================================================================

/** Options for InMemoryCheckpointStore */
export interface InMemoryCheckpointStoreOptions {
  /** Maximum checkpoints to retain before FIFO eviction. @default 100 */
  maxCheckpoints?: number;
  /** Time-based retention: prune checkpoints older than this (ms). @default Infinity */
  retentionMs?: number;
  /** When true, labeled checkpoints are exempt from auto-prune. @default false */
  preserveLabeled?: boolean;
}

/**
 * In-memory checkpoint store with FIFO eviction and time-based retention.
 *
 * @example
 * ```typescript
 * const store = new InMemoryCheckpointStore({
 *   maxCheckpoints: 50,
 *   retentionMs: 3600000, // 1 hour
 *   preserveLabeled: true,
 * });
 *
 * const id = await store.save(checkpoint);
 * const pruned = await store.prune();
 * ```
 */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly store = new Map<string, Checkpoint>();
  private readonly order: string[] = [];
  private readonly maxCheckpoints: number;
  private readonly retentionMs: number;
  private readonly preserveLabeled: boolean;

  constructor(options?: InMemoryCheckpointStoreOptions) {
    this.maxCheckpoints = options?.maxCheckpoints ?? 100;
    this.retentionMs = options?.retentionMs ?? Number.POSITIVE_INFINITY;
    this.preserveLabeled = options?.preserveLabeled ?? false;

    if (!Number.isFinite(this.maxCheckpoints) || this.maxCheckpoints < 1) {
      throw new Error(
        `[Directive Checkpoint] maxCheckpoints must be >= 1, got ${this.maxCheckpoints}`,
      );
    }
  }

  async save(checkpoint: Checkpoint): Promise<string> {
    if (!validateCheckpoint(checkpoint)) {
      throw new Error("[Directive Checkpoint] Invalid checkpoint data");
    }

    // FIFO eviction (respects preserveLabeled)
    while (this.order.length >= this.maxCheckpoints) {
      const evicted = this.evictOldest();
      if (!evicted) {
        break;
      }
    }

    // Deduplicate: remove existing order entry if updating
    const existingIdx = this.order.indexOf(checkpoint.id);
    if (existingIdx >= 0) {
      this.order.splice(existingIdx, 1);
    }

    this.store.set(checkpoint.id, checkpoint);
    this.order.push(checkpoint.id);

    return checkpoint.id;
  }

  async load(checkpointId: string): Promise<Checkpoint | null> {
    return this.store.get(checkpointId) ?? null;
  }

  async list(): Promise<
    Array<{ id: string; label?: string; createdAt: string }>
  > {
    return this.order.map((id) => {
      const cp = this.store.get(id)!;

      return { id: cp.id, label: cp.label, createdAt: cp.createdAt };
    });
  }

  async delete(checkpointId: string): Promise<boolean> {
    if (!this.store.has(checkpointId)) {
      return false;
    }

    this.store.delete(checkpointId);
    const index = this.order.indexOf(checkpointId);
    if (index >= 0) {
      this.order.splice(index, 1);
    }

    return true;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.order.length = 0;
  }

  async prune(): Promise<number> {
    if (!Number.isFinite(this.retentionMs)) {
      return 0;
    }

    const cutoff = Date.now() - this.retentionMs;
    let pruned = 0;

    // Iterate from oldest to newest
    const toRemove: string[] = [];
    for (const id of this.order) {
      const cp = this.store.get(id);
      if (!cp) {
        continue;
      }

      const createdAtMs = new Date(cp.createdAt).getTime();
      if (createdAtMs >= cutoff) {
        break; // Remaining are newer
      }

      // Skip labeled checkpoints if preserveLabeled
      if (this.preserveLabeled && cp.label) {
        continue;
      }

      toRemove.push(id);
    }

    for (const id of toRemove) {
      this.store.delete(id);
      const idx = this.order.indexOf(id);
      if (idx >= 0) {
        this.order.splice(idx, 1);
      }
      pruned++;
    }

    return pruned;
  }

  /** Evict the oldest non-labeled checkpoint. Returns true if one was evicted. */
  private evictOldest(): boolean {
    if (this.preserveLabeled) {
      // Find first non-labeled checkpoint
      for (let i = 0; i < this.order.length; i++) {
        const id = this.order[i]!;
        const cp = this.store.get(id);
        if (cp && !cp.label) {
          this.order.splice(i, 1);
          this.store.delete(id);

          return true;
        }
      }

      // All are labeled — evict oldest anyway to make room
    }

    const oldest = this.order.shift();
    if (oldest) {
      this.store.delete(oldest);

      return true;
    }

    return false;
  }
}
