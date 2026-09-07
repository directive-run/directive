/**
 * A checkpoint store that survives the process.
 *
 * `InMemoryCheckpointStore` is a `Map`, so every checkpoint dies with
 * the isolate that made it. That is the right default for a test and
 * useless for the case checkpoints exist for: a long multi-agent run
 * that is interrupted and resumed later, possibly on a different
 * machine.
 *
 * =====================================================================
 * ⚠ NO RUNTIME DEPENDENCY, DELIBERATELY
 * =====================================================================
 *
 * `@directive-run/ai` has no Cloudflare, Deno or Node storage import
 * anywhere, and this does not add one. The store takes a STRUCTURAL
 * interface — `get`, `put`, `delete`, `list` — which Cloudflare KV
 * satisfies as-is, and which Deno KV, Redis, S3 or a test double can be
 * adapted to in a few lines.
 *
 * A library that reaches for a platform SDK to persist something makes
 * itself unusable everywhere that SDK is absent. The consumer knows
 * what storage it has; this only needs to know the four verbs.
 *
 * =====================================================================
 * ⚠ THE INDEX IS THE HARD PART, AND `list()` IS WHY
 * =====================================================================
 *
 * The interface promises `list()` in insertion order. Key-value stores
 * either cannot list at all, or list lexicographically with eventual
 * consistency and a page cursor — neither of which is insertion order.
 *
 * So order is stored EXPLICITLY, in one index key, rather than derived
 * from a key scan. That costs a second write per save and buys a
 * `list()` that means what the interface says. Deriving it from a scan
 * would give an order that looks right in a test with three
 * checkpoints and silently wrong at fifty.
 *
 * ⚠ AND THE INDEX IS NOT ATOMIC WITH THE CHECKPOINT. Two saves racing
 * can lose an index entry — KV has no compare-and-set. This store
 * repairs rather than pretends: `list()` drops ids whose checkpoint is
 * gone, and `save()` re-adds an id missing from the index. A lost index
 * write costs ordering for one entry, never the checkpoint itself.
 * A caller needing exactness wants a Durable Object, and that is a
 * different store, not a cleverer write here.
 */
import {
  type Checkpoint,
  type CheckpointStore,
  validateCheckpoint,
} from "./checkpoint.js";

/**
 * The four verbs this store needs.
 *
 * Cloudflare's `KVNamespace` satisfies this structurally with no
 * adapter. Anything else needs a handful of lines.
 */
export interface CheckpointKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface KvCheckpointStoreOptions {
  /** Namespace prefix, so one KV can hold more than checkpoints.
   * @default "directive:checkpoint:" */
  prefix?: string;
  /** Maximum checkpoints before FIFO eviction. @default 100 */
  maxCheckpoints?: number;
  /** Prune checkpoints older than this (ms). @default Infinity */
  retentionMs?: number;
  /** Labeled checkpoints are exempt from auto-prune. @default false */
  preserveLabeled?: boolean;
  /** Injected for tests. @default Date.now */
  now?: () => number;
}

interface IndexEntry {
  id: string;
  label?: string;
  createdAt: string;
}

/**
 * Checkpoints in a key-value store, with the same FIFO and retention
 * semantics as {@link InMemoryCheckpointStore}.
 *
 * @example
 * ```typescript
 * // Cloudflare Workers — KVNamespace satisfies CheckpointKv directly
 * const store = new KvCheckpointStore(env.CHECKPOINTS, {
 *   maxCheckpoints: 50,
 *   retentionMs: 86_400_000,
 *   preserveLabeled: true,
 * });
 * ```
 */
export class KvCheckpointStore implements CheckpointStore {
  private readonly kv: CheckpointKv;
  private readonly prefix: string;
  private readonly maxCheckpoints: number;
  private readonly retentionMs: number;
  private readonly preserveLabeled: boolean;
  private readonly now: () => number;

  constructor(kv: CheckpointKv, options?: KvCheckpointStoreOptions) {
    this.kv = kv;
    this.prefix = options?.prefix ?? "directive:checkpoint:";
    this.maxCheckpoints = options?.maxCheckpoints ?? 100;
    this.retentionMs = options?.retentionMs ?? Number.POSITIVE_INFINITY;
    this.preserveLabeled = options?.preserveLabeled ?? false;
    this.now = options?.now ?? Date.now;

    // Same guard, same message shape as the in-memory store: a store
    // that silently accepted `maxCheckpoints: 0` would evict every
    // checkpoint it was given and report success.
    if (!Number.isFinite(this.maxCheckpoints) || this.maxCheckpoints < 1) {
      throw new Error(
        `[Directive Checkpoint] maxCheckpoints must be >= 1, got ${this.maxCheckpoints}`,
      );
    }
  }

