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
  agentStates: Record<string, {
    status: "idle" | "running" | "completed" | "error";
    lastInput?: string;
    lastOutput?: unknown;
    lastError?: string;
    runCount: number;
    totalTokens: number;
  }>;
  handoffCounter: number;
  pendingHandoffs: unknown[];
  handoffResults: unknown[];
  roundRobinCounters: Record<string, number> | null;
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
}

/** Checkpoint store interface */
export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<string>;
  load(checkpointId: string): Promise<Checkpoint | null>;
  list(): Promise<Array<{ id: string; label?: string; createdAt: string }>>;
  delete(checkpointId: string): Promise<boolean>;
  clear(): Promise<void>;
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
}

/**
 * In-memory checkpoint store with FIFO eviction.
 *
 * @example
 * ```typescript
 * const store = new InMemoryCheckpointStore({ maxCheckpoints: 50 });
 *
 * const id = await store.save(checkpoint);
 * const loaded = await store.load(id);
 * ```
 */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly store = new Map<string, Checkpoint>();
  private readonly order: string[] = [];
  private readonly maxCheckpoints: number;

  constructor(options?: InMemoryCheckpointStoreOptions) {
    this.maxCheckpoints = options?.maxCheckpoints ?? 100;

    if (!Number.isFinite(this.maxCheckpoints) || this.maxCheckpoints < 1) {
      throw new Error(
        `[Directive Checkpoint] maxCheckpoints must be >= 1, got ${this.maxCheckpoints}`
      );
    }
  }

  async save(checkpoint: Checkpoint): Promise<string> {
    if (!validateCheckpoint(checkpoint)) {
      throw new Error("[Directive Checkpoint] Invalid checkpoint data");
    }

    // FIFO eviction
    while (this.order.length >= this.maxCheckpoints) {
      const oldest = this.order.shift();
      if (oldest) {
        this.store.delete(oldest);
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

  async list(): Promise<Array<{ id: string; label?: string; createdAt: string }>> {
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
}