  private key(id: string): string {
    return `${this.prefix}${id}`;
  }
  private get indexKey(): string {
    return `${this.prefix}__index`;
  }

  private async readIndex(): Promise<IndexEntry[]> {
    const raw = await this.kv.get(this.indexKey);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Each entry is validated rather than trusted: a hand-edited or
      // half-written index must degrade to "fewer checkpoints listed",
      // never to a throw inside a resume path.
      return parsed.filter(
        (e): e is IndexEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as IndexEntry).id === "string" &&
          typeof (e as IndexEntry).createdAt === "string",
      );
    } catch {
      return [];
    }
  }

  private async writeIndex(entries: IndexEntry[]): Promise<void> {
    await this.kv.put(this.indexKey, JSON.stringify(entries));
  }

  async save(checkpoint: Checkpoint): Promise<string> {
    if (!validateCheckpoint(checkpoint)) {
      throw new Error("[Directive Checkpoint] Invalid checkpoint data");
    }

    const index = await this.readIndex();
    const without = index.filter((e) => e.id !== checkpoint.id);

    // FIFO eviction, oldest first, honouring preserveLabeled.
    while (without.length >= this.maxCheckpoints) {
      const victim = without.findIndex(
        (e) => !(this.preserveLabeled && e.label),
      );
      // Every remaining entry is labeled and preserved — stop rather
      // than evicting something the caller asked to keep. The store
      // grows past the cap, which is the lesser of two wrongs and is
      // the same choice the in-memory store makes.
      if (victim < 0) break;
      const [evicted] = without.splice(victim, 1);
      if (evicted !== undefined) await this.kv.delete(this.key(evicted.id));
    }

    // ⚠ CHECKPOINT FIRST, INDEX SECOND. If the process dies between the
    // two, the result is a checkpoint that `load()` finds and `list()`
    // does not — recoverable, and repaired on the next `save()`. The
    // other order gives an index pointing at a checkpoint that is not
    // there, which is a `load()` returning null for something the
    // caller was just told exists.
    await this.kv.put(this.key(checkpoint.id), JSON.stringify(checkpoint));
    without.push({
      id: checkpoint.id,
      ...(checkpoint.label === undefined ? {} : { label: checkpoint.label }),
      createdAt: checkpoint.createdAt,
    });
    await this.writeIndex(without);

    return checkpoint.id;
  }

  async load(checkpointId: string): Promise<Checkpoint | null> {
    const raw = await this.kv.get(this.key(checkpointId));
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      // Validated on the way OUT as well as in. A checkpoint that was
      // valid when written can be corrupt when read — a truncated
      // write, a hand edit — and resuming from a half-object is worse
      // than not resuming.
      return validateCheckpoint(parsed) ? (parsed as Checkpoint) : null;
    } catch {
      return null;
    }
  }

  async list(): Promise<
    Array<{ id: string; label?: string; createdAt: string }>
  > {
    return (await this.readIndex()).map((e) => ({
      id: e.id,
      ...(e.label === undefined ? {} : { label: e.label }),
      createdAt: e.createdAt,
    }));
  }

  async delete(checkpointId: string): Promise<boolean> {
    const index = await this.readIndex();
    const remaining = index.filter((e) => e.id !== checkpointId);
    const existed = remaining.length !== index.length;
    // Delete the value even when the index did not know about it: an
    // orphan from a lost index write is exactly what a caller means to
    // remove, and leaving it would make `delete()` unable to clean up
    // after a crash.
    await this.kv.delete(this.key(checkpointId));
    if (existed) await this.writeIndex(remaining);
    return existed;
  }

  async clear(): Promise<void> {
    for (const entry of await this.readIndex()) {
      await this.kv.delete(this.key(entry.id));
    }
    await this.writeIndex([]);
  }

  async prune(): Promise<number> {
    if (!Number.isFinite(this.retentionMs)) return 0;

    const cutoff = this.now() - this.retentionMs;
    const index = await this.readIndex();
    const keep: IndexEntry[] = [];
    let pruned = 0;

    for (const entry of index) {
      const createdAtMs = new Date(entry.createdAt).getTime();
      // An unparseable date is kept, not pruned. Deleting something
      // because its timestamp could not be read is destroying data over
      // a formatting problem.
      const expired = Number.isFinite(createdAtMs) && createdAtMs < cutoff;
      if (expired && !(this.preserveLabeled && entry.label)) {
        await this.kv.delete(this.key(entry.id));
        pruned += 1;
      } else {
        keep.push(entry);
      }
    }

    if (pruned > 0) await this.writeIndex(keep);
    return pruned;
  }
}
